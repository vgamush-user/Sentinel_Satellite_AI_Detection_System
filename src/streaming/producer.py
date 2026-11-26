"""Producer: replays a telemetry CSV into the telemetry.raw topic at a steady rate.

Modes:
  normal  - only Normal rows (default; for demos, attacks then come only from
            the website's inject panel / attack buttons / CLI)
  all     - every row in file order (the CSV is grouped by class, so attacks
            arrive as long blocks)
  shuffle - every row in random order

    python -m streaming.producer --speed 10 --mode normal
"""
from __future__ import annotations

import argparse
import random
import signal
import time
from pathlib import Path

from streaming.config import CLASS_NAMES, DATASETS, DEFAULT_DATASET, TOPIC_RAW, log
from streaming.inject import _get_producer, build_message, load_dataset, row_features, send_message
from streaming.topics import ensure_topics

_running = True


def _stop(*_):
    global _running
    _running = False


def main() -> None:
    ap = argparse.ArgumentParser(description="Replay telemetry into Kafka.")
    ap.add_argument("--dataset", default=DEFAULT_DATASET, help="noised | raw | path to CSV")
    ap.add_argument("--speed", type=float, default=10.0, help="rows per second")
    ap.add_argument("--mode", choices=["normal", "all", "shuffle"], default="normal")
    ap.add_argument("--no-loop", action="store_true", help="stop at the end instead of looping")
    args = ap.parse_args()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ensure_topics()

    df = load_dataset(args.dataset)
    replay_dataset = args.dataset if args.dataset in DATASETS else Path(args.dataset).name
    if args.mode == "normal":
        df = df[df["Label"] == 0].reset_index(drop=True)
    order = list(range(len(df)))
    producer = _get_producer()
    interval = 1.0 / max(args.speed, 0.1)

    log("producer", f"replaying {len(df)} rows ({args.dataset}, mode={args.mode}) "
                    f"at {args.speed:g} rows/s into {TOPIC_RAW}")
    seq = 0
    sent_since = 0
    t_report = time.time()
    next_send = time.monotonic()
    while _running:
        if args.mode == "shuffle":
            random.shuffle(order)
        for idx in order:
            if not _running:
                break
            row = df.iloc[idx]
            label = int(row["Label"])
            message = build_message(row_features(row), "replay", label, seq=seq)
            message["replay_dataset"] = replay_dataset
            send_message(message)
            producer.poll(0)
            seq += 1
            sent_since += 1

            now = time.time()
            if now - t_report >= 10:
                log("producer", f"{sent_since / (now - t_report):.1f} rows/s, total {seq}, last={CLASS_NAMES[label]}")
                sent_since, t_report = 0, now

            # Fixed-rate schedule: sleeping a constant interval would drift slower
            # by the time each send takes.
            next_send += interval
            delay = next_send - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_send = time.monotonic()
        if args.no_loop:
            break

    producer.flush(10)
    log("producer", f"stopped after {seq} rows")


if __name__ == "__main__":
    main()
