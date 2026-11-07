"""Entry point for new telemetry: every way of getting data into the pipeline
(CSV replay, website panel, attack buttons, POST /api/ingest, this CLI) ends
up calling send_entries(), which writes to the telemetry.raw topic.

CLI examples (from src/):
    python -m streaming.inject --cls "Command Flooding" --count 30
    python -m streaming.inject --cls Normal --count 5
    python -m streaming.inject --random --count 1
"""
from __future__ import annotations

import argparse
import random
import time
import uuid
from functools import lru_cache

import pandas as pd

from streaming.config import (CLASS_NAMES, DATASETS, DEFAULT_DATASET, FEATURE_ORDER,
                              SATELLITE_ID, TOPIC_RAW, log, make_producer, to_bytes)

_producer = None


def _get_producer():
    global _producer
    if _producer is None:
        _producer = make_producer()
    return _producer


@lru_cache(maxsize=4)
def load_dataset(name: str = DEFAULT_DATASET) -> pd.DataFrame:
    path = DATASETS.get(name, name)
    df = pd.read_csv(path)
    df["Label"] = df["Label"].astype(int)
    return df.reset_index(drop=True)


def new_entry_id() -> str:
    return "e-" + uuid.uuid4().hex[:10]


def row_features(row: pd.Series) -> dict:
    return {f: float(row[f]) for f in FEATURE_ORDER}


def build_message(features: dict, source: str, true_label: int | None = None,
                  seq: int | None = None, entry_id: str | None = None,
                  burst_id: str | None = None) -> dict:
    missing = [f for f in FEATURE_ORDER if f not in features]
    if missing:
        raise ValueError(f"missing features: {', '.join(missing)}")
    return {
        "entry_id": entry_id or new_entry_id(),
        "satellite_id": SATELLITE_ID,
        "seq": seq,
        "ts": time.time(),
        "source": source,  # replay | panel | attack | api | cli
        "burst_id": burst_id,
        "features": {f: float(features[f]) for f in FEATURE_ORDER},
        "true_label": true_label,
        "true_class": CLASS_NAMES[true_label] if true_label is not None else None,
    }


def send_message(msg: dict) -> None:
    _get_producer().produce(TOPIC_RAW, key=msg["satellite_id"].encode(), value=to_bytes(msg))


def prepare_entries(feature_rows: list[dict], source: str, true_labels: list | None = None) -> list[dict]:
    """Build (and validate) the messages for a set of entries without sending them."""
    burst_id = "b-" + uuid.uuid4().hex[:8] if len(feature_rows) > 1 else None
    return [build_message(feats, source, true_labels[i] if true_labels else None, burst_id=burst_id)
            for i, feats in enumerate(feature_rows)]


def send_prepared(msgs: list[dict], interval_sec: float = 0.0) -> None:
    """Write prepared messages to telemetry.raw. interval_sec spaces them out so
    a burst looks like a real stream rather than one spike."""
    producer = _get_producer()
    for i, msg in enumerate(msgs):
        msg["ts"] = time.time()  # stamp at actual send time, for latency figures
        send_message(msg)
        producer.poll(0)
        if interval_sec and i < len(msgs) - 1:
            time.sleep(interval_sec)
    producer.flush(10)


def send_entries(feature_rows: list[dict], source: str, true_labels: list | None = None,
                 interval_sec: float = 0.0) -> list[str]:
    """Write entries to telemetry.raw and return their entry_ids (blocks until sent)."""
    msgs = prepare_entries(feature_rows, source, true_labels)
    send_prepared(msgs, interval_sec)
    return [m["entry_id"] for m in msgs]


def sample_rows(cls: str | None, count: int = 1, contiguous: bool = True,
                dataset: str = DEFAULT_DATASET) -> pd.DataFrame:
    """Real dataset rows of a class (cls=None = any class). Contiguous slices
    look like a genuine attack burst rather than randomly scattered rows."""
    df = load_dataset(dataset)
    pool = df if cls is None else df[df["Label"] == CLASS_NAMES.index(cls)]
    if pool.empty:
        raise ValueError(f"no rows for class {cls!r}")
    count = max(1, min(count, len(pool)))
    if contiguous:
        start = random.randint(0, len(pool) - count)
        return pool.iloc[start:start + count]
    return pool.sample(count)


def prepare_class(cls: str | None, count: int, source: str, dataset: str = DEFAULT_DATASET) -> list[dict]:
    rows = sample_rows(cls, count, contiguous=True, dataset=dataset)
    return prepare_entries([row_features(r) for _, r in rows.iterrows()], source,
                           [int(v) for v in rows["Label"]])


def inject_class(cls: str | None, count: int, source: str, interval_sec: float = 0.1,
                 dataset: str = DEFAULT_DATASET) -> list[str]:
    msgs = prepare_class(cls, count, source, dataset)
    send_prepared(msgs, interval_sec)
    return [m["entry_id"] for m in msgs]


def main() -> None:
    ap = argparse.ArgumentParser(description="Inject telemetry entries into the live pipeline.")
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--cls", choices=CLASS_NAMES, help="send real rows of this class")
    grp.add_argument("--random", action="store_true", help="send rows of any class")
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--interval", type=float, default=0.1, help="seconds between entries")
    ap.add_argument("--dataset", default=DEFAULT_DATASET)
    args = ap.parse_args()

    ids = inject_class(None if args.random else args.cls, args.count, "cli", args.interval, args.dataset)
    log("inject", f"sent {len(ids)} entr{'y' if len(ids) == 1 else 'ies'} "
                  f"({args.cls or 'random'}): {ids[0]}{' ... ' + ids[-1] if len(ids) > 1 else ''}")


if __name__ == "__main__":
    main()
