"""Shared settings and Kafka helpers for every streaming service.

All settings can be overridden with environment variables (or .env).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

load_dotenv(PROJECT_ROOT / ".env")

# Windows consoles default to a codepage that can't print some log characters.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", line_buffering=True)
    except (AttributeError, ValueError):
        pass

# --------------------------------------------------------------------------- #
# Kafka
# --------------------------------------------------------------------------- #
BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")

TOPIC_RAW = "telemetry.raw"
TOPIC_SCORED = "telemetry.scored"
TOPIC_INCIDENTS = "incidents"
TOPIC_REPORTS = "reports"
ALL_TOPICS = (TOPIC_RAW, TOPIC_SCORED, TOPIC_INCIDENTS, TOPIC_REPORTS)

# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #
DATASETS = {
    "noised": PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv",
    "raw": PROJECT_ROOT / "data" / "raw" / "consolidated_dataset_raw.csv",
}
# Noised is the realistic one (the model is ~69% accurate on it); raw is clean
# simulated data where the model is ~100% accurate, which looks too perfect.
DEFAULT_DATASET = os.getenv("STREAM_DATASET", "noised")

CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]
# The 22 features the XGBoost model expects, in order. Read directly (not via
# tools.monitor_tool) so light services don't have to import CrewAI.
with open(SRC_DIR / "ml" / "baseline_feature_order.json", encoding="utf-8") as _f:
    FEATURE_ORDER: list[str] = json.load(_f)
SATELLITE_ID = os.getenv("SATELLITE_ID", "SENTINEL-1")

LIVE_DIR = PROJECT_ROOT / "data" / "live"          # SQLite + service logs (git-ignored)
DB_PATH = Path(os.getenv("SENTINEL_DB", str(LIVE_DIR / "sentinel.db")))

# --------------------------------------------------------------------------- #
# Incident manager guards
# --------------------------------------------------------------------------- #
# An incident opens when INCIDENT_MIN_ROWS of the last INCIDENT_WINDOW_ROWS
# rows are the same attack class at confidence >= INCIDENT_MIN_CONF.
# Not "N in a row": in a live stream attack rows are interleaved with normal
# traffic, so they rarely arrive back to back.
#
# Tuned on the datasets (simulated stream, attack burst interleaved 1:2 with
# Normal traffic): 0 false incidents over 3 loops of the Normal replay
# (~11k rows); clean attack bursts of 15 rows open exactly one correct
# incident 100% of the time; noisy bursts 17-48% (model limit on noised data).
INCIDENT_MIN_CONF = float(os.getenv("INCIDENT_MIN_CONF", "0.7"))       # row must be this confident to count
INCIDENT_MIN_ROWS = int(os.getenv("INCIDENT_MIN_ROWS", "5"))           # matching rows needed ...
INCIDENT_WINDOW_ROWS = int(os.getenv("INCIDENT_WINDOW_ROWS", "20"))    # ... within this many recent rows
INCIDENT_CLOSE_GAP_ROWS = int(os.getenv("INCIDENT_CLOSE_GAP_ROWS", "40"))  # rows without the class to close
INCIDENT_IDLE_CLOSE_SEC = float(os.getenv("INCIDENT_IDLE_CLOSE_SEC", "30"))  # close if the stream goes quiet

# --------------------------------------------------------------------------- #
# Agent worker
# --------------------------------------------------------------------------- #
# live   = run the 4-agent CrewAI crew on Groq for each incident
# cached = use the stored report for that class (offline demo, no Groq calls)
AGENT_MODE = os.getenv("AGENT_MODE", "live")

WEB_HOST = os.getenv("WEB_HOST", "127.0.0.1")
WEB_PORT = int(os.getenv("WEB_PORT", "8050"))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def to_bytes(obj) -> bytes:
    return json.dumps(obj, separators=(",", ":"), default=str).encode("utf-8")


def from_bytes(data: bytes):
    return json.loads(data.decode("utf-8"))


def make_producer(**extra):
    from confluent_kafka import Producer

    conf = {
        "bootstrap.servers": BOOTSTRAP,
        "linger.ms": 5,
        "acks": "all",
        "enable.idempotence": True,
    }
    conf.update(extra)
    return Producer(conf)


def make_consumer(group_id: str, topics, offset_reset: str = "earliest", static: bool = False, **extra):
    """static=True for the pipeline's single-instance services: with a fixed
    group.instance.id a restarted service takes over its partitions at once.
    Without it, a service that was killed (not closed cleanly) holds the
    partition until its session times out, and the replacement sits idle."""
    from confluent_kafka import Consumer

    conf = {
        "bootstrap.servers": BOOTSTRAP,
        "group.id": group_id,
        "auto.offset.reset": offset_reset,
        "enable.auto.commit": True,
        "session.timeout.ms": 10000,
        "heartbeat.interval.ms": 2000,
    }
    if static:
        conf["group.instance.id"] = f"{group_id}-1"
    conf.update(extra)
    consumer = Consumer(conf)
    consumer.subscribe(list(topics))
    return consumer


def log(service: str, msg: str) -> None:
    import time

    print(f"{time.strftime('%H:%M:%S')} [{service}] {msg}", flush=True)
