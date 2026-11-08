"""
app.py
------
Gradio walkthrough and manual analysis for replayed CubeSat telemetry.

Run:
    pip install -r requirements.txt
    python src/dashboard/app.py

Then open the printed local URL in your browser.
"""

from __future__ import annotations

import sys
import os
import json
from inspect import signature
from pathlib import Path
from collections import deque

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import gradio as gr
import pandas as pd

from simulator.telemetry_simulator import TelemetryReplaySimulator
from tools.monitor_tool import should_escalate, FEATURE_ORDER
from pipeline.full_pipeline import run_pipeline_for_window
from tools.mitigation_tool import decide_mitigation


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
        new_sim = TelemetryReplaySimulator(str(path), buffer_size=100)
        sim.stop()  # otherwise the old playback thread keeps running, orphaned
        sim = new_sim
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


CONFIDENCE_NOTE = (
    "Model confidence is a score, not the probability that an event is malicious. "
    "A high score can still be wrong."
)


def result_summary(mode, dataset_label, prediction, confidence, status, evidence):
    review = {
        "FLAGGED_FOR_REVIEW": "Awaiting review",
        "AUTONOMOUS": "Policy result available for review",
        "ERROR": "Analysis failed",
    }.get(status, "Unavailable")
    return (
        f"**{mode}**\n\n### Prediction and review\n\n"
        f"**Predicted class:** {prediction or 'Unavailable'}  \n"
        f"**Model confidence:** {confidence if confidence is not None else 'Unavailable'}  \n"
        f"**Review signal:** {review}\n\n{CONFIDENCE_NOTE}"
        + ("\n\nNo attack class was predicted. This is not a guarantee of safety."
           if prediction == "Normal" else "")
        + f"\n\n### Evidence\n\n**Ground truth (dataset):** {dataset_label}  \n{evidence}"
    )


def analysis_trace(monitor, result=None):
    """Describe only the stage evidence available to the dashboard."""
    pending = "Waiting for analysis output" if result is None else "Output unavailable"
    outputs = result or {}
    return "\n".join((
        f"1. **Monitor** — {monitor.removeprefix('Monitor: ')}",
        f"2. **Classifier** — {'Prediction returned' if outputs.get('classification') else pending}",
        f"3. **SPARTA Analyst** — {'Context returned' if outputs.get('sparta_context') else pending}",
        f"4. **Mitigation** — {'Policy explanation returned' if outputs.get('mitigation') else pending}",
        f"5. **Incident Reporter** — {'Narrative returned' if outputs.get('report') and outputs.get('status') != 'ERROR' else pending}",
    ))


def do_run_agent_pipeline():
    """Analyze the latest replay row only on explicit request."""
    if not os.environ.get("GROQ_API_KEY"):
        yield "Live analysis is unavailable on this server. Try a cached scenario in Overview.", gr.skip(), gr.skip(), gr.skip(), gr.skip()
        return

    snap = sim.snapshot()
    if snap.last_row is None:
        yield "No telemetry window selected. Start playback in Telemetry first.", gr.skip(), gr.skip(), gr.skip(), gr.skip()
        return

    row = snap.last_row
    window = {f: float(row[f]) for f in FEATURE_ORDER if f in row.index}
    label_index = int(row["Label"]) if "Label" in row.index else -1
    dataset_label = DEMO_CLASS_NAMES[label_index] if 0 <= label_index < len(DEMO_CLASS_NAMES) else "Unavailable"
    monitor = ("Monitor: escalation criteria met." if should_escalate(window)
               else "Monitor: did not escalate. Analysis requested manually.")
    window_note = f"Replay window selected at submission · message ID {int(window['MsgId'])}."
    yield (f"**Live analysis running**\n\n{window_note} {monitor} "
           "Any result shown below belongs to the previous run.",
           gr.skip(), gr.skip(), gr.skip(), analysis_trace(monitor))

    try:
        result = run_pipeline_for_window(window)
        classification = result["classification"]
        if result["status"] == "ERROR" or classification is None:
            diagnostic = str(result.get("report", "")).lower()
            limited = any(term in diagnostic for term in ("rate limit", "rate_limit", "429"))
            reason = ("The analysis provider is temporarily rate-limited. Wait and try again."
                      if limited else "The analysis returned incomplete or invalid output. Try again or explore a cached scenario.")
            yield f"**Analysis failed.** {reason} Any previous result is kept below.\n\n{monitor}", gr.skip(), gr.skip(), gr.skip(), analysis_trace(monitor, result)
            return
        prediction, confidence = classification.predicted_class, classification.confidence
        policy = decide_mitigation(prediction, confidence)
        policy_text = (f"`{policy['action']}` · policy lookup for the returned score. {policy['guardrail_note']}"
                       if "action" in policy else "Policy details unavailable.")
        if result["status"] == "FLAGGED_FOR_REVIEW":
            policy_text += " The run was flagged for review."
        summary = result_summary("Live analysis · Replay window", dataset_label, prediction, confidence,
                                 result["status"], f"{window_note} {monitor}")
        policy_summary = f"### Policy outcome\n\n{policy_text} Policy outputs describe simulated actions."
        narrative = (
            f"#### Incident narrative\n{result.get('report') or 'Unavailable'}\n\n"
            f"#### SPARTA threat context\n{result.get('sparta_context') or 'Unavailable'}\n\n"
            f"#### Policy explanation\n{result.get('mitigation') or 'Unavailable'}"
        )
        yield "Analysis complete.", summary, policy_summary, narrative, analysis_trace(monitor, result)
    except Exception as exc:
        print(f"[dashboard] agent pipeline failed: {exc!r}")
        yield "This analysis couldn’t finish. Any previous result is kept below. Try again or explore a cached scenario.", gr.skip(), gr.skip(), gr.skip(), analysis_trace(monitor, {})


def do_show_demo_example(class_name: str):
    """Read an existing example without invoking the analysis provider."""
    try:
        entry = json.loads(DEMO_CACHE_PATH.read_text(encoding="utf-8"))[class_name]
        classification = entry.get("classification") or {}
        summary = result_summary(
            "Cached example", class_name, classification.get("predicted_class"),
            classification.get("confidence"), entry["status"],
            "Raw telemetry and the Monitor decision are unavailable for this cached example.",
        )
        return (
            summary,
            "### Policy outcome\n\nStructured policy details are unavailable. "
            "The cached explanation describes simulated actions.",
            f"#### Incident narrative\n{entry.get('report') or 'Unavailable'}\n\n"
            f"#### SPARTA threat context\n{entry.get('sparta_context') or 'Unavailable'}\n\n"
            f"#### Policy explanation\n{entry.get('mitigation') or 'Unavailable'}",
        )
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return "This cached scenario couldn’t load. Try again or select another example.", gr.skip(), gr.skip()


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

    # Always float-typed, including when empty: an untyped empty frame is sent
    # to the browser as 'nominal', and the chart then keeps a categorical
    # (unsorted, evenly spaced) y-axis even after real numbers arrive.
    hist_cols = ["_step"] + METRIC_CHOICES
    hist_df = (
        pd.DataFrame(list(plot_history), columns=hist_cols) if plot_history else pd.DataFrame(columns=hist_cols)
    ).astype("float64")

    # --- ground-truth label mix currently in the live buffer (descriptive only) ---
    if not snap.buffer.empty and "Label" in snap.buffer.columns:
        counts = snap.buffer["Label"].value_counts().sort_index()
        # Labels are stored as floats (0.0..4.0); show them as "0".."4".
        labels = [str(int(v)) if float(v).is_integer() else str(v) for v in counts.index]
        label_df = pd.DataFrame({"Label": labels, "Count": counts.values})
    else:
        # Typed empty frame for the same reason as hist_df above.
        label_df = pd.DataFrame({"Label": pd.Series(dtype="str"), "Count": pd.Series(dtype="int64")})

    plot_a = gr.LinePlot(value=hist_df, x="_step", y=metric_a, title=metric_a) if metric_a in hist_df.columns else gr.LinePlot()
    plot_b = gr.LinePlot(value=hist_df, x="_step", y=metric_b, title=metric_b) if metric_b in hist_df.columns else gr.LinePlot()

    # --- cheap, deterministic Monitor Agent check on the latest row (no LLM
    # cost -- safe to run on every 0.5s tick, unlike the full agent pipeline) ---
    if snap.last_row is not None:
        window = {f: float(snap.last_row[f]) for f in FEATURE_ORDER if f in snap.last_row.index}
        escalate_md = (
            "**Monitor: escalation criteria met**"
            if should_escalate(window)
            else "**Monitor: did not escalate**"
        )
    else:
        escalate_md = "Monitor: waiting for data..."

    controls = (
        gr.update(interactive=state in {"STOPPED", "FINISHED"}),
        gr.update(interactive=state == "RUNNING"),
        gr.update(interactive=state == "PAUSED"),
        gr.update(interactive=state != "STOPPED"),
    )
    return status_md, table, plot_a, plot_b, label_df, escalate_md, *controls


DASHBOARD_THEME = gr.themes.Soft(primary_hue="teal", neutral_hue="gray").set(
    body_background_fill="#F7F9F7",
    body_text_color="#19332F",
    button_primary_background_fill="#237A70",
    button_primary_text_color="#FFFFFF",
)
THEME_IN_BLOCKS = "theme" in signature(gr.Blocks).parameters

with gr.Blocks(title="SentinelSat · CubeSat telemetry security",
               **({"theme": DASHBOARD_THEME} if THEME_IN_BLOCKS else {})) as demo:
    gr.Markdown("# SentinelSat\nCubeSat telemetry security")
    with gr.Tab("Overview"):
        gr.Markdown(
            "## Understand what’s happening in your telemetry.\n"
            "Explore simulated CubeSat telemetry, potential attack classifications, "
            "and confidence-aware policy decisions.\n\n"
            "### Start with a sample scenario\n"
            "**Cached demo** · Precomputed examples. No API key needed."
        )
        with gr.Row():
            demo_buttons = []
            for name in DEMO_CLASS_NAMES:
                with gr.Column(min_width=150):
                    gr.Markdown(f"**{name}**")
                    demo_buttons.append(gr.Button(f"Explore sample: {name}"))
        demo_header = gr.Markdown("")
        demo_policy = gr.Markdown("")
        with gr.Accordion("AI narrative", open=False):
            demo_report = gr.Markdown("")
    with gr.Tab("Telemetry"):
        gr.Markdown("## Telemetry replay\nRows are replayed from a simulated telemetry dataset.")
        with gr.Accordion("Dataset", open=False, visible=not ON_HF_SPACE):
            with gr.Row():
                dataset = gr.Dropdown(list(DATASETS), value=DEFAULT_DATASET, label="Telemetry dataset", scale=3)
                load_btn = gr.Button("Load", scale=1)
        load_status = gr.Markdown(
            f"Loaded **{DEFAULT_DATASET}** — {sim.total_rows:,} rows, {len(sim.df.columns)} columns."
        )

        with gr.Accordion("Replay settings", open=False):
            with gr.Row():
                speed = gr.Slider(1, 200, value=10, step=1, label="Speed (rows / sec)")
                order_mode = gr.Radio(["Sequential", "Shuffled"], value="Sequential", label="Playback order")
                loop = gr.Checkbox(value=True, label="Loop when finished")
                buffer_size = gr.Slider(20, 500, value=100, step=10, label="Replay buffer size (rows)")

        with gr.Row():
            start_btn = gr.Button("▶ Start", variant="primary")
            pause_btn = gr.Button("Pause", interactive=False)
            resume_btn = gr.Button("Resume", interactive=False)
            stop_btn = gr.Button("Stop / Reset", interactive=False)

        status = gr.Markdown("**State:** STOPPED")

        gr.Markdown("### Rolling metrics")
        with gr.Row():
            metric_a = gr.Dropdown(METRIC_CHOICES, value="MessageRateInWindow", label="Chart 1 metric")
            metric_b = gr.Dropdown(METRIC_CHOICES, value="MemoryAnonMB", label="Chart 2 metric")
        with gr.Row():
            plot_a = gr.LinePlot(label="Chart 1")
            plot_b = gr.LinePlot(label="Chart 2")

        with gr.Accordion("Recent replayed telemetry rows", open=False):
            live_table = gr.Dataframe(headers=list(sim.df.columns), row_count=(20, "fixed"), wrap=True)

        gr.Markdown("### Ground-truth label mix in current buffer (descriptive only, not a detection)")
        # y_lim starts the axis at 0: Vega otherwise zooms to [min, max] count,
        # hiding the smallest bar entirely and exaggerating the differences.
        label_bar = gr.BarPlot(x="Label", y="Count", label=" ", y_lim=[0, None]) if hasattr(gr, "BarPlot") else gr.Dataframe()

    with gr.Tab("Analyze"):
        gr.Markdown(
            "## Analyze a telemetry window\n"
            "Live analysis uses the latest replay row at the time you submit. "
            "The Monitor screens the row automatically. The remaining four stages run only on request."
        )
        with gr.Accordion("Analysis stages", open=True):
            trace = gr.Markdown(analysis_trace("Monitor: waiting for an analysis request."))
        escalation_indicator = gr.Markdown("Monitor: waiting for replay data.")
        analyze_btn = gr.Button("Run full agent analysis", variant="primary",
                                interactive=bool(os.environ.get("GROQ_API_KEY")))
        if not os.environ.get("GROQ_API_KEY"):
            gr.Markdown("Live analysis is unavailable on this server. Cached examples are available in Overview.")
        analysis_status = gr.Markdown("")
        analysis_header = gr.Markdown("")
        analysis_policy = gr.Markdown("")
        with gr.Accordion("AI narrative", open=False):
            analysis_report = gr.Markdown("")
    with gr.Tab("How it works"):
        gr.Markdown(
            "## Hosted demo · Five-stage analysis\n"
            "The statistical Monitor screens the replayed window. On request, the Classifier, "
            "SPARTA Analyst, Mitigation and Incident Reporter return outputs for review.\n\n"
            "## Web workspace · Kafka telemetry replay\n"
            "The separate web workspace scores replay and test rows, then opens incidents "
            "using its configured confidence and row-count guards.\n\n"
            "## Reported model evaluation\n"
            "**68.9% domain-shift accuracy · 0.697 macro F1.** The project report describes training "
            "on clean simulated telemetry and evaluating on noised telemetry. Near-perfect clean "
            "in-domain performance is a simulator ceiling and an unsuitable generalization estimate.\n\n"
            "### Why review matters\n"
            "The reported experiment counted 1,786 Normal windows predicted as Data Injection. "
            "An adversarial Command Flooding and Data Injection blend produced a 0.999-confidence prediction. "
            "SPARTA mapping provides context for review and does not establish attribution. "
            "Per-window feature attribution is unavailable."
        )

    # --- wiring ---
    load_btn.click(do_load_csv, inputs=[dataset], outputs=[load_status])

    start_btn.click(do_start, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    pause_btn.click(do_pause, inputs=[], outputs=[])
    resume_btn.click(do_resume, inputs=[], outputs=[])
    stop_btn.click(do_stop, inputs=[], outputs=[])
    speed.release(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    order_mode.change(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])
    loop.change(do_apply_speed, inputs=[speed, order_mode, loop, buffer_size], outputs=[])

    analyze_btn.click(do_run_agent_pipeline, inputs=[], outputs=[analysis_status, analysis_header, analysis_policy, analysis_report, trace])
    for btn, name in zip(demo_buttons, DEMO_CLASS_NAMES):
        btn.click(lambda n=name: do_show_demo_example(n), inputs=[], outputs=[demo_header, demo_policy, demo_report])

    timer = gr.Timer(0.5)
    timer.tick(
        poll,
        inputs=[metric_a, metric_b],
        outputs=[status, live_table, plot_a, plot_b, label_bar, escalation_indicator,
                 start_btn, pause_btn, resume_btn, stop_btn],
    )

if __name__ == "__main__":
    demo.queue().launch(**({} if THEME_IN_BLOCKS else {"theme": DASHBOARD_THEME}))
