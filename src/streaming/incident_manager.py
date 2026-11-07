"""Incident manager: turns a stream of per-row predictions into incidents.

telemetry.scored  ->  grouping + false-alarm guards  ->  incidents

It never re-classifies: an incident's class is the class XGBoost predicted.

Rules (per satellite, values from streaming.config / env):
  * A row is attack EVIDENCE only if XGBoost predicted a non-Normal class
    with confidence >= INCIDENT_MIN_CONF (default 0.7).
  * An incident OPENS when INCIDENT_MIN_ROWS (5) of the last
    INCIDENT_WINDOW_ROWS (20) rows are evidence of the same class. A few
    stray or low-confidence rows open nothing. ("K of the last N" rather than
    "K in a row" because attack rows arrive interleaved with normal traffic.)
  * While open, later evidence of that class JOINS it. It CLOSES after
    INCIDENT_CLOSE_GAP_ROWS (40) rows in a row without its class, or
    INCIDENT_IDLE_CLOSE_SEC (30 s) without any row of its class.
  * If a different attack class reaches the threshold while one is open, the
    old incident closes and a new one opens.

Events published to the incidents topic (field "event"):
  opened, updated (at most 1/s while rows join), closed, and entry_decision
  (what happened to each hand-injected entry, for the website's tracker).

    python -m streaming.incident_manager
"""
from __future__ import annotations

import signal
import time
import uuid
from collections import deque
from dataclasses import dataclass, field

from streaming.config import (INCIDENT_CLOSE_GAP_ROWS, INCIDENT_IDLE_CLOSE_SEC, INCIDENT_MIN_CONF,
                              INCIDENT_MIN_ROWS, INCIDENT_WINDOW_ROWS, TOPIC_INCIDENTS, TOPIC_SCORED,
                              from_bytes, log, make_consumer, make_producer, to_bytes)
from streaming.topics import ensure_topics

_running = True


def _stop(*_):
    global _running
    _running = False


@dataclass
class Incident:
    incident_id: str
    satellite_id: str
    attack_class: str
    opened_ts: float
    last_match_ts: float
    row_count: int = 0
    conf_sum: float = 0.0
    peak_conf: float = 0.0
    sample_window: dict = field(default_factory=dict)   # features of the most confident row
    sample_entry_id: str = ""
    sample_true_class: str | None = None
    trigger_entry_ids: list = field(default_factory=list)
    rows_since_match: int = 0
    dirty: bool = False
    last_update_sent: float = 0.0

    def add(self, row: dict) -> None:
        self.row_count += 1
        self.conf_sum += row["confidence"]
        self.last_match_ts = time.time()
        self.rows_since_match = 0
        self.dirty = True
        if row["confidence"] > self.peak_conf:
            self.peak_conf = row["confidence"]
            self.sample_window = row["features"]
            self.sample_entry_id = row["entry_id"]
            self.sample_true_class = row.get("true_class")

    def summary(self) -> dict:
        return {
            "incident_id": self.incident_id,
            "satellite_id": self.satellite_id,
            "attack_class": self.attack_class,
            "opened_ts": self.opened_ts,
            "last_seen_ts": self.last_match_ts,
            "row_count": self.row_count,
            "peak_confidence": round(self.peak_conf, 4),
            "mean_confidence": round(self.conf_sum / max(1, self.row_count), 4),
        }


@dataclass
class SatelliteState:
    # Last INCIDENT_WINDOW_ROWS rows: (evidence class or None, row)
    window: deque = field(default_factory=lambda: deque(maxlen=INCIDENT_WINDOW_ROWS))
    open: Incident | None = None


class IncidentManager:
    def __init__(self, emit):
        self.emit = emit  # callable(event_dict)
        self.sats: dict[str, SatelliteState] = {}

    # ------------------------------------------------------------------ #
    def _open(self, st: SatelliteState, sat: str, cls: str) -> Incident:
        now = time.time()
        inc = Incident(
            incident_id=f"INC-{time.strftime('%H%M%S')}-{uuid.uuid4().hex[:4].upper()}",
            satellite_id=sat, attack_class=cls, opened_ts=now, last_match_ts=now,
        )
        trigger = [r for ev, r in st.window if ev == cls]
        for r in trigger:
            inc.add(r)
        inc.trigger_entry_ids = [r["entry_id"] for r in trigger]
        inc.dirty = False
        st.open = inc
        st.window.clear()
        self.emit({
            "event": "opened", **inc.summary(),
            "sample_window": inc.sample_window, "sample_entry_id": inc.sample_entry_id,
            "sample_true_class": inc.sample_true_class,
            "trigger_entry_ids": inc.trigger_entry_ids,
            "guards": {"min_confidence": INCIDENT_MIN_CONF, "min_rows": INCIDENT_MIN_ROWS,
                       "window_rows": INCIDENT_WINDOW_ROWS},
        })
        log("incidents", f"OPENED {inc.incident_id} {cls} on {sat} (peak conf {inc.peak_conf:.3f})")
        return inc

    def _close(self, st: SatelliteState, reason: str) -> None:
        inc = st.open
        if inc is None:
            return
        st.open = None
        now = time.time()
        self.emit({"event": "closed", **inc.summary(), "closed_ts": now,
                   "duration_sec": round(now - inc.opened_ts, 1), "close_reason": reason})
        log("incidents", f"CLOSED {inc.incident_id} {inc.attack_class}: {inc.row_count} rows, {reason}")

    def _decision(self, row: dict, decision: str, detail: str, incident_id: str | None = None) -> None:
        if row.get("source") == "replay":
            return  # only hand-injected entries are tracked on the website
        self.emit({"event": "entry_decision", "entry_id": row["entry_id"], "satellite_id": row["satellite_id"],
                   "burst_id": row.get("burst_id"), "decision": decision, "detail": detail,
                   "incident_id": incident_id})

    # ------------------------------------------------------------------ #
    def process(self, row: dict) -> None:
        sat = row["satellite_id"]
        st = self.sats.setdefault(sat, SatelliteState())
        cls, conf = row["predicted_class"], row["confidence"]
        evidence = cls if (cls != "Normal" and conf >= INCIDENT_MIN_CONF) else None

        # 1. An open incident absorbs evidence of its class; other rows count toward closing it.
        inc = st.open
        if inc is not None:
            if evidence == inc.attack_class:
                inc.add(row)
                self._decision(row, "joined", f"{cls} ({conf:.2f}) joined the open incident", inc.incident_id)
                return
            inc.rows_since_match += 1
            if inc.rows_since_match >= INCIDENT_CLOSE_GAP_ROWS:
                self._close(st, f"{INCIDENT_CLOSE_GAP_ROWS} rows in a row without {inc.attack_class}")

        st.window.append((evidence, row))

        # 2. Not attack evidence.
        if evidence is None:
            if cls == "Normal":
                self._decision(row, "normal", f"Normal ({conf:.2f}): no action")
            else:
                self._decision(row, "below_confidence",
                               f"{cls} at {conf:.2f} is below the {INCIDENT_MIN_CONF:.2f} confidence guard: not counted")
            return

        # 3. Attack evidence: enough of this class in the recent window?
        count = sum(1 for ev, _ in st.window if ev == evidence)
        if count < INCIDENT_MIN_ROWS:
            self._decision(row, "pending",
                           f"{cls} ({conf:.2f}): {count}/{INCIDENT_MIN_ROWS} {cls} rows in the last "
                           f"{INCIDENT_WINDOW_ROWS}; incident not opened yet")
            return

        if st.open is not None:  # a different class took over
            self._close(st, f"attack changed to {evidence}")
        new = self._open(st, sat, evidence)
        # Earlier rows of the trigger set got "pending"; the opened event's
        # trigger_entry_ids tells the website they belong to this incident.
        self._decision(row, "opened", f"{cls} ({conf:.2f}): {INCIDENT_MIN_ROWS} of the last "
                                      f"{INCIDENT_WINDOW_ROWS} rows, incident opened", new.incident_id)

    def tick(self) -> None:
        """Time-based housekeeping: idle close + throttled 'updated' events."""
        now = time.time()
        for st in self.sats.values():
            inc = st.open
            if inc is None:
                continue
            if now - inc.last_match_ts >= INCIDENT_IDLE_CLOSE_SEC:
                self._close(st, f"no {inc.attack_class} rows for {INCIDENT_IDLE_CLOSE_SEC:g}s")
            elif inc.dirty and now - inc.last_update_sent >= 1.0:
                inc.dirty = False
                inc.last_update_sent = now
                self.emit({"event": "updated", **inc.summary()})


def main() -> None:
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ensure_topics()
    consumer = make_consumer("sentinel-incident-manager", [TOPIC_SCORED], offset_reset="latest", static=True)
    producer = make_producer()

    def emit(event: dict) -> None:
        event["event_ts"] = time.time()
        key = event.get("incident_id") or event.get("entry_id") or ""
        producer.produce(TOPIC_INCIDENTS, key=key.encode(), value=to_bytes(event))
        producer.poll(0)

    mgr = IncidentManager(emit)
    log("incidents", f"grouping {TOPIC_SCORED} -> {TOPIC_INCIDENTS} (open: {INCIDENT_MIN_ROWS} of last "
                     f"{INCIDENT_WINDOW_ROWS} rows at conf >= {INCIDENT_MIN_CONF}; close after "
                     f"{INCIDENT_CLOSE_GAP_ROWS} quiet rows or {INCIDENT_IDLE_CLOSE_SEC:g}s)")
    try:
        while _running:
            for m in consumer.consume(num_messages=500, timeout=0.2):
                if m.error():
                    continue
                try:
                    mgr.process(from_bytes(m.value()))
                except (ValueError, KeyError) as exc:
                    log("incidents", f"skipped malformed message: {exc!r}")
            mgr.tick()
    finally:
        producer.flush(10)
        consumer.close()
        log("incidents", "stopped")


if __name__ == "__main__":
    main()
