"""Sentinel live website: FastAPI backend + one static page.

A background thread consumes telemetry.scored, incidents and reports from
Kafka and pushes them to every open browser over a WebSocket (batched every
250 ms). Incident/report history comes from the recorder's SQLite database.
New entries (test panel, attack buttons, POST /api/ingest) go into Kafka
through streaming.inject, exactly like the CSV replay.

    python -m web.server            (from src/)  ->  http://127.0.0.1:8050
"""
from __future__ import annotations

import asyncio
import threading
import time
import uuid
from collections import Counter, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from streaming.config import (AGENT_MODE, BOOTSTRAP, CLASS_NAMES, DATASETS, FEATURE_ORDER, INCIDENT_CLOSE_GAP_ROWS,
                              INCIDENT_MIN_CONF, INCIDENT_MIN_ROWS, INCIDENT_WINDOW_ROWS, TOPIC_INCIDENTS,
                              TOPIC_REPORTS, TOPIC_SCORED, WEB_HOST, WEB_PORT, from_bytes, log, make_consumer)
from streaming import inject, storage
from streaming.topics import ensure_topics

STATIC = Path(__file__).resolve().parent / "static"
QUALITY = {"clean": "raw", "noisy": "noised"}  # UI name -> dataset key
CHART_FEATURES = ("MessageRateInWindow", "AverageMessageLengthInWindow", "MemoryAnonMB")


# --------------------------------------------------------------------------- #
# Kafka -> browser bridge
# --------------------------------------------------------------------------- #
class Bridge:
    def __init__(self):
        self.recent = deque(maxlen=300)          # slim telemetry rows for the chart / feed
        self.outbox = deque()                    # items waiting to be pushed to browsers
        self.lock = threading.Lock()
        self.total_rows = 0
        self.labelled = 0
        self.correct = 0
        self.pred_counts = Counter()
        self.rate_window = deque()               # timestamps of the last ~5 s of rows
        self.latency_ms = deque(maxlen=200)
        self.last_row_ts = 0.0
        self.counts = Counter()                  # incidents opened, reports finished, ...
        self.kafka_ok = False
        self.stop = threading.Event()

    @staticmethod
    def slim(s: dict) -> dict:
        row = {
            "entry_id": s["entry_id"], "ts": s["ts"], "seq": s.get("seq"), "source": s.get("source"),
            "burst_id": s.get("burst_id"), "true_class": s.get("true_class"),
            "predicted_class": s["predicted_class"], "confidence": s["confidence"],
            "threat": round(1 - s.get("probabilities", {}).get("Normal", 0.0), 4),
            "latency_ms": s.get("pipeline_latency_ms"),
            "f": {k: s["features"].get(k) for k in CHART_FEATURES},
        }
        if s.get("source") != "replay":
            row["probabilities"] = s.get("probabilities")
        return row

    def stats(self) -> dict:
        now = time.time()
        while self.rate_window and now - self.rate_window[0] > 5:
            self.rate_window.popleft()
        lat = sorted(self.latency_ms)
        return {
            "kafka_ok": self.kafka_ok,
            "rows_total": self.total_rows,
            "rows_per_sec": round(len(self.rate_window) / 5, 1),
            "accuracy": round(self.correct / self.labelled, 4) if self.labelled else None,
            "labelled": self.labelled,
            "pred_counts": dict(self.pred_counts),
            "latency_p50_ms": lat[len(lat) // 2] if lat else None,
            "last_row_age_sec": round(now - self.last_row_ts, 1) if self.last_row_ts else None,
            "counts": dict(self.counts),
        }

    def run(self):
        consumer = None
        while not self.stop.is_set():
            try:
                if consumer is None:
                    ensure_topics()
                    # A fresh group per server start: every browser should see
                    # everything from now on, independent of the other services.
                    consumer = make_consumer(f"sentinel-web-{uuid.uuid4().hex[:6]}",
                                             [TOPIC_SCORED, TOPIC_INCIDENTS, TOPIC_REPORTS],
                                             offset_reset="latest", **{"enable.auto.commit": False})
                    self.kafka_ok = True
                    log("web", f"connected to Kafka at {BOOTSTRAP}")
                for m in consumer.consume(num_messages=500, timeout=0.2):
                    if m.error():
                        continue
                    self.handle(m.topic(), from_bytes(m.value()))
            except Exception as exc:
                self.kafka_ok = False
                log("web", f"Kafka error: {exc!r}; retrying in 3 s")
                if consumer is not None:
                    try:
                        consumer.close()
                    except Exception:
                        pass
                    consumer = None
                self.stop.wait(3)
        if consumer is not None:
            consumer.close()

    def handle(self, topic: str, msg: dict):
        with self.lock:
            if topic == TOPIC_SCORED:
                row = self.slim(msg)
                self.recent.append(row)
                self.total_rows += 1
                self.pred_counts[row["predicted_class"]] += 1
                if msg.get("true_label") is not None:
                    self.labelled += 1
                    self.correct += msg["predicted_label"] == msg["true_label"]
                now = time.time()
                self.rate_window.append(now)
                self.last_row_ts = now
                if row["latency_ms"] is not None:
                    self.latency_ms.append(row["latency_ms"])
                self.outbox.append(("telemetry", row))
            elif topic == TOPIC_INCIDENTS:
                if msg.get("event") == "opened":
                    self.counts["incidents_opened"] += 1
                    msg = {k: v for k, v in msg.items() if k != "sample_window"}
                self.outbox.append(("incident", msg))
            elif topic == TOPIC_REPORTS:
                if msg.get("event") == "finished":
                    self.counts["reports_finished"] += 1
                self.outbox.append(("report", msg))

    def drain(self) -> dict | None:
        with self.lock:
            if not self.outbox:
                return {"stats": self.stats()}
            items = list(self.outbox)
            self.outbox.clear()
            stats = self.stats()
        return {
            "telemetry": [p for k, p in items if k == "telemetry"],
            "incidents": [p for k, p in items if k == "incident"],
            "reports": [p for k, p in items if k == "report"],
            "stats": stats,
        }


bridge = Bridge()
clients: set[WebSocket] = set()


async def broadcaster():
    last_stats = 0.0
    while True:
        await asyncio.sleep(0.25)
        batch = bridge.drain()
        has_events = any(batch.get(k) for k in ("telemetry", "incidents", "reports"))
        if not has_events and time.time() - last_stats < 1.0:
            continue  # stats-only updates once a second are enough
        last_stats = time.time()
        dead = []
        for ws in list(clients):
            try:
                await ws.send_json(batch)
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On Windows, asyncio logs a full traceback (ConnectionResetError, WinError
    # 10054) whenever a browser tab is closed mid-connection. It's harmless;
    # drop just that one so real errors stay visible in the log.
    loop = asyncio.get_running_loop()
    default_handler = loop.get_exception_handler()

    def quiet_resets(loop_, context):
        if isinstance(context.get("exception"), ConnectionResetError):
            return
        if default_handler is None:
            loop_.default_exception_handler(context)
        else:
            default_handler(loop_, context)

    loop.set_exception_handler(quiet_resets)

    thread = threading.Thread(target=bridge.run, daemon=True, name="kafka-bridge")
    thread.start()
    task = asyncio.create_task(broadcaster())
    yield
    task.cancel()
    bridge.stop.set()


app = FastAPI(title="Sentinel live monitor", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


# --------------------------------------------------------------------------- #
# Pages + read API
# --------------------------------------------------------------------------- #
@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/state")
def state():
    with bridge.lock:
        recent = list(bridge.recent)
        stats = bridge.stats()
    return {
        "stats": stats,
        "recent": recent,
        "incidents": storage.list_incidents(50),
        "config": {
            "classes": CLASS_NAMES,
            "features": FEATURE_ORDER,
            "agent_mode": AGENT_MODE,
            "guards": {"min_confidence": INCIDENT_MIN_CONF, "min_rows": INCIDENT_MIN_ROWS,
                       "window_rows": INCIDENT_WINDOW_ROWS, "close_gap_rows": INCIDENT_CLOSE_GAP_ROWS},
        },
    }


@app.get("/api/incidents/{incident_id}")
def incident(incident_id: str):
    inc = storage.get_incident(incident_id)
    if inc is None:
        raise HTTPException(404, "incident not found (the recorder may not have stored it yet)")
    return inc


@app.get("/api/sample")
def sample(cls: str | None = None, quality: str = "clean"):
    """A real dataset row to start a test entry from."""
    if cls in (None, "", "random"):
        cls = None
    elif cls not in CLASS_NAMES:
        raise HTTPException(400, f"unknown class {cls!r}")
    if quality not in QUALITY:
        raise HTTPException(400, "quality must be clean or noisy")
    row = inject.sample_rows(cls, 1, contiguous=False, dataset=QUALITY[quality]).iloc[0]
    return {"features": inject.row_features(row), "true_class": CLASS_NAMES[int(row["Label"])],
            "quality": quality, "dataset": DATASETS[QUALITY[quality]].name}


# --------------------------------------------------------------------------- #
# Entry points
# --------------------------------------------------------------------------- #
class IngestRequest(BaseModel):
    features: dict[str, float] = Field(description="all 22 model features")
    count: int = Field(1, ge=1, le=50, description="send the entry this many times (a burst)")
    true_class: str | None = Field(None, description="optional ground-truth class, for accuracy only")
    interval_sec: float = Field(0.1, ge=0, le=2)


def _send_in_background(msgs: list[dict], interval_sec: float) -> dict:
    """Return the entry ids at once and send in a thread, so the browser can
    start tracking before the first row is scored (a 15-row burst takes ~1.5 s)."""
    if not bridge.kafka_ok:
        raise HTTPException(503, "Kafka is not reachable; is Docker running?")

    def run():
        try:
            inject.send_prepared(msgs, interval_sec)
        except Exception as exc:
            log("web", f"failed to send {len(msgs)} entries: {exc!r}")

    threading.Thread(target=run, daemon=True).start()
    return {"entry_ids": [m["entry_id"] for m in msgs], "count": len(msgs)}


def _ingest(req: IngestRequest, source: str) -> dict:
    missing = [f for f in FEATURE_ORDER if f not in req.features]
    if missing:
        raise HTTPException(400, f"missing features: {', '.join(missing)}")
    if req.true_class is not None and req.true_class not in CLASS_NAMES:
        raise HTTPException(400, f"unknown class {req.true_class!r}")
    label = CLASS_NAMES.index(req.true_class) if req.true_class else None
    msgs = inject.prepare_entries([req.features] * req.count, source, [label] * req.count)
    return _send_in_background(msgs, req.interval_sec)


@app.post("/api/ingest")
def ingest(req: IngestRequest):
    """Public entry point for scripts or a real feed: one telemetry entry (or a burst)."""
    return _ingest(req, "api")


@app.post("/api/panel/send")
def panel_send(req: IngestRequest):
    """Same as /api/ingest, tagged as coming from the website's test panel."""
    return _ingest(req, "panel")


class AttackRequest(BaseModel):
    cls: str
    count: int = Field(15, ge=1, le=100)
    quality: str = "clean"


@app.post("/api/attack")
def attack(req: AttackRequest):
    if req.cls not in CLASS_NAMES:
        raise HTTPException(400, f"unknown class {req.cls!r}")
    if req.quality not in QUALITY:
        raise HTTPException(400, "quality must be clean or noisy")
    msgs = inject.prepare_class(req.cls, req.count, "attack", dataset=QUALITY[req.quality])
    return _send_in_background(msgs, 0.1)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; the client doesn't send anything meaningful
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


def main():
    import uvicorn

    log("web", f"Sentinel live website on http://{WEB_HOST}:{WEB_PORT}")
    uvicorn.run(app, host=WEB_HOST, port=WEB_PORT, log_level="warning")


if __name__ == "__main__":
    main()
