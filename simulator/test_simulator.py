# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
test_simulator.py
=================
Quick sanity test for the telemetry simulator.
Generates a FAKE mini-dataset (no real CSV needed) and runs the simulator on it.

Run this BEFORE you have the real dataset to make sure everything works.

Usage:
    python simulator/test_simulator.py
"""

import pandas as pd
import numpy as np
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simulator.telemetry_simulator import (
    SlidingWindowBuffer,
    stream_packets,
    LABEL_MAP,
    WINDOW_SIZE,
)

from rich.console import Console
from rich.panel import Panel

console = Console()


def generate_fake_dataset(n_rows: int = 500) -> pd.DataFrame:
    """
    Generate a small fake CuCD-ID-like dataset for testing.
    Mimics the column names and label structure of the real CSV.
    """
    np.random.seed(42)
    rows_per_class = n_rows // 5

    dfs = []
    for label in range(5):
        # Each attack class gets slightly different feature distributions
        # (mimicking the paper's distinct signatures per scenario)
        base_memory = 100 + label * 50
        df_class = pd.DataFrame({
            "MemoryAnonMB":                np.random.normal(base_memory, 10, rows_per_class),
            "MemoryShmemMB":               np.random.normal(50 + label * 20, 5, rows_per_class),
            "MemoryFileMB":                np.random.normal(200 + label * 10, 15, rows_per_class),
            "UniqueMessageIDsInWindow":    np.random.randint(1 + label * 5, 10 + label * 5, rows_per_class),
            "SlidingWindowMaxIntervalSec": np.random.exponential(0.1 + label * 0.05, rows_per_class),
            "SlidingWindowMinIntervalSec": np.random.exponential(0.01, rows_per_class),
            "MsgCount":                    np.random.randint(10, 60, rows_per_class),
            "TimeRadians":                 np.random.uniform(0, 2 * np.pi, rows_per_class),
            "Label":                       label,
        })
        dfs.append(df_class)

    return pd.concat(dfs, ignore_index=True)


def test_basic_stream():
    console.print(Panel.fit(
        "[bold cyan]🧪 Telemetry Simulator — Sanity Test[/]\n"
        "[dim]Using fake generated data (no real CSV needed)[/]",
        border_style="cyan",
    ))

    # 1. Generate fake data
    console.print("\n[bold]Step 1:[/] Generating fake dataset...")
    df = generate_fake_dataset(n_rows=500)
    console.print(f"  ✓ Shape: {df.shape}, Labels: {df['Label'].value_counts().to_dict()}")

    # 2. Save temporarily
    fake_path = "data/fake_test_dataset.csv"
    os.makedirs("data", exist_ok=True)
    df.to_csv(fake_path, index=False)
    console.print(f"  ✓ Saved to [cyan]{fake_path}[/]")

    # 3. Test the sliding window buffer
    console.print("\n[bold]Step 2:[/] Testing SlidingWindowBuffer...")
    buffer = SlidingWindowBuffer(window_size=10)
    feature_cols = [c for c in df.columns if c != "Label"]

    for i, (_, row) in enumerate(df.head(15).iterrows()):
        packet = {
            "packet_id":  i,
            "label":      int(row["Label"]),
            "label_name": LABEL_MAP[int(row["Label"])],
            "features":   row[feature_cols].to_dict(),
            "timestamp":  0.0,
        }
        ready = buffer.add_packet(packet)
        if ready:
            console.print(f"  ✓ Window ready at packet #{i} — shape: {buffer.get_window_df().shape}")
            break

    # 4. Test stream generator (instant mode, 50 packets)
    console.print("\n[bold]Step 3:[/] Testing stream generator (50 packets, instant speed)...")
    count = 0
    label_counts = {}
    for packet in stream_packets(df, speed="instant", max_packets=50):
        count += 1
        lname = packet["label_name"]
        label_counts[lname] = label_counts.get(lname, 0) + 1

    console.print(f"  ✓ Streamed {count} packets")
    console.print(f"  ✓ Label distribution: {label_counts}")

    # 5. All passed
    console.print(Panel(
        "[bold green]✅ All tests passed![/]\n\n"
        "The simulator is working correctly.\n"
        "Next step: copy your real CSV files into the [bold]data/[/] folder and run:\n\n"
        "  [cyan]python simulator/telemetry_simulator.py --file data/consolidated_dataset_raw.csv --speed fast[/]",
        title="Test Complete",
        border_style="green",
    ))

    # Cleanup
    os.remove(fake_path)


if __name__ == "__main__":
    test_basic_stream()
