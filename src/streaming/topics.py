"""Create the pipeline's Kafka topics if they don't exist yet, and wait for the broker.

    python -m streaming.topics          (from src/)
"""
from __future__ import annotations

import time

from streaming.config import ALL_TOPICS, BOOTSTRAP, log

# Telemetry is high-volume and only useful briefly; incidents and reports are
# kept longer so a restarted service (or the recorder) can catch up.
_RETENTION_MS = {
    "telemetry.raw": 6 * 3600 * 1000,
    "telemetry.scored": 6 * 3600 * 1000,
    "incidents": 7 * 24 * 3600 * 1000,
    "reports": 7 * 24 * 3600 * 1000,
}


def wait_for_broker(timeout_sec: float = 60.0) -> None:
    from confluent_kafka.admin import AdminClient

    admin = AdminClient({"bootstrap.servers": BOOTSTRAP})
    deadline = time.time() + timeout_sec
    while True:
        try:
            admin.list_topics(timeout=3)
            return
        except Exception as exc:  # KafkaException while the broker is starting
            if time.time() > deadline:
                raise RuntimeError(
                    f"Kafka not reachable at {BOOTSTRAP}. Is Docker running? Try: docker compose up -d"
                ) from exc
            time.sleep(1)


def ensure_topics() -> None:
    from confluent_kafka.admin import AdminClient, NewTopic

    wait_for_broker()
    admin = AdminClient({"bootstrap.servers": BOOTSTRAP})
    existing = set(admin.list_topics(timeout=10).topics)
    missing = [t for t in ALL_TOPICS if t not in existing]
    if not missing:
        return
    futures = admin.create_topics([
        NewTopic(t, num_partitions=1, replication_factor=1,
                 config={"retention.ms": str(_RETENTION_MS[t])})
        for t in missing
    ])
    for topic, fut in futures.items():
        try:
            fut.result()
            log("topics", f"created {topic}")
        except Exception as exc:
            if "TOPIC_ALREADY_EXISTS" not in str(exc):
                raise


if __name__ == "__main__":
    ensure_topics()
    log("topics", "all topics present: " + ", ".join(ALL_TOPICS))
