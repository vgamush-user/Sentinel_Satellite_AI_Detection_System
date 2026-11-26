"""SQLite history of incidents and agent reports (data/live/sentinel.db).

Written only by the recorder service (single writer); read by the website.
WAL mode lets the website read while the recorder writes.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing

from streaming.config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    incident_id       TEXT PRIMARY KEY,
    satellite_id      TEXT,
    attack_class      TEXT,
    status            TEXT,          -- open | closed
    opened_ts         REAL,
    last_seen_ts      REAL,
    closed_ts         REAL,
    duration_sec      REAL,
    close_reason      TEXT,
    row_count         INTEGER,
    peak_confidence   REAL,
    mean_confidence   REAL,
    sample_window     TEXT,          -- JSON: the 22 features sent to the agents
    sample_true_class TEXT,
    trigger_entry_ids TEXT           -- JSON list
);
CREATE TABLE IF NOT EXISTS reports (
    incident_id     TEXT PRIMARY KEY,
    status          TEXT,            -- RUNNING | AUTONOMOUS | FLAGGED_FOR_REVIEW | ERROR
    mode            TEXT,            -- live | cached
    started_ts      REAL,
    finished_ts     REAL,
    runtime_sec     REAL,
    predicted_class TEXT,
    confidence      REAL,
    sparta_context  TEXT,
    mitigation      TEXT,
    report          TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_opened ON incidents(opened_ts DESC);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def record_incident_event(conn: sqlite3.Connection, ev: dict) -> None:
    kind = ev.get("event")
    if kind == "opened":
        conn.execute(
            """INSERT INTO incidents (incident_id, satellite_id, attack_class, status, opened_ts, last_seen_ts,
                   row_count, peak_confidence, mean_confidence, sample_window, sample_true_class, trigger_entry_ids)
               VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(incident_id) DO NOTHING""",
            (ev["incident_id"], ev["satellite_id"], ev["attack_class"], ev["opened_ts"], ev["last_seen_ts"],
             ev["row_count"], ev["peak_confidence"], ev["mean_confidence"], json.dumps(ev.get("sample_window")),
             ev.get("sample_true_class"), json.dumps(ev.get("trigger_entry_ids", []))),
        )
    elif kind == "updated":
        conn.execute(
            """UPDATE incidents SET last_seen_ts=?, row_count=?, peak_confidence=?, mean_confidence=?
               WHERE incident_id=? AND status='open'""",
            (ev["last_seen_ts"], ev["row_count"], ev["peak_confidence"], ev["mean_confidence"], ev["incident_id"]),
        )
    elif kind == "closed":
        conn.execute(
            """UPDATE incidents SET status='closed', last_seen_ts=?, closed_ts=?, duration_sec=?, close_reason=?,
                   row_count=?, peak_confidence=?, mean_confidence=?
               WHERE incident_id=?""",
            (ev["last_seen_ts"], ev["closed_ts"], ev["duration_sec"], ev["close_reason"], ev["row_count"],
             ev["peak_confidence"], ev["mean_confidence"], ev["incident_id"]),
        )
    conn.commit()


def record_report_event(conn: sqlite3.Connection, ev: dict) -> None:
    if ev.get("event") == "started":
        conn.execute(
            """INSERT INTO reports (incident_id, status, mode, started_ts) VALUES (?, 'RUNNING', ?, ?)
               ON CONFLICT(incident_id) DO UPDATE SET status='RUNNING', mode=excluded.mode,
                   started_ts=excluded.started_ts""",
            (ev["incident_id"], ev.get("mode"), ev.get("started_ts")),
        )
    elif ev.get("event") == "finished":
        conn.execute(
            """INSERT INTO reports (incident_id, status, mode, started_ts, finished_ts, runtime_sec,
                   predicted_class, confidence, sparta_context, mitigation, report)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(incident_id) DO UPDATE SET status=excluded.status, mode=excluded.mode,
                   finished_ts=excluded.finished_ts, runtime_sec=excluded.runtime_sec,
                   predicted_class=excluded.predicted_class, confidence=excluded.confidence,
                   sparta_context=excluded.sparta_context, mitigation=excluded.mitigation, report=excluded.report""",
            (ev["incident_id"], ev["status"], ev.get("mode"), ev.get("started_ts"), ev.get("finished_ts"),
             ev.get("runtime_sec"), ev.get("predicted_class"), ev.get("confidence"), ev.get("sparta_context"),
             ev.get("mitigation"), ev.get("report")),
        )
    conn.commit()


def _incident_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    for key in ("sample_window", "trigger_entry_ids"):
        if d.get(key):
            d[key] = json.loads(d[key])
    return d


_SELECT = """SELECT i.*, r.status AS report_status, r.mode AS report_mode, r.started_ts AS report_started_ts,
                    r.finished_ts AS report_finished_ts, r.runtime_sec AS report_runtime_sec,
                    r.predicted_class AS report_predicted_class, r.confidence AS report_confidence,
                    r.sparta_context, r.mitigation, r.report
             FROM incidents i LEFT JOIN reports r ON r.incident_id = i.incident_id"""


def list_incidents(limit: int = 50) -> list[dict]:
    with closing(connect()) as conn:
        rows = conn.execute(_SELECT + " ORDER BY i.opened_ts DESC LIMIT ?", (limit,)).fetchall()
    return [_incident_row(r) for r in rows]


def get_incident(incident_id: str) -> dict | None:
    with closing(connect()) as conn:
        row = conn.execute(_SELECT + " WHERE i.incident_id = ?", (incident_id,)).fetchone()
    return _incident_row(row) if row else None
