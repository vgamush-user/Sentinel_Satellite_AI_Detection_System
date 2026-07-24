# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
telemetry_simulator.py
======================
Role C — Systems/Simulation Lead | Day 1-3 Deliverable

Simulates a LIVE satellite telemetry stream by replaying the CuCD-ID dataset
row-by-row, as if packets are arriving from an orbiting CubeSat.

Features:
  - Stream any CSV (raw or noised dataset)
  - Configurable playback speed (real-time, fast, instant)
  - Inject specific attack scenarios on demand
  - Windowed packet grouping (mirrors the paper's 20-second sliding window)
  - Pretty terminal output with color-coded attack labels

Usage:
  python simulator/telemetry_simulator.py --file data/consolidated_dataset_raw.csv
  python simulator/telemetry_simulator.py --file data/noised_dataset.csv --speed fast
  python simulator/telemetry_simulator.py --file data/consolidated_dataset_raw.csv --scenario 2
"""

import argparse
import time
import sys
from pathlib import Path
from collections import deque
from typing import Generator, Optional

import pandas as pd
import numpy as np
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text
from rich import box
from rich.live import Live
from rich.layout import Layout
from rich.columns import Columns

# ──────────────────────────────────────────────────────────────────────────────
# CONSTANTS — directly from the CuCD-ID paper
# ──────────────────────────────────────────────────────────────────────────────

# Label integer → human-readable name (from paper Table 2)
LABEL_MAP = {
    0: "Normal",
    1: "Storage Exhaustion",
    2: "Command Flooding",
    3: "Data Injection",
    4: "Defence Impairment",
}

# Row ranges in the RAW dataset (paper Section 4.3 — contiguous blocks)
SCENARIO_RANGES = {
    0: (0,     4999,  "Normal"),
    1: (5000,  9999,  "Storage Exhaustion"),
    2: (10000, 14999, "Command Flooding"),
    3: (15000, 19999, "Data Injection"),
    4: (20000, 24999, "Defence Impairment"),
}

# Rich color per label for terminal display
LABEL_COLORS = {
    0: "green",
    1: "yellow",
    2: "red",
    3: "magenta",
    4: "dark_red",
}

# Playback speed → seconds between packets
SPEED_MAP = {
    "realtime": 0.5,   # ~0.5s gap between packets (simulates ~2 pkt/sec)
    "fast":     0.05,  # 50ms — fast but still visible
    "instant":  0.0,   # no delay — for testing
}

# Sliding window size (mirrors paper's 20-second / ~53-packet window)
WINDOW_SIZE = 53

console = Console()


# ──────────────────────────────────────────────────────────────────────────────
# DATA LOADING
# ──────────────────────────────────────────────────────────────────────────────

def load_dataset(filepath: str) -> pd.DataFrame:
    """Load and validate the CuCD-ID dataset CSV."""
    path = Path(filepath)
    if not path.exists():
        console.print(f"[bold red]ERROR:[/] File not found: {filepath}")
        console.print("[yellow]Tip:[/] Place your CSV files inside the [bold]data/[/] folder.")
        sys.exit(1)

    console.print(f"[cyan]Loading dataset:[/] {path.name} ...", end=" ")
    df = pd.read_csv(filepath)
    console.print(f"[green]✓[/] {len(df):,} rows, {len(df.columns)} columns")

    # Confirm Label column exists
    if "Label" not in df.columns:
        console.print("[bold red]ERROR:[/] No 'Label' column found. Check your CSV.")
        sys.exit(1)

    return df


def get_scenario_slice(df: pd.DataFrame, scenario_id: int) -> pd.DataFrame:
    """
    Extract only rows belonging to a specific scenario (attack type).
    Works on the raw dataset's known contiguous layout.
    For the noised dataset, filters by Label value instead.
    """
    if scenario_id not in SCENARIO_RANGES:
        console.print(f"[red]Invalid scenario ID: {scenario_id}. Choose 0-4.[/]")
        sys.exit(1)

    start, end, name = SCENARIO_RANGES[scenario_id]

    # Try index-based slice first (works for raw dataset)
    if len(df) >= end:
        slice_df = df.iloc[start:end + 1].copy()
        # Verify labels are consistent
        unique_labels = slice_df["Label"].unique()
        if len(unique_labels) == 1:
            console.print(f"[cyan]Scenario:[/] {name} (rows {start}–{end})")
            return slice_df

    # Fallback: filter by label value (works for noised dataset)
    label_val = scenario_id
    slice_df = df[df["Label"] == label_val].copy()
    console.print(f"[cyan]Scenario:[/] {name} ({len(slice_df):,} matching rows)")
    return slice_df


# ──────────────────────────────────────────────────────────────────────────────
# STREAM GENERATOR
# ──────────────────────────────────────────────────────────────────────────────

def stream_packets(
    df: pd.DataFrame,
    speed: str = "fast",
    start_row: int = 0,
    max_packets: Optional[int] = None,
) -> Generator[dict, None, None]:
    """
    Generator that yields one packet (row) at a time, simulating live telemetry.

    Yields:
        dict with keys: 'packet_id', 'label', 'label_name', 'features', 'timestamp'
    """
    delay = SPEED_MAP.get(speed, 0.05)
    df_stream = df.iloc[start_row:].reset_index(drop=True)

    feature_cols = [c for c in df.columns if c != "Label"]

    for i, row in df_stream.iterrows():
        if max_packets and i >= max_packets:
            break

        packet = {
            "packet_id":  start_row + i,
            "label":      int(row["Label"]),
            "label_name": LABEL_MAP.get(int(row["Label"]), "Unknown"),
            "features":   row[feature_cols].to_dict(),
            "timestamp":  time.time(),
        }

        yield packet

        if delay > 0:
            time.sleep(delay)


# ──────────────────────────────────────────────────────────────────────────────
# SLIDING WINDOW BUILDER
# ──────────────────────────────────────────────────────────────────────────────

class SlidingWindowBuffer:
    """
    Maintains a rolling buffer of the last WINDOW_SIZE packets.
    When full, exposes the window as a DataFrame for the Classifier Agent.

    This mirrors the paper's 20-second sliding window (~53 packets).
    """

    def __init__(self, window_size: int = WINDOW_SIZE):
        self.window_size = window_size
        self.buffer: deque = deque(maxlen=window_size)
        self.packet_count = 0

    def add_packet(self, packet: dict) -> bool:
        """Add a packet to the buffer. Returns True when a full window is ready."""
        self.buffer.append(packet["features"])
        self.packet_count += 1
        return len(self.buffer) == self.window_size

    def get_window_df(self) -> pd.DataFrame:
        """Return the current window as a DataFrame (for model input)."""
        return pd.DataFrame(list(self.buffer))

    def is_ready(self) -> bool:
        return len(self.buffer) == self.window_size

    @property
    def fill_level(self) -> float:
        return len(self.buffer) / self.window_size


# ──────────────────────────────────────────────────────────────────────────────
# TERMINAL DISPLAY
# ──────────────────────────────────────────────────────────────────────────────

def make_status_table(recent_packets: list, window_buffer: SlidingWindowBuffer) -> Table:
    """Build a Rich table showing the last N packets."""
    table = Table(
        title="📡 Live Telemetry Stream",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold cyan",
        expand=True,
    )
    table.add_column("Packet #",  style="dim",    width=10)
    table.add_column("Label",     style="bold",   width=20)
    table.add_column("MemoryAnonMB",              width=14)
    table.add_column("UniqueMsgIDs",              width=14)
    table.add_column("MaxInterval",               width=14)
    table.add_column("Window",    style="yellow", width=20)

    for pkt in recent_packets[-15:]:
        color = LABEL_COLORS.get(pkt["label"], "white")
        label_text = Text(pkt["label_name"], style=f"bold {color}")
        fill_pct = f"{window_buffer.fill_level * 100:.0f}%"

        table.add_row(
            str(pkt["packet_id"]),
            label_text,
            f"{pkt['features'].get('MemoryAnonMB', 'N/A'):.2f}"
                if isinstance(pkt['features'].get('MemoryAnonMB'), float) else "N/A",
            str(pkt['features'].get('UniqueMessageIDsInWindow', 'N/A')),
            f"{pkt['features'].get('SlidingWindowMaxIntervalSec', 'N/A'):.4f}"
                if isinstance(pkt['features'].get('SlidingWindowMaxIntervalSec'), float) else "N/A",
            f"[{'green' if window_buffer.is_ready() else 'yellow'}]{fill_pct} {'READY' if window_buffer.is_ready() else 'filling...'}[/]",
        )

    return table


# ──────────────────────────────────────────────────────────────────────────────
# SCENARIO INJECTION
# ──────────────────────────────────────────────────────────────────────────────

def inject_scenario(
    df: pd.DataFrame,
    scenario_id: int,
    n_packets: int = 200,
) -> pd.DataFrame:
    """
    Inject a scripted attack scenario into the stream.
    Returns a slice of packets for the given scenario type.
    Useful for testing the agent's response to a specific attack.
    """
    scenario_df = get_scenario_slice(df, scenario_id)
    return scenario_df.head(n_packets)


# ──────────────────────────────────────────────────────────────────────────────
# MAIN SIMULATOR ENTRY POINT
# ──────────────────────────────────────────────────────────────────────────────

def run_simulator(
    filepath: str,
    speed: str = "fast",
    scenario: Optional[int] = None,
    max_packets: Optional[int] = None,
    window_size: int = WINDOW_SIZE,
):
    """
    Main function to run the telemetry stream simulator.

    Args:
        filepath:    Path to the CuCD-ID CSV file.
        speed:       'realtime', 'fast', or 'instant'
        scenario:    If set (0-4), only stream packets from that attack scenario.
        max_packets: Stop after N packets (useful for testing).
        window_size: Number of packets per sliding window.
    """
    console.print(Panel.fit(
        "[bold cyan]🛰️  CubeSat Telemetry Stream Simulator[/]\n"
        "[dim]CuCD-ID Dataset Replay — Role C | Day 1-3[/]",
        border_style="cyan",
    ))

    # Load data
    df = load_dataset(filepath)

    # Optionally filter to one scenario
    if scenario is not None:
        df = get_scenario_slice(df, scenario)
        console.print(f"[yellow]⚡ Injecting scenario {scenario}: {LABEL_MAP[scenario]}[/]")
    else:
        console.print(f"[green]▶  Streaming all {len(df):,} packets ({speed} speed)[/]")

    # Init sliding window buffer
    window_buffer = SlidingWindowBuffer(window_size)
    recent_packets = []
    windows_ready = 0

    console.print(f"[dim]Window size: {window_size} packets | Speed: {speed}[/]\n")
    console.print("[bold]Starting stream... Press Ctrl+C to stop.[/]\n")
    time.sleep(1)

    # Stream packets
    with Live(console=console, refresh_per_second=10) as live:
        try:
            for packet in stream_packets(df, speed=speed, max_packets=max_packets):
                recent_packets.append(packet)

                # Update sliding window
                window_ready = window_buffer.add_packet(packet)
                if window_ready:
                    windows_ready += 1

                # Refresh display
                live.update(make_status_table(recent_packets, window_buffer))

        except KeyboardInterrupt:
            console.print("\n[yellow]Stream stopped by user.[/]")

    # Summary
    console.print(Panel(
        f"[bold green]Stream Complete[/]\n"
        f"  Packets streamed : [cyan]{len(recent_packets):,}[/]\n"
        f"  Full windows seen: [cyan]{windows_ready:,}[/]\n"
        f"  Final label      : [cyan]{recent_packets[-1]['label_name'] if recent_packets else 'N/A'}[/]",
        title="📊 Summary",
        border_style="green",
    ))

    return recent_packets, window_buffer


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="CubeSat Telemetry Stream Simulator (CuCD-ID dataset)"
    )
    parser.add_argument(
        "--file", "-f",
        required=True,
        help="Path to the CuCD-ID CSV file (raw or noised).",
    )
    parser.add_argument(
        "--speed", "-s",
        choices=["realtime", "fast", "instant"],
        default="fast",
        help="Playback speed: realtime (0.5s/pkt), fast (0.05s/pkt), instant (no delay).",
    )
    parser.add_argument(
        "--scenario", "-sc",
        type=int,
        choices=[0, 1, 2, 3, 4],
        default=None,
        help=(
            "Inject a specific scenario only:\n"
            "  0=Normal, 1=Storage Exhaustion, 2=Command Flooding,\n"
            "  3=Data Injection, 4=Defence Impairment"
        ),
    )
    parser.add_argument(
        "--max", "-m",
        type=int,
        default=None,
        help="Stop after N packets (useful for quick testing).",
    )
    parser.add_argument(
        "--window", "-w",
        type=int,
        default=WINDOW_SIZE,
        help=f"Sliding window size in packets (default: {WINDOW_SIZE}).",
    )

    args = parser.parse_args()
    run_simulator(
        filepath=args.file,
        speed=args.speed,
        scenario=args.scenario,
        max_packets=args.max,
        window_size=args.window,
    )
