# -*- coding: utf-8 -*-
"""
agents/tools.py
===============
Role C — Day 3 Deliverable

CrewAI-compatible TOOL wrappers around the telemetry simulator.

What are tools?
  In CrewAI, a "tool" is a function an agent can call to interact with the
  real world. Instead of just thinking, the agent can "use a tool" to get
  live data, run a classifier, or query the SPARTA knowledge base.

Tools built here:
  1. TelemetryStreamTool   — agent calls this to get the next live telemetry window
  2. ScenarioInjectorTool  — agent calls this to trigger a specific attack scenario
  3. SpartaLookupTool      — agent calls this to look up SPARTA context for a label
  4. ClassifierTool        — agent calls this to classify a telemetry window
                             (stub until Role A's model is trained — Day 3)

Architecture:
  Simulator → SlidingWindowBuffer → TelemetryStreamTool → CrewAI Agent
                                                              ↓
                                                       ClassifierTool
                                                              ↓
                                                       SpartaLookupTool
"""

import sys, io, os, json, time
from typing import Optional, Type
from dataclasses import dataclass

# Fix Windows encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np

# CrewAI tool base
try:
    from crewai.tools import BaseTool
    from pydantic import BaseModel, Field
    CREWAI_AVAILABLE = True
except ImportError:
    # Fallback if crewai not installed yet — tools still work as plain functions
    CREWAI_AVAILABLE = False
    class BaseTool:
        pass
    class BaseModel:
        pass
    def Field(*args, **kwargs):
        return None

from simulator.telemetry_simulator import (
    SlidingWindowBuffer,
    stream_packets,
    LABEL_MAP,
    WINDOW_SIZE,
    load_dataset,
)
from sparta_kb.sparta_data import get_sparta_context, get_recommended_action


# ──────────────────────────────────────────────────────────────────────────────
# GLOBAL STREAM STATE
# The simulator runs as a shared global generator so all agents share the
# same stream position — only the Monitor Agent advances the stream
# ──────────────────────────────────────────────────────────────────────────────

class StreamState:
    """
    Singleton-style shared state for the telemetry stream.
    Holds the active generator + sliding window buffer.
    All agent tools read from this shared state.
    """
    _instance = None

    def __init__(self):
        self.generator = None           # active stream_packets() generator
        self.buffer = SlidingWindowBuffer(WINDOW_SIZE)
        self.current_packet = None      # last packet read
        self.packets_seen = 0
        self.windows_completed = 0
        self.dataset_path = None
        self.speed = "instant"          # agents run fast by default
        self.is_running = False
        self.attack_log = []            # history of detected attack windows

    @classmethod
    def get(cls) -> "StreamState":
        if cls._instance is None:
            cls._instance = StreamState()
        return cls._instance

    def initialize(self, dataset_path: str, speed: str = "instant"):
        """Load dataset and start the stream generator."""
        df = load_dataset(dataset_path)
        self.generator = stream_packets(df, speed=speed)
        self.dataset_path = dataset_path
        self.speed = speed
        self.is_running = True
        print(f"[StreamState] Initialized. Dataset: {dataset_path} | Speed: {speed}")

    def advance(self, n_packets: int = 1) -> list[dict]:
        """
        Advance the stream by N packets.
        Returns list of packets consumed. Returns [] if stream exhausted.
        """
        if not self.generator:
            raise RuntimeError("Stream not initialized. Call StreamState.get().initialize() first.")

        consumed = []
        for _ in range(n_packets):
            try:
                pkt = next(self.generator)
                self.current_packet = pkt
                self.packets_seen += 1
                self.buffer.add_packet(pkt)
                consumed.append(pkt)
            except StopIteration:
                self.is_running = False
                break

        if self.buffer.is_ready():
            self.windows_completed += 1

        return consumed

    def get_current_window(self) -> Optional[pd.DataFrame]:
        """Return the current sliding window as a DataFrame (for model input)."""
        if self.buffer.is_ready():
            return self.buffer.get_window_df()
        return None


# ──────────────────────────────────────────────────────────────────────────────
# TOOL 1 — TELEMETRY STREAM TOOL
# The Monitor Agent uses this to pull the next telemetry window
# ──────────────────────────────────────────────────────────────────────────────

class TelemetryStreamToolInput(BaseModel):
    n_packets: int = Field(
        default=WINDOW_SIZE,
        description="Number of packets to advance the stream by. Default is one full window (53)."
    )

class TelemetryStreamTool(BaseTool if CREWAI_AVAILABLE else object):
    """
    Tool for the Monitor Agent to read the next batch of telemetry packets.

    Returns a JSON summary of:
      - The latest packet (packet_id, label, label_name, key features)
      - The current sliding window status (fill level, ready or not)
      - A window DataFrame JSON (if the window is full — for the classifier)
    """
    name: str = "get_next_telemetry_window"
    description: str = (
        "Read the next batch of raw telemetry packets from the CubeSat stream. "
        "Advances the stream by one full sliding window (53 packets by default). "
        "Returns the window data ready for classification, plus status info. "
        "Call this tool to get the next chunk of satellite data to analyze."
    )
    args_schema: Type[BaseModel] = TelemetryStreamToolInput

    def _run(self, n_packets: int = WINDOW_SIZE) -> str:
        state = StreamState.get()

        if not state.is_running:
            return json.dumps({
                "status": "STREAM_EXHAUSTED",
                "message": "No more packets available. Stream has ended.",
                "packets_seen": state.packets_seen,
            })

        # Advance stream
        packets = state.advance(n_packets)

        if not packets:
            return json.dumps({"status": "STREAM_EXHAUSTED", "packets_seen": state.packets_seen})

        last = packets[-1]

        # Get window if ready
        window_summary = None
        window_df = state.get_current_window()
        if window_df is not None:
            # Summarize the window (don't send all 53 rows to the LLM — too much)
            window_summary = {
                "shape": list(window_df.shape),
                "feature_means": {
                    col: round(float(window_df[col].mean()), 4)
                    for col in window_df.columns[:8]  # Top 8 features only
                },
                "window_number": state.windows_completed,
            }

        result = {
            "status": "OK",
            "latest_packet": {
                "packet_id":  last["packet_id"],
                "label":      last["label"],
                "label_name": last["label_name"],
                "key_features": {
                    k: round(float(v), 4) if isinstance(v, float) else v
                    for k, v in list(last["features"].items())[:6]
                },
            },
            "stream_status": {
                "packets_seen":       state.packets_seen,
                "windows_completed":  state.windows_completed,
                "window_fill_pct":    round(state.buffer.fill_level * 100, 1),
                "window_ready":       state.buffer.is_ready(),
            },
            "window_for_classifier": window_summary,
        }
        return json.dumps(result, indent=2)


# ──────────────────────────────────────────────────────────────────────────────
# TOOL 2 — CLASSIFIER TOOL
# The Classifier Agent uses this to get a prediction for the current window
# NOTE: This is a STUB until Role A trains the real XGBoost model (Day 3)
#       When the model is ready, replace _run() with actual model.predict()
# ──────────────────────────────────────────────────────────────────────────────

class ClassifierToolInput(BaseModel):
    use_ground_truth: bool = Field(
        default=True,
        description=(
            "If True, returns the ground truth label from the dataset (for testing). "
            "Set to False when the real model is loaded."
        ),
    )

class ClassifierTool(BaseTool if CREWAI_AVAILABLE else object):
    """
    Tool for the Classifier Agent to classify the current telemetry window.

    Loads the XGBoost model from `models/xgboost_model.json` if available.
    """
    name: str = "classify_telemetry_window"
    description: str = (
        "Classify the current telemetry window to detect if there is a cyber attack. "
        "Returns the predicted attack class (Normal/CommandFlooding/DataInjection/"
        "StorageExhaustion/DefenceImpairment), a confidence score (0-1), and the "
        "top features that drove the prediction. "
        "Call this after get_next_telemetry_window returns window_ready=True."
    )
    args_schema: Type[BaseModel] = ClassifierToolInput

    # Holds the real model once loaded
    _model = None

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if ClassifierTool._model is None and os.path.exists("models/xgboost_model.json"):
            ClassifierTool.load_model("models/xgboost_model.json")

    @classmethod
    def load_model(cls, model_path: str):
        """Called by Role A once the XGBoost model is trained and saved."""
        import xgboost as xgb
        cls._model = xgb.XGBClassifier()
        cls._model.load_model(model_path)
        print(f"[ClassifierTool] Real model loaded from {model_path}")

    def _run(self, use_ground_truth: bool = True) -> str:
        state = StreamState.get()
        window_df = state.get_current_window()

        if window_df is None:
            return json.dumps({
                "status": "NO_WINDOW",
                "message": "Window not full yet. Call get_next_telemetry_window first.",
            })

        # ── Real model path (Role A fills this in) ───────────────────────────
        if self._model is not None:
            try:
                proba = self._model.predict_proba(window_df)
                pred_label = int(np.argmax(proba.mean(axis=0)))
                confidence = float(proba.mean(axis=0).max())
                source = "xgboost_model"
            except Exception as e:
                return json.dumps({"status": "MODEL_ERROR", "error": str(e)})

        # ── Stub: use ground truth label from stream ──────────────────────────
        elif use_ground_truth and state.current_packet:
            pred_label = state.current_packet["label"]
            confidence = 0.95  # Stub confidence
            source = "ground_truth_stub"

        else:
            # Fallback: random prediction (demo mode)
            pred_label = np.random.randint(0, 5)
            confidence = round(np.random.uniform(0.5, 0.99), 3)
            source = "random_stub"

        label_name = LABEL_MAP.get(pred_label, "Unknown")

        # Stub SHAP values — Role A replaces with real SHAP
        stub_shap = {
            "MemoryAnonMB":               round(np.random.uniform(0.1, 0.9), 3),
            "UniqueMessageIDsInWindow":   round(np.random.uniform(0.05, 0.8), 3),
            "SlidingWindowMaxIntervalSec": round(np.random.uniform(0.01, 0.5), 3),
            "MemoryShmemMB":              round(np.random.uniform(0.0, 0.4), 3),
            "MsgCount":                   round(np.random.uniform(0.0, 0.3), 3),
        }

        result = {
            "status": "OK",
            "source": source,
            "prediction": {
                "label":      pred_label,
                "class_name": label_name,
                "confidence": confidence,
            },
            "shap_top_features": stub_shap,
            "window_number": state.windows_completed,
            "note": (
                "STUB: ground truth used. Replace with real model via "
                "ClassifierTool.load_model('models/xgboost_model.json')"
            ) if source != "xgboost_model" else "Real model prediction.",
        }
        return json.dumps(result, indent=2)


# ──────────────────────────────────────────────────────────────────────────────
# TOOL 3 — SPARTA LOOKUP TOOL
# The SPARTA Analyst Agent uses this to get context for a detected attack
# ──────────────────────────────────────────────────────────────────────────────

class SpartaLookupToolInput(BaseModel):
    label: int = Field(
        description="CuCD-ID label (0=Normal, 1=Storage Exhaustion, 2=Command Flooding, "
                    "3=Data Injection, 4=Defence Impairment)"
    )
    query: Optional[str] = Field(
        default=None,
        description="Optional natural language query for semantic RAG search (e.g. 'indicators of command flooding')."
    )

class SpartaLookupTool(BaseTool if CREWAI_AVAILABLE else object):
    """
    Tool for the SPARTA Analyst Agent to retrieve threat intelligence context.

    Given a detected attack label, queries the ChromaDB SPARTA knowledge base
    and returns:
      - SPARTA tactic ID and name
      - SPARTA technique description
      - Telemetry indicators
      - Recommended mitigations
      - Recommended autonomous action
    """
    name: str = "lookup_sparta_threat_context"
    description: str = (
        "Look up SPARTA (Space Attack Research and Tactic Analysis) threat intelligence "
        "for a detected attack class. Given a CuCD-ID label (0-4), returns the matching "
        "SPARTA tactic, technique, indicators, and recommended autonomous action. "
        "Use this after classify_telemetry_window returns a non-Normal prediction."
    )
    args_schema: Type[BaseModel] = SpartaLookupToolInput

    def _run(self, label: int, query: Optional[str] = None) -> str:
        # Direct lookup from sparta_data (always available)
        context = get_sparta_context(label)
        action = get_recommended_action(label)

        result = {
            "status": "OK",
            "attack_name":       context["attack_name"],
            "sparta_tactic":     context["sparta_tactic"],
            "sparta_tactic_name": context["sparta_tactic_name"],
            "sparta_technique":  context["sparta_technique"],
            "risk_level":        context["risk_level"],
            "recommended_action": action,
            "analysis_summary":  context["summary"],
        }

        # Optional: semantic RAG search for additional context
        if query:
            try:
                from sparta_kb.build_chroma import query_sparta
                rag_results = query_sparta(query, n_results=2)
                result["rag_context"] = [
                    {"text": r["text"][:300], "score": round(r["distance"], 4)}
                    for r in rag_results
                ]
            except Exception as e:
                result["rag_context"] = f"RAG unavailable: {e}"

        return json.dumps(result, indent=2)


# ──────────────────────────────────────────────────────────────────────────────
# TOOL 4 — SCENARIO INJECTOR TOOL (Day 4 — stub for now)
# The Monitor Agent uses this to force a specific attack scenario for demos
# ──────────────────────────────────────────────────────────────────────────────

class ScenarioInjectorToolInput(BaseModel):
    scenario_id: int = Field(
        description="Scenario to inject: 0=Normal, 1=Storage, 2=CmdFlood, 3=DataInj, 4=DefImp"
    )
    n_packets: int = Field(default=200, description="Number of packets to inject.")

class ScenarioInjectorTool(BaseTool if CREWAI_AVAILABLE else object):
    """
    Tool that injects a scripted attack scenario mid-stream.
    Reloads the stream from a specific scenario slice.
    Fully implemented in Day 4.
    """
    name: str = "inject_attack_scenario"
    description: str = (
        "Inject a specific CubeSat attack scenario into the telemetry stream. "
        "Use this to test the system's response to a specific attack type. "
        "Scenario IDs: 0=Normal, 1=Storage Exhaustion, 2=Command Flooding, "
        "3=Data Injection, 4=Defence Impairment."
    )
    args_schema: Type[BaseModel] = ScenarioInjectorToolInput

    def _run(self, scenario_id: int, n_packets: int = 200) -> str:
        from simulator.scenario_injector import (
            InjectionEngine, ScenarioStep, LABEL_NAMES
        )
        state = StreamState.get()

        # Build a single-scenario step and replace the active stream generator
        step = ScenarioStep(label=scenario_id, n_packets=n_packets,
                            description=LABEL_NAMES.get(scenario_id, "Unknown"))
        engine = InjectionEngine([step])
        state.generator = engine.stream()
        state.is_running = True
        state.buffer = SlidingWindowBuffer(WINDOW_SIZE)  # reset window buffer

        return json.dumps({
            "status":        "INJECTED",
            "message":       f"Stream replaced with {n_packets} packets of "
                             f"scenario {scenario_id}: {LABEL_NAMES.get(scenario_id)}.",
            "scenario_id":   scenario_id,
            "scenario_name": LABEL_NAMES.get(scenario_id, "Unknown"),
            "n_packets":     n_packets,
        })


# ──────────────────────────────────────────────────────────────────────────────
# TOOL REGISTRY — all tools available to agents
# ──────────────────────────────────────────────────────────────────────────────

def get_all_tools() -> list:
    """Return all instantiated tools for use in a CrewAI crew."""
    return [
        TelemetryStreamTool(),
        ClassifierTool(),
        SpartaLookupTool(),
        ScenarioInjectorTool(),
    ]


# ──────────────────────────────────────────────────────────────────────────────
# PLAIN FUNCTION WRAPPERS (work without CrewAI — for testing / pipeline.py)
# ──────────────────────────────────────────────────────────────────────────────

def tool_get_next_window(n_packets: int = WINDOW_SIZE) -> dict:
    """Functional wrapper — calls TelemetryStreamTool without CrewAI."""
    tool = TelemetryStreamTool()
    raw = tool._run(n_packets=n_packets)
    return json.loads(raw)

def tool_classify(use_ground_truth: bool = True) -> dict:
    """Functional wrapper — calls ClassifierTool without CrewAI."""
    tool = ClassifierTool()
    raw = tool._run(use_ground_truth=use_ground_truth)
    return json.loads(raw)

def tool_sparta_lookup(label: int, query: str = None) -> dict:
    """Functional wrapper — calls SpartaLookupTool without CrewAI."""
    tool = SpartaLookupTool()
    raw = tool._run(label=label, query=query)
    return json.loads(raw)
