# -*- coding: utf-8 -*-
"""
agents/test_pipeline.py
=======================
Tests the full pipeline (Day 3) using fake generated data.
No real CSV file needed.

Run: python agents/test_pipeline.py
"""

import sys, io, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import pandas as pd
import numpy as np
from rich.console import Console
from rich.panel import Panel

console = Console()


def generate_fake_dataset(n_rows: int = 530) -> str:
    """Generate a fake CuCD-ID-like CSV with 10 full windows (530 packets)."""
    np.random.seed(42)
    rows_per_class = n_rows // 5
    dfs = []
    for label in range(5):
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

    df = pd.concat(dfs, ignore_index=True)
    path = "data/pipeline_test_dataset.csv"
    os.makedirs("data", exist_ok=True)
    df.to_csv(path, index=False)
    return path


def test_tools_individually():
    """Test each tool in isolation before running the full pipeline."""
    console.print("[bold]Step 1: Testing individual tools...[/]\n")

    # Reset stream state for clean test
    from agents.tools import StreamState
    StreamState._instance = None

    from agents.tools import (
        StreamState, tool_get_next_window, tool_classify, tool_sparta_lookup
    )

    # Generate + load fake data
    path = generate_fake_dataset()
    state = StreamState.get()
    state.initialize(path, speed="instant")

    # Test Tool 1: TelemetryStreamTool
    result = tool_get_next_window(n_packets=53)
    assert result["status"] == "OK", f"TelemetryStreamTool failed: {result}"
    assert result["stream_status"]["window_ready"] == True
    console.print(f"  [green]TelemetryStreamTool[/] - window #{result['stream_status']['windows_completed']} ready")

    # Test Tool 2: ClassifierTool
    cls_result = tool_classify()
    assert cls_result["status"] == "OK"
    console.print(f"  [green]ClassifierTool[/] - predicted: {cls_result['prediction']['class_name']} "
                  f"(confidence: {cls_result['prediction']['confidence']:.2f})")

    # Test Tool 3: SpartaLookupTool
    label = cls_result["prediction"]["label"]
    sparta_result = tool_sparta_lookup(label)
    assert sparta_result["status"] == "OK"
    console.print(f"  [green]SpartaLookupTool[/] - tactic: {sparta_result['sparta_tactic']} | "
                  f"action: {sparta_result['recommended_action']}")

    console.print("\n  [bold green]All tools working[/]\n")
    return path


def test_full_pipeline(dataset_path: str):
    """Run the full pipeline for 5 windows and check output."""
    console.print("[bold]Step 2: Running full pipeline (5 windows)...[/]\n")

    # Reset state
    from agents.tools import StreamState
    StreamState._instance = None

    from agents.pipeline import run_pipeline
    incidents = run_pipeline(
        dataset_path=dataset_path,
        max_windows=5,
        speed="instant",
        show_live=False,
    )

    console.print(f"\n  [green]Pipeline ran successfully[/] - {len(incidents)} incidents generated")

    # Validate incident structure
    if incidents:
        sample = incidents[0]
        required_keys = ["incident_id", "severity", "attack_detected",
                         "sparta_tactic", "confidence", "action_taken"]
        for key in required_keys:
            assert key in sample, f"Missing key in incident: {key}"
        console.print(f"  [green]Incident structure valid[/] - all {len(required_keys)} fields present")
        console.print(f"\n  Sample incident:\n{json.dumps(incidents[0], indent=4)}")

    return incidents


if __name__ == "__main__":
    console.print(Panel.fit(
        "[bold cyan]Day 3 Pipeline Test[/]\n"
        "[dim]Simulator -> Tools -> Agents (fake data)[/]",
        border_style="cyan",
    ))

    path = test_tools_individually()
    incidents = test_full_pipeline(path)

    console.print(Panel(
        "[bold green]Day 3 Complete![/]\n\n"
        "All 5 pipeline stages work:\n"
        "  [green]1.[/] Monitor Agent   - reads telemetry stream\n"
        "  [green]2.[/] Classifier Agent - classifies window\n"
        "  [green]3.[/] SPARTA Analyst   - maps to SPARTA framework\n"
        "  [green]4.[/] Mitigation Agent - decides action with guardrails\n"
        "  [green]5.[/] Incident Reporter - generates incident report\n\n"
        "[dim]Next: replace stub classifier with real XGBoost model (Role A)[/]\n"
        "[dim]Then: Day 4 - attack scenario injector[/]",
        title="Test Complete",
        border_style="green",
    ))

    # Cleanup
    import os
    try:
        os.remove("data/pipeline_test_dataset.csv")
    except Exception:
        pass
