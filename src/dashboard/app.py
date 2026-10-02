"""
dashboard_app.py
-----------------
Gradio dashboard for the Telemetry-Replay Simulator (v1).

Connects to TelemetryReplaySimulator and visualizes the live stream:
live table of the most recent messages, rolling metric charts, and
basic run stats. This is purely a *viewer* — there is no anomaly
detection / agent logic here yet. The ground-truth "Label" column from
the dataset is shown as-is (it's part of the CSV) but nothing in this
app interprets or acts on it.

Run:
    pip install -r requirements.txt
    python dashboard_app.py

Then open the printed local URL in your browser.
"""

from __future__ import annotations

import sys
import json
from pathlib import Path
from collections import deque

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import gradio as gr
import pandas as pd

from simulator.telemetry_simulator import TelemetryReplaySimulator
from tools.monitor_tool import should_escalate, FEATURE_ORDER
from pipeline.full_pipeline import run_pipeline_for_window


# NOTE: defaults to the NOISED dataset, not raw. The Monitor Agent's baseline
# stats and every agent-pipeline test in this project were calibrated and
# verified against noised_dataset.csv specifically -- raw (clean simulated)
# data hits a ~100% in-domain "accuracy" that's a known simulator artifact,
# not a real result (see SentinelSat_6_Week_Plan). Demoing against raw data
# would misleadingly look near-perfect. Switch the CSV path field below if
# you specifically want to inspect the raw stream instead.
DATASETS = {
    "Noised telemetry (recommended)": PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv",
    "Raw simulated telemetry": PROJECT_ROOT / "data" / "raw" / "consolidated_dataset_raw.csv",
}
DEFAULT_DATASET = "Noised telemetry (recommended)"
DEFAULT_CSV = str(DATASETS[DEFAULT_DATASET])
ON_HF_SPACE = bool(os.environ.get("SPACE_ID"))
PLOT_HISTORY = 300  # points kept for the rolling charts

DEMO_CACHE_PATH = PROJECT_ROOT / "src" / "pipeline" / "demo_cache.json"
DEMO_CLASS_NAMES = ["Normal", "Storage Exhaustion", "Command Flooding", "Data Injection", "Defence Impairment"]

# Metrics worth watching on the dashboard out of the box. Deliberately only
# columns present in BOTH consolidated_dataset_raw.csv and noised_dataset.csv
# (noised has 22 of raw's 31 columns) -- CommandErrorCounter/MemoryPageFaults
# are raw-only and would silently chart empty now that noised is the default.
METRIC_CHOICES = [
    "MessageRateInWindow",
    "MemoryAnonMB",
    "MsgLength",
    "SlidingWindowMeanIntervalSec",
    "MemoryPageTableMB",
    "UniqueMessageIDsInWindow",
]

# ---------------------------------------------------------------------- #
# Single shared simulator instance (this is a single-user v1 demo — no
# per-session isolation yet).
# ---------------------------------------------------------------------- #
sim = TelemetryReplaySimulator(DEFAULT_CSV, buffer_size=100)
plot_history: deque = deque(maxlen=PLOT_HISTORY)


def do_load_csv(name: str):
    global sim, plot_history
    path = DATASETS.get(name)
    if path is None:  # nothing outside the allow-list can be loaded
        return "Unknown dataset."
    try:
        sim = TelemetryReplaySimulator(str(path), buffer_size=100)
        plot_history = deque(maxlen=PLOT_HISTORY)
        return f"Loaded **{name}** — {sim.total_rows:,} rows, {len(sim.df.columns)} columns."
    except Exception as e:
        # Full detail (which includes the file path) goes to server logs only.
        print(f"[dashboard] failed to load {path}: {e}")
        return f"Couldn't load **{name}**. Check the server logs."


def do_start(speed, order_mode, loop, buffer_size):
    global plot_history
    plot_history = deque(maxlen=PLOT_HISTORY)
    sim.configure(
        speed_rows_per_sec=speed,
        order_mode="sequential" if order_mode == "Sequential" else "shuffled",
        loop=loop,
        buffer_size=int(buffer_size),
    )
    sim.start()


def do_pause():
    sim.pause()


def do_resume():
    sim.resume()


def do_stop():
    sim.stop()


def do_apply_speed(speed, order_mode, loop, buffer_size):
    sim.configure(
        speed_rows_per_sec=speed,
        order_mode="sequential" if order_mode == "Sequential" else "shuffled",
        loop=loop,
        buffer_size=int(buffer_size),
    )


def do_run_agent_pipeline():
    """Manual trigger: runs the full 4-agent Groq pipeline on the most
    recently streamed row. Deliberately NOT automatic on every tick -- each
    run costs 4 Groq calls, so this is a click-to-run "demo mode" action,
    matching the project's cost-aware design (don't call the LLM on every
    packet, and don't burn a reviewer's Groq quota without them asking)."""
    snap = sim.snapshot()
    if snap.last_row is None:
        return "No rows streamed yet — start the simulator first.", ""

    row = snap.last_row
    window = {f: float(row[f]) for f in FEATURE_ORDER if f in row.index}
    true_label = int(row["Label"]) if "Label" in row.index else None
    would_escalate = should_escalate(window)

    if not would_escalate:
        return (
            f"Monitor Agent: this window looks nominal (would **not** normally escalate). "
            f"True label in data: {true_label}. Running full analysis anyway since you asked.",
            "",
        )

    result = run_pipeline_for_window(window)
    classification = result["classification"]
    header = (
        f"**Status:** {result['status']}  |  "
        f"**Detected:** {classification.predicted_class if classification else 'ERROR'}  |  "
        f"**Confidence:** {classification.confidence if classification else 'N/A'}  |  "
        f"**True label in data:** {true_label}"
    )
    return header, result["report"]


def do_show_demo_example(class_name: str):
    """Rate-limit-safe demo mode: reads a pre-computed example from
    demo_cache.json instead of calling Groq live. Lets a reviewer click
    through all 5 scenarios with zero API cost and zero rate-limit risk --
    no Groq key needed at all for this path."""
    if not DEMO_CACHE_PATH.exists():
        return "No demo cache found yet -- run `python src/pipeline/generate_demo_cache.py` first.", ""

    cache = json.loads(DEMO_CACHE_PATH.read_text())
    if class_name not in cache:
        return f"'{class_name}' not cached yet (cache generation may still be running).", ""

    entry = cache[class_name]
    c = entry["classification"]
    header = (
        f"**[CACHED EXAMPLE]** **Status:** {entry['status']}  |  "
        f"**Detected:** {c['predicted_class'] if c else 'ERROR'}  |  "
        f"**Confidence:** {c['confidence'] if c else 'N/A'}  |  "
        f"**True label:** {entry['true_label']} ({class_name})"
    )
    return header, entry["report"]


def poll(metric_a, metric_b):
    """Called on every timer tick to refresh the whole dashboard."""
    snap = sim.snapshot()

    # --- status line ---
    state = "FINISHED" if snap.finished else ("PAUSED" if snap.paused else ("RUNNING" if snap.running else "STOPPED"))
    pct = (snap.rows_emitted / snap.total_rows * 100) if snap.total_rows else 0
    status_md = (
        f"**State:** {state}  |  **Rows streamed:** {snap.rows_emitted:,} / {snap.total_rows:,} "
        f"({pct:.1f}%)  |  **Speed:** {snap.speed_rows_per_sec:.1f} rows/s  |  "
        f"**Order:** {snap.order_mode}  |  **Loop:** {snap.loop}  |  **Elapsed:** {snap.elapsed_sec:.1f}s"
    )

    # --- live table (most recent rows, newest first) ---
    if not snap.buffer.empty:
        table = snap.buffer.tail(20).iloc[::-1].reset_index(drop=True)
    else:
        table = snap.buffer

    # --- rolling metric history for charts ---
    if snap.last_row is not None:
        # only append a fresh point if a new row actually arrived
        if not plot_history or plot_history[-1]["_step"] != snap.rows_emitted:
            point = {"_step": snap.rows_emitted}
            for m in METRIC_CHOICES:
                if m in snap.last_row.index:
                    point[m] = snap.last_row[m]
            plot_history.append(point)

    hist_df = pd.DataFrame(list(plot_history)) if plot_history else pd.DataFrame(columns=["_step"] + METRIC_CHOICES)

    # --- ground-truth label mix currently in the live buffer (descriptive only) ---
    if not snap.buffer.empty and "Label" in snap.buffer.columns:
        counts = snap.buffer["Label"].value_counts().sort_index()
        label_df = pd.DataFrame({"Label": counts.index.astype(str), "Count": counts.values})
    else:
        label_df = pd.DataFrame(columns=["Label", "Count"])

    plot_a = gr.LinePlot(value=hist_df, x="_step", y=metric_a, title=metric_a) if metric_a in hist_df.columns else gr.LinePlot()
    plot_b = gr.LinePlot(value=hist_df, x="_step", y=metric_b, title=metric_b) if metric_b in hist_df.columns else gr.LinePlot()

    # --- cheap, deterministic Monitor Agent check on the latest row (no LLM
    # cost -- safe to run on every 0.5s tick, unlike the full agent pipeline) ---
    if snap.last_row is not None:
        window = {f: float(snap.last_row[f]) for f in FEATURE_ORDER if f in snap.last_row.index}
        escalate_md = (
            "🚨 **Monitor: would escalate to Classifier Agent**"
            if should_escalate(window)
            else "✅ Monitor: nominal, would not escalate"
        )
    else:
        escalate_md = "Monitor: waiting for data..."

    return status_md, table, plot_a, plot_b, label_df, escalate_md


with gr.Blocks(title="Telemetry Replay Simulator — Live Stream") as demo:
    gr.Markdown(
        "# 🛰️ Telemetry Replay Simulator — Live Stream\n"
        "Replays rows from the satellite bus telemetry CSV as a live stream at a "
        "configurable speed. This view is a pure passthrough — no anomaly detection "
        "or agent logic is applied here yet."
    )

    with gr.Accordion("Dataset", open=False, visible=not ON_HF_SPACE):
        with gr.Row():
            dataset = gr.Dropdown(list(DATASETS), value=DEFAULT_DATASET, label="Telemetry dataset", scale=3)
            load_btn = gr.Button("Load", scale=1)
    load_status = gr.Markdown(
        f"Loaded **{DEFAULT_DATASET}** — {sim.total_rows:,} rows, {len(sim.df.columns)} columns."
    )

    with gr.Row():
        speed = gr.Slider(1, 200, value=10, step=1, label="Speed (rows / sec)")
        order_mode = gr.Radio(["Sequential", "Shuffled"], value="Sequential", label="Playback order")
        loop = gr.Checkbox(value=True, label="Loop when finished")
        buffer_size = gr.Slider(20, 500, value=100, step=10, label="Live buffer size (rows)")

    with gr.Row():
        start_btn = gr.Button("▶ Start", variant="primary")
        pause_btn = gr.Button("⏸ Pause")
        resume_btn = gr.Button("⏵ Resume")
        stop_btn = gr.Button("⏹ Stop / Reset")

    status = gr.Markdown("**State:** STOPPED")

    gr.Markdown("### Live message stream (most recent first)")
    live_table = gr.Dataframe(headers=list(sim.df.columns), row_count=(20, "fixed"), wrap=True)

    gr.Markdown("### Rolling metrics")
    with gr.Row():
        metric_a = gr.Dropdown(METRIC_CHOICES, value="MessageRateInWindow", label="Chart 1 metric")
        metric_b = gr.Dropdown(METRIC_CHOICES, value="MemoryAnonMB", label="Chart 2 metric")
    with gr.Row():
        plot_a = gr.LinePlot(label="Chart 1")
        plot_b = gr.LinePlot(label="Chart 2")

    gr.Markdown("### Ground-truth label mix in current buffer (descriptive only, not a detection)")
    label_bar = gr.BarPlot(x="Label", y="Count", label=" ") if hasattr(gr, "BarPlot") else gr.Dataframe()

    gr.Markdown(
        "### 🤖 Agent Pipeline\n"
        "The escalation check below runs automatically on every row (free, no LLM). "
        "The full 5-agent analysis (Monitor → Classifier → SPARTA Analyst → Mitigation → "
        "Incident Reporter) is **click-to-run only** — it costs 4 Groq calls per click, "
        "so it never fires automatically."
    )
    escalation_indicator = gr.Markdown("Monitor: waiting for data...")
    analyze_btn = gr.Button("🔍 Run Full Agent Analysis on Latest Row", variant="primary")
    analysis_header = gr.Markdown("")
    analysis_report = gr.Markdown("")

    gr.Markdown(
        "#### 🎬 Demo Mode (no Groq key needed)\n"
        "Pre-computed example for each class — instant, zero API cost, zero rate-limit risk."
    )
    with gr.Row():
        demo_buttons = [gr.Button(name) for name in DEMO_CLASS_NAMES]

    # --- wiring ---
    load_btn.click(do_load_csv, inputs=[dataset], outputs=[load_status])

    start_btn.click(do_start, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    pause_btn.click(do_pause, inputs=[], outputs=[])
    resume_btn.click(do_resume, inputs=[], outputs=[])
    stop_btn.click(do_stop, inputs=[], outputs=[])
    speed.release(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    order_mode.change(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    loop.change(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])

    analyze_btn.click(do_run_agent_pipeline, inputs=[], outputs=[analysis_header, analysis_report])
    for btn, name in zip(demo_buttons, DEMO_CLASS_NAMES):
        btn.click(lambda n=name: do_show_demo_example(n), inputs=[], outputs=[analysis_header, analysis_report])

    timer = gr.Timer(0.5)
    timer.tick(
        poll,
        inputs=[metric_a, metric_b],
        outputs=[status, live_table, plot_a, plot_b, label_bar, escalation_indicator],
    )

if __name__ == "__main__":
    demo.queue().launch()
