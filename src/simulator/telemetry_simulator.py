"""
telemetry_simulator.py
-----------------------
Telemetry-Replay Simulator v1

Reads rows from a CSV (e.g. Sentinel_Satellite_AI_Detection_System's
consolidated_dataset_raw.csv — CCSDS-style satellite bus telemetry/command
messages) and replays them as a live stream at a configurable speed.

This module is intentionally "dumb": it does not classify, score, or flag
anything. It just plays back rows in order (or shuffled) at a controllable
rate, and exposes a thread-safe snapshot() so a UI (Gradio, CLI, etc.) can
poll it. Any anomaly-detection / agent logic gets layered on top later.

Usage (standalone smoke test):
    python telemetry_simulator.py path/to/consolidated_dataset_raw.csv
"""

from __future__ import annotations

import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd


@dataclass
class SimulatorSnapshot:
    """Immutable-ish view of simulator state at a point in time."""
    running: bool
    paused: bool
    finished: bool
    total_rows: int
    rows_emitted: int
    cursor: int
    speed_rows_per_sec: float
    order_mode: str
    loop: bool
    elapsed_sec: float
    buffer: pd.DataFrame          # most recent N rows emitted (live view)
    last_row: Optional[pd.Series] # the single most recently emitted row


class TelemetryReplaySimulator:
    """
    Streams rows of a CSV file at a configurable rate on a background thread.

    Thread-safety: all mutable state is guarded by self._lock. Public methods
    are safe to call from the Gradio callback thread while the replay loop
    runs in its own daemon thread.
    """

    def __init__(self, csv_path: str, buffer_size: int = 200):
        self.csv_path = csv_path
        self.df: pd.DataFrame = pd.read_csv(csv_path)
        self.total_rows: int = len(self.df)
        self.buffer_size = buffer_size

        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Mutable state (guarded by _lock)
        self._indices: list[int] = list(range(self.total_rows))
        self._cursor: int = 0
        self._rows_emitted: int = 0
        self._buffer: deque = deque(maxlen=self.buffer_size)
        self._running: bool = False
        self._paused: bool = False
        self._finished: bool = False
        self._speed: float = 10.0  # rows per second
        self._order_mode: str = "sequential"
        self._loop: bool = True
        self._start_wall_time: Optional[float] = None
        self._end_wall_time: Optional[float] = None  # set when playback finishes, freezes elapsed
        self._paused_accum: float = 0.0
        self._pause_started_at: Optional[float] = None

    # ------------------------------------------------------------------ #
    # Control API
    # ------------------------------------------------------------------ #
    def configure(
        self,
        speed_rows_per_sec: float,
        order_mode: str = "sequential",
        loop: bool = True,
        buffer_size: Optional[int] = None,
    ) -> None:
        """Set playback parameters. Safe to call before start() or mid-stream."""
        with self._lock:
            self._speed = max(0.1, float(speed_rows_per_sec))
            self._order_mode = order_mode
            self._loop = loop
            if buffer_size and buffer_size != self.buffer_size:
                self.buffer_size = buffer_size
                self._buffer = deque(self._buffer, maxlen=buffer_size)

    def start(self) -> None:
        """(Re)start playback from row 0 with current configuration."""
        with self._lock:
            self._stop_thread_locked()
            self._indices = (
                list(range(self.total_rows))
                if self._order_mode == "sequential"
                else random.sample(range(self.total_rows), self.total_rows)
            )
            self._cursor = 0
            self._rows_emitted = 0
            self._buffer.clear()
            self._finished = False
            self._paused = False
            self._paused_accum = 0.0
            self._pause_started_at = None
            self._start_wall_time = time.monotonic()
            self._end_wall_time = None
            self._running = True
            # Fresh event per playback thread: clearing a shared event here
            # would let the previous thread (not yet exited) keep running
            # alongside the new one, doubling the emit rate.
            self._stop_event = threading.Event()
            self._thread = threading.Thread(target=self._run_loop, args=(self._stop_event,), daemon=True)
            self._thread.start()

    def pause(self) -> None:
        with self._lock:
            if self._running and not self._paused:
                self._paused = True
                self._pause_started_at = time.monotonic()

    def resume(self) -> None:
        with self._lock:
            if self._running and self._paused:
                self._paused = False
                if self._pause_started_at is not None:
                    self._paused_accum += time.monotonic() - self._pause_started_at
                    self._pause_started_at = None

    def stop(self) -> None:
        """Stop and reset playback entirely."""
        with self._lock:
            self._stop_thread_locked()
            self._cursor = 0
            self._rows_emitted = 0
            self._buffer.clear()
            self._running = False
            self._paused = False
            self._finished = False
            self._start_wall_time = None
            self._end_wall_time = None
            self._paused_accum = 0.0
            self._pause_started_at = None

    def _stop_thread_locked(self) -> None:
        # Not joined: the run loop needs this lock, so it exits on its own
        # once it sees its event set.
        self._stop_event.set()
        self._running = False

    # ------------------------------------------------------------------ #
    # Playback loop (background thread)
    # ------------------------------------------------------------------ #
    def _run_loop(self, stop_event: threading.Event) -> None:
        while not stop_event.is_set():
            with self._lock:
                paused = self._paused
                cursor = self._cursor
                speed = self._speed
                loop = self._loop

            if paused:
                time.sleep(0.05)
                continue

            if cursor >= self.total_rows:
                if loop:
                    with self._lock:
                        self._indices = (
                            list(range(self.total_rows))
                            if self._order_mode == "sequential"
                            else random.sample(range(self.total_rows), self.total_rows)
                        )
                        self._cursor = 0
                    continue
                else:
                    with self._lock:
                        self._finished = True
                        self._running = False
                        self._end_wall_time = time.monotonic()
                    return

            row = self.df.iloc[self._indices[cursor]]
            with self._lock:
                if stop_event.is_set():  # stopped/restarted while we read the row
                    return
                self._buffer.append(row)
                self._rows_emitted += 1
                self._cursor += 1

            time.sleep(1.0 / speed)

    # ------------------------------------------------------------------ #
    # Read API
    # ------------------------------------------------------------------ #
    def snapshot(self) -> SimulatorSnapshot:
        with self._lock:
            elapsed = 0.0
            if self._start_wall_time is not None:
                now = self._end_wall_time if self._end_wall_time is not None else time.monotonic()
                pause_time = self._paused_accum
                if self._paused and self._pause_started_at is not None:
                    pause_time += now - self._pause_started_at
                elapsed = now - self._start_wall_time - pause_time

            buf_df = pd.DataFrame(list(self._buffer)) if self._buffer else pd.DataFrame(columns=self.df.columns)
            last_row = self._buffer[-1] if self._buffer else None

            return SimulatorSnapshot(
                running=self._running,
                paused=self._paused,
                finished=self._finished,
                total_rows=self.total_rows,
                rows_emitted=self._rows_emitted,
                cursor=self._cursor,
                speed_rows_per_sec=self._speed,
                order_mode=self._order_mode,
                loop=self._loop,
                elapsed_sec=elapsed,
                buffer=buf_df,
                last_row=last_row,
            )


if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "consolidated_dataset_raw.csv"
    sim = TelemetryReplaySimulator(path, buffer_size=20)
    sim.configure(speed_rows_per_sec=20, order_mode="sequential", loop=False)
    sim.start()
    print(f"Streaming {sim.total_rows} rows from {path} ...")
    while True:
        snap = sim.snapshot()
        print(f"\remitted={snap.rows_emitted}/{snap.total_rows} elapsed={snap.elapsed_sec:.1f}s", end="")
        if snap.finished:
            print("\nDone.")
            break
        time.sleep(0.2)
