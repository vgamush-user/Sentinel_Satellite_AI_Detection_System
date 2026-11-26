"""Agent worker: runs the 4-agent CrewAI crew on each new incident.

incidents (event=opened)  ->  Classifier -> SPARTA Analyst -> Mitigation -> Reporter  ->  reports

This is the only part of the real-time pipeline that calls Groq, and it runs
once per incident, not per telemetry row. Incidents are processed one at a
time; if several open at once they wait in Kafka (the website shows them as
queued), so the Groq free-tier rate limit never slows down detection.

The offset is committed only after an incident's report is published, so if
the worker crashes mid-analysis the incident is analysed again on restart.
Incidents older than AGENT_MAX_AGE_SEC are skipped (stale after downtime).

AGENT_MODE=live    run the crew on Groq (default; needs GROQ_API_KEY)
AGENT_MODE=cached  use the stored report for that class (offline demo)

    python -m streaming.agent_worker
"""
from __future__ import annotations

import json
import os
import signal
import time

from streaming.config import (AGENT_MODE, SRC_DIR, TOPIC_INCIDENTS, TOPIC_REPORTS, from_bytes, log,
                              make_consumer, make_producer, to_bytes)
from streaming.topics import ensure_topics

AGENT_MAX_AGE_SEC = float(os.getenv("AGENT_MAX_AGE_SEC", "900"))

_running = True


def _stop(*_):
    global _running
    _running = False


def _cached_result(attack_class: str) -> dict:
    with open(SRC_DIR / "pipeline" / "demo_cache.json", encoding="utf-8") as f:
        cache = json.load(f)
    entry = cache.get(attack_class)
    if not entry:
        return {"status": "ERROR", "classification": None, "sparta_context": "", "mitigation": "",
                "report": f"No cached report for {attack_class}."}
    return {
        "status": entry["status"],
        "classification": None,  # the cached classification belongs to a different row
        "sparta_context": entry["sparta_context"],
        "mitigation": entry["mitigation"],
        "report": entry["report"],
    }


def analyse(incident: dict, mode: str) -> dict:
    if mode == "cached":
        return _cached_result(incident["attack_class"])
    from pipeline.full_pipeline import run_pipeline_for_window  # heavy import (CrewAI), only in live mode
    return run_pipeline_for_window(incident["sample_window"])


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ensure_topics()

    mode = AGENT_MODE
    if mode == "live" and not os.getenv("GROQ_API_KEY"):
        log("agents", "GROQ_API_KEY is not set: falling back to AGENT_MODE=cached")
        mode = "cached"
    if mode == "live":
        log("agents", "loading CrewAI agents (first start takes a few seconds)...")
        import pipeline.full_pipeline  # noqa: F401  -- fail fast if the agents can't load

    consumer = make_consumer(
        "sentinel-agent-worker", [TOPIC_INCIDENTS], offset_reset="earliest", static=True,
        **{"enable.auto.commit": False,
           # A crew run on the free tier can take several minutes (with
           # rate-limit retries); don't let Kafka assume the worker died.
           "max.poll.interval.ms": 1_800_000},
    )
    producer = make_producer()

    def publish(event: dict) -> None:
        producer.produce(TOPIC_REPORTS, key=event["incident_id"].encode(), value=to_bytes(event))
        producer.flush(10)

    log("agents", f"waiting for incidents on {TOPIC_INCIDENTS} (mode={mode})")
    try:
        while _running:
            m = consumer.poll(0.5)
            if m is None or m.error():
                continue
            try:
                inc = from_bytes(m.value())
            except ValueError:
                consumer.commit(message=m, asynchronous=False)
                continue
            if inc.get("event") != "opened":
                consumer.commit(message=m, asynchronous=False)
                continue

            age = time.time() - inc.get("opened_ts", 0)
            if age > AGENT_MAX_AGE_SEC:
                log("agents", f"skipping {inc['incident_id']}: opened {age / 60:.0f} min ago (stale)")
                consumer.commit(message=m, asynchronous=False)
                continue

            started = time.time()
            log("agents", f"analysing {inc['incident_id']} ({inc['attack_class']}, mode={mode})")
            publish({"event": "started", "incident_id": inc["incident_id"], "attack_class": inc["attack_class"],
                     "mode": mode, "started_ts": started})
            try:
                result = analyse(inc, mode)
            except Exception as exc:  # the crew already guards most failures; this is the last resort
                result = {"status": "ERROR", "classification": None, "sparta_context": "", "mitigation": "",
                          "report": f"Agent pipeline crashed: {exc}"}
            cls = result.get("classification")
            finished = time.time()
            publish({
                "event": "finished",
                "incident_id": inc["incident_id"],
                "attack_class": inc["attack_class"],
                "mode": mode,
                "status": result["status"],
                "predicted_class": getattr(cls, "predicted_class", None),
                "confidence": getattr(cls, "confidence", None),
                "sparta_context": result.get("sparta_context", ""),
                "mitigation": result.get("mitigation", ""),
                "report": result.get("report", ""),
                "started_ts": started,
                "finished_ts": finished,
                "runtime_sec": round(finished - started, 1),
            })
            consumer.commit(message=m, asynchronous=False)
            log("agents", f"finished {inc['incident_id']}: {result['status']} in {finished - started:.0f}s")
    finally:
        producer.flush(10)
        consumer.close()
        log("agents", "stopped")


if __name__ == "__main__":
    main()
