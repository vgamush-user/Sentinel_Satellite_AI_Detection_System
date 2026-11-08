"""HTTP adapter for the manual replay and analysis workspace."""
from __future__ import annotations

import json
import os
from threading import Lock
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from simulator.telemetry_simulator import TelemetryReplaySimulator
from streaming.config import AGENT_MODE, CLASS_NAMES, DATASETS, FEATURE_ORDER, log

router = APIRouter(prefix="/api/analysis")
replay_lock = Lock()
analysis_lock = Lock()
simulator: TelemetryReplaySimulator | None = None
dataset = "noised"


class ReplaySettings(BaseModel):
    dataset: Literal["noised", "raw"] = "noised"
    speed: int = Field(10, ge=1, le=200)
    order: Literal["sequential", "shuffled"] = "sequential"
    loop: bool = True
    buffer_size: int = Field(100, ge=20, le=500)


def live_available():
    return AGENT_MODE == "live" and bool(os.environ.get("GROQ_API_KEY"))


def get_simulator():
    global simulator
    if simulator is None:
        simulator = TelemetryReplaySimulator(str(DATASETS[dataset]), buffer_size=100)
    return simulator


def stop_replay():
    with replay_lock:
        if simulator is not None:
            simulator.stop()


def snapshot():
    with replay_lock:
        return dataset, get_simulator().snapshot()


def window_for(row):
    return {feature: float(row[feature]) for feature in FEATURE_ORDER}


def monitor_window(window):
    from tools.monitor_tool import should_escalate

    return should_escalate(window)


@router.get("/replay")
def replay():
    name, state = snapshot()
    buffer = state.buffer
    return {
        "dataset": name,
        "state": "paused" if state.paused else "running" if state.running else "finished" if state.finished else "stopped",
        "total_rows": state.total_rows,
        "rows_emitted": state.rows_emitted,
        "elapsed": state.elapsed_sec,
        "speed": state.speed_rows_per_sec,
        "order": state.order_mode,
        "loop": state.loop,
        "rows": json.loads(buffer.to_json(orient="records")),
        "monitor": monitor_window(window_for(state.last_row)) if state.last_row is not None else None,
        "live_available": live_available(),
    }


@router.post("/replay/{action}", status_code=204)
def control_replay(action: Literal["load", "configure", "start", "pause", "resume", "stop"], settings: ReplaySettings):
    global dataset, simulator
    with replay_lock:
        current = get_simulator()
        if action == "load":
            replacement = TelemetryReplaySimulator(str(DATASETS[settings.dataset]), buffer_size=settings.buffer_size)
            current.stop()
            simulator = replacement
            dataset = settings.dataset
        elif action in ("start", "configure"):
            current.configure(settings.speed, settings.order, settings.loop, settings.buffer_size)
            if action == "start":
                current.start()
        elif action == "pause":
            current.pause()
        elif action == "resume":
            current.resume()
        else:
            current.stop()


@router.post("/run")
def analyze():
    if not live_available():
        raise HTTPException(503, "Live analysis requires live agent mode and a Groq key. Cached examples are available in Overview.")
    if not analysis_lock.acquire(blocking=False):
        raise HTTPException(409, "An analysis is already running.")
    try:
        name, state = snapshot()
        if state.last_row is None:
            raise HTTPException(409, "Start replay and wait for a telemetry row.")
        from pipeline.full_pipeline import run_pipeline_for_window
        from tools.mitigation_tool import decide_mitigation

        window = window_for(state.last_row)
        monitor = monitor_window(window)
        result = run_pipeline_for_window(window)
        classification = result.get("classification")
        if result["status"] == "ERROR" or classification is None:
            raise HTTPException(502, "The analysis provider did not return a complete result.")
        prediction = classification.predicted_class
        confidence = classification.confidence
        policy = decide_mitigation(prediction, confidence)
        label = int(state.last_row.get("Label", -1))
        return {
            "dataset": name, "row": state.rows_emitted, "message_id": window["MsgId"], "monitor": monitor,
            "label": CLASS_NAMES[label] if 0 <= label < len(CLASS_NAMES) else None,
            "prediction": prediction, "confidence": confidence, "status": result["status"],
            "action": policy.get("action"), "guardrail": policy.get("guardrail_note"),
            "report": result.get("report"), "sparta": result.get("sparta_context"), "mitigation": result.get("mitigation"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        log("analysis", f"Manual analysis failed: {exc!r}")
        raise HTTPException(502, "The analysis could not finish. Try again or explore a cached scenario.") from exc
    finally:
        analysis_lock.release()
