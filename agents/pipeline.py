# -*- coding: utf-8 -*-
"""
agents/pipeline.py
==================
Role C — Day 3 Core Deliverable

The full end-to-end pipeline:
  Telemetry Stream → Monitor → Classify → SPARTA → Mitigate → Report

This module runs the pipeline WITHOUT needing CrewAI installed yet.
It uses the plain function wrappers from tools.py, so it works today
and can be upgraded to a full CrewAI crew on Day 8.

How to run:
  python agents/pipeline.py --file data/consolidated_dataset_raw.csv
  python agents/pipeline.py --file data/consolidated_dataset_raw.csv --windows 20
"""

import sys, io, os, json, time, argparse
from typing import Optional
from datetime import datetime, timezone

# Fix Windows encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.layout import Layout
from rich.text import Text
from rich import box

from agents.tools import (
    StreamState,
    tool_get_next_window,
    tool_classify,
    tool_sparta_lookup,
    LABEL_MAP,
)

console = Console()

# ──────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ──────────────────────────────────────────────────────────────────────────────

LABEL_COLORS = {
    0: "green",
    1: "yellow",
    2: "red",
    3: "magenta",
    4: "bold red",
}

ACTION_COLORS = {
    "log_only":            "green",
    "flush_command_queue": "yellow",
    "isolate_subsystem":   "magenta",
    "enable_safe_mode":    "bold red",
}

# Confidence threshold — below this, don't fire autonomous action (guardrail)
# Tuned specifically for Normal→DataInjection false-positive risk (Day 8 refines this)
CONFIDENCE_THRESHOLD = 0.70


# ──────────────────────────────────────────────────────────────────────────────
# AGENT DECISION FUNCTIONS
# These are the "reasoning" steps each agent performs.
# Simplified here — on Day 8 these become actual LLM-driven CrewAI agents.
# ──────────────────────────────────────────────────────────────────────────────

def monitor_agent_step(state: StreamState) -> Optional[dict]:
    """
    Monitor Agent: reads next window from stream.
    Decides whether to escalate to the Classifier Agent.
    
    Escalation logic: always escalate for now. On Day 5, add cost-aware
    logic (e.g., only call classifier every N windows, or if variance is high).
    """
    result = tool_get_next_window()
    if result["status"] == "STREAM_EXHAUSTED":
        return None
    return result


def classifier_agent_step() -> dict:
    """
    Classifier Agent: classifies the current telemetry window.
    Returns prediction + confidence + SHAP features.
    """
    return tool_classify(use_ground_truth=True)


def sparta_analyst_step(label: int) -> dict:
    """
    SPARTA Analyst Agent: maps the detected label to SPARTA framework context.
    Returns tactic, technique, risk level, and recommended action.
    """
    return tool_sparta_lookup(label=label)


def mitigation_agent_step(
    classification: dict,
    sparta_context: dict,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
) -> dict:
    """
    Mitigation Agent: decides whether to execute autonomous action.

    Rule + threshold hybrid policy:
      - If confidence < threshold → downgrade to 'flag_for_review'
      - If label == 3 (Data Injection) → extra caution (highest false-positive rate)
      - Otherwise → execute recommended SPARTA action

    This guardrail is specifically tuned against the Normal→DataInjection
    false-positive case (1,786 misclassifications in the domain-shift eval).
    """
    pred = classification["prediction"]
    label = pred["label"]
    confidence = pred["confidence"]
    recommended = sparta_context["recommended_action"]
    risk_level = sparta_context["risk_level"]

    # Apply confidence guardrail
    if confidence < confidence_threshold:
        action = "flag_for_review"
        reason = (
            f"Confidence {confidence:.2f} below threshold {confidence_threshold:.2f}. "
            f"Escalating to human review instead of autonomous '{recommended}'."
        )
    # Extra caution on Data Injection (highest false-positive rate)
    elif label == 3 and confidence < 0.85:
        action = "flag_for_review"
        reason = (
            f"Data Injection detected but confidence {confidence:.2f} < 0.85. "
            f"Data Injection has highest false-positive rate (1,786 Normal→DataInj "
            f"misclassifications in domain-shift eval). Flagging for human review."
        )
    else:
        action = recommended
        reason = (
            f"Confidence {confidence:.2f} above threshold. "
            f"Executing SPARTA-recommended action: {recommended}."
        )

    return {
        "action_taken":    action,
        "original_recommendation": recommended,
        "confidence":      confidence,
        "risk_level":      risk_level,
        "guardrail_fired": action != recommended,
        "reason":          reason,
    }


def incident_reporter_step(
    window_num: int,
    classification: dict,
    sparta_context: dict,
    mitigation: dict,
    timestamp: str,
) -> dict:
    """
    Incident Reporter Agent: produces a structured incident report.
    In the full system (Day 6), this calls Groq LLM to generate a
    human-readable narrative. Here it generates a structured report.
    """
    pred = classification["prediction"]
    shap = classification.get("shap_top_features", {})
    top_shap_feature = max(shap, key=shap.get) if shap else "N/A"

    severity = sparta_context["risk_level"]
    attack = pred["class_name"]

    report = {
        "incident_id":     f"INC-{window_num:04d}",
        "timestamp":       timestamp,
        "severity":        severity,
        "attack_detected": attack,
        "sparta_tactic":   f"{sparta_context['sparta_tactic']} — {sparta_context['sparta_tactic_name']}",
        "sparta_technique": sparta_context["sparta_technique"],
        "confidence":      f"{pred['confidence']:.1%}",
        "top_shap_feature": top_shap_feature,
        "action_taken":    mitigation["action_taken"],
        "guardrail_fired": mitigation["guardrail_fired"],
        "summary":         sparta_context["analysis_summary"][:200] + "...",
    }
    return report


# ──────────────────────────────────────────────────────────────────────────────
# DISPLAY HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def make_pipeline_table(incident_log: list) -> Table:
    """Build a Rich table showing the pipeline's incident history."""
    table = Table(
        title="[bold cyan]CubeSat IDS — Agent Pipeline[/]",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold cyan",
        expand=True,
    )
    table.add_column("Incident",   width=10)
    table.add_column("Attack",     width=20)
    table.add_column("SPARTA",     width=22)
    table.add_column("Confidence", width=12)
    table.add_column("Action",     width=22)
    table.add_column("Guardrail",  width=10)

    for inc in incident_log[-20:]:  # Show last 20
        label_int = list(LABEL_MAP.values()).index(inc["attack_detected"]) \
            if inc["attack_detected"] in LABEL_MAP.values() else 0
        color = LABEL_COLORS.get(label_int, "white")
        act_color = ACTION_COLORS.get(inc["action_taken"], "white")
        guardrail_str = "[yellow]YES[/]" if inc["guardrail_fired"] else "[green]no[/]"

        table.add_row(
            inc["incident_id"],
            Text(inc["attack_detected"], style=f"bold {color}"),
            f"{inc['sparta_tactic'][:20]}",
            inc["confidence"],
            Text(inc["action_taken"], style=act_color),
            guardrail_str,
        )

    return table


# ──────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE RUNNER
# ──────────────────────────────────────────────────────────────────────────────

def run_pipeline(
    dataset_path: str,
    max_windows: int = 50,
    speed: str = "instant",
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    show_live: bool = True,
):
    """
    Run the full multi-agent pipeline on the telemetry stream.

    Steps per window:
      1. Monitor Agent   → get next window from stream
      2. Classifier Agent → classify window (stub until Day 3 model is ready)
      3. SPARTA Analyst  → look up threat context
      4. Mitigation Agent → decide action (with confidence guardrail)
      5. Incident Reporter → generate incident report
    """
    console.print(Panel.fit(
        "[bold cyan]CubeSat Multi-Agent IDS Pipeline[/]\n"
        "[dim]Role C — Day 3 | Simulator → Agents[/]",
        border_style="cyan",
    ))

    # Initialize shared stream state
    state = StreamState.get()
    state.initialize(dataset_path, speed=speed)

    incident_log = []
    attack_count = {name: 0 for name in LABEL_MAP.values()}
    guardrail_count = 0

    console.print(f"[green]Stream ready[/] | Max windows: {max_windows} | Threshold: {confidence_threshold}\n")

    with Live(console=console, refresh_per_second=5) as live:
        windows_processed = 0

        while windows_processed < max_windows:
            # ── Step 1: Monitor Agent ─────────────────────────────────────
            stream_result = monitor_agent_step(state)
            if stream_result is None:
                console.print("[yellow]Stream exhausted.[/]")
                break

            if not stream_result.get("stream_status", {}).get("window_ready", False):
                continue  # Window not full yet

            # ── Step 2: Classifier Agent ──────────────────────────────────
            classification = classifier_agent_step()
            if classification["status"] != "OK":
                continue

            pred = classification["prediction"]
            label = pred["label"]

            # Only generate incident for non-normal OR periodically for Normal
            if label == 0 and windows_processed % 5 != 0:
                windows_processed += 1
                continue  # Skip routine normal windows (cost-aware)

            # ── Step 3: SPARTA Analyst ────────────────────────────────────
            sparta_context = sparta_analyst_step(label)

            # ── Step 4: Mitigation Agent ──────────────────────────────────
            mitigation = mitigation_agent_step(
                classification, sparta_context, confidence_threshold
            )
            if mitigation["guardrail_fired"]:
                guardrail_count += 1

            # ── Step 5: Incident Reporter ─────────────────────────────────
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            incident = incident_reporter_step(
                window_num=windows_processed,
                classification=classification,
                sparta_context=sparta_context,
                mitigation=mitigation,
                timestamp=ts,
            )

            incident_log.append(incident)
            attack_count[pred["class_name"]] += 1

            # Update live display
            live.update(make_pipeline_table(incident_log))
            windows_processed += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    console.print("\n")
    summary_table = Table(title="Pipeline Summary", box=box.ROUNDED, header_style="bold green")
    summary_table.add_column("Metric")
    summary_table.add_column("Value")
    summary_table.add_row("Windows processed",    str(windows_processed))
    summary_table.add_row("Incidents logged",      str(len(incident_log)))
    summary_table.add_row("Guardrails fired",      f"[yellow]{guardrail_count}[/]")
    for name, count in attack_count.items():
        if count > 0:
            color = LABEL_COLORS.get(list(LABEL_MAP.values()).index(name), "white")
            summary_table.add_row(f"  {name}", f"[{color}]{count}[/]")
    console.print(summary_table)

    # Save incident log
    log_path = "reports/incident_log.json"
    os.makedirs("reports", exist_ok=True)
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(incident_log, f, indent=2)
    console.print(f"\n[green]Incident log saved to[/] [cyan]{log_path}[/]")

    return incident_log


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CubeSat IDS Multi-Agent Pipeline")
    parser.add_argument("--file", "-f", required=True,
                        help="Path to CuCD-ID CSV file.")
    parser.add_argument("--windows", "-w", type=int, default=50,
                        help="Number of telemetry windows to process.")
    parser.add_argument("--threshold", "-t", type=float, default=CONFIDENCE_THRESHOLD,
                        help=f"Confidence threshold for autonomous action (default: {CONFIDENCE_THRESHOLD}).")
    parser.add_argument("--speed", "-s", choices=["realtime", "fast", "instant"],
                        default="instant",
                        help="Playback speed of the telemetry stream.")
    args = parser.parse_args()

    run_pipeline(
        dataset_path=args.file,
        max_windows=args.windows,
        speed=args.speed,
        confidence_threshold=args.threshold,
    )
