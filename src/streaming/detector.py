"""Detector: classifies every telemetry row with the trained XGBoost model.

telemetry.raw  ->  XGBoost (same model as the classify_telemetry tool)  ->  telemetry.scored

No LLM here, so this keeps up with the stream (a few microseconds per row).
Messages are scored in micro-batches: whatever arrived since the last poll.
Every 10 s it logs throughput and live accuracy vs. the ground-truth label.

    python -m streaming.detector
"""
from __future__ import annotations

import signal
import time

import numpy as np

from streaming.config import (CLASS_NAMES, FEATURE_ORDER, TOPIC_RAW, TOPIC_SCORED, from_bytes, log,
                              make_consumer, make_producer, to_bytes)
from streaming.topics import ensure_topics

_running = True


def _stop(*_):
    global _running
    _running = False


def load_model():
    # Same model file the CrewAI classify_telemetry tool loads, loaded directly
    # so this service doesn't need to import CrewAI.
    import xgboost as xgb
    from streaming.config import SRC_DIR

    model = xgb.XGBClassifier()
    model.load_model(str(SRC_DIR / "ml" / "baseline_xgb.json"))
    return model


def score(model, msgs: list[dict]) -> list[dict]:
    X = np.array([[m["features"][f] for f in FEATURE_ORDER] for m in msgs], dtype=float)
    t0 = time.perf_counter()
    proba = model.predict_proba(X)
    per_row_ms = (time.perf_counter() - t0) * 1000 / len(msgs)
    labels = proba.argmax(axis=1)
    out = []
    now = time.time()
    for m, lab, p in zip(msgs, labels, proba):
        s = dict(m)
        s["predicted_label"] = int(lab)
        s["predicted_class"] = CLASS_NAMES[int(lab)]
        s["confidence"] = round(float(p[lab]), 4)
        s["probabilities"] = {c: round(float(v), 4) for c, v in zip(CLASS_NAMES, p)}
        s["detect_ms"] = round(per_row_ms, 4)
        s["scored_ts"] = now
        s["pipeline_latency_ms"] = round((now - m["ts"]) * 1000, 1)
        out.append(s)
    return out


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ensure_topics()
    model = load_model()
    # "latest": on (re)start, score what arrives from now on rather than
    # re-scoring hours of backlog.
    consumer = make_consumer("sentinel-detector", [TOPIC_RAW], offset_reset="latest", static=True)
    producer = make_producer()
    log("detector", f"scoring {TOPIC_RAW} -> {TOPIC_SCORED}")

    n = correct = labelled = 0
    t_report = time.time()
    try:
        while _running:
            # Short timeout keeps latency low at demo rates; under load the
            # batch fills to 500 first, which keeps throughput high.
            batch = consumer.consume(num_messages=500, timeout=0.1)
            msgs = []
            for m in batch:
                if m.error():
                    continue
                try:
                    msgs.append(from_bytes(m.value()))
                except ValueError:
                    log("detector", "skipped a message that isn't valid JSON")
            if msgs:
                for s in score(model, msgs):
                    producer.produce(TOPIC_SCORED, key=s["satellite_id"].encode(), value=to_bytes(s))
                    n += 1
                    if s.get("true_label") is not None:
                        labelled += 1
                        correct += s["predicted_label"] == s["true_label"]
                producer.poll(0)

            now = time.time()
            if now - t_report >= 10 and n:
                acc = f", accuracy {correct / labelled:.1%} on {labelled} labelled rows" if labelled else ""
                log("detector", f"{n / (now - t_report):.1f} rows/s{acc}")
                n = correct = labelled = 0
                t_report = now
    finally:
        producer.flush(10)
        consumer.close()
        log("detector", "stopped")


if __name__ == "__main__":
    main()
