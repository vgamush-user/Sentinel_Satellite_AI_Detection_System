"""Recorder: persists incidents and agent reports from Kafka into SQLite.

incidents + reports  ->  data/live/sentinel.db

The only writer to the database, so the website can show history after a
restart. Reads from the earliest uncommitted offset, and every write is an
idempotent upsert, so a restarted recorder simply catches up.

    python -m streaming.recorder
"""
from __future__ import annotations

import signal

from streaming.config import DB_PATH, TOPIC_INCIDENTS, TOPIC_REPORTS, from_bytes, log, make_consumer
from streaming.storage import connect, record_incident_event, record_report_event
from streaming.topics import ensure_topics

_running = True


def _stop(*_):
    global _running
    _running = False


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ensure_topics()
    conn = connect()
    consumer = make_consumer("sentinel-recorder", [TOPIC_INCIDENTS, TOPIC_REPORTS], offset_reset="earliest",
                             static=True)
    log("recorder", f"recording {TOPIC_INCIDENTS} + {TOPIC_REPORTS} -> {DB_PATH}")
    try:
        while _running:
            for m in consumer.consume(num_messages=200, timeout=0.5):
                if m.error():
                    continue
                try:
                    ev = from_bytes(m.value())
                    if m.topic() == TOPIC_INCIDENTS:
                        record_incident_event(conn, ev)
                    else:
                        record_report_event(conn, ev)
                except (ValueError, KeyError) as exc:
                    log("recorder", f"skipped malformed message: {exc!r}")
    finally:
        consumer.close()
        conn.close()
        log("recorder", "stopped")


if __name__ == "__main__":
    main()
