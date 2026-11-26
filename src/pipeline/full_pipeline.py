"""
Formalized end-to-end pipeline: stream -> monitor -> classify -> SPARTA
context -> mitigate -> report.

Process choice: SEQUENTIAL, not hierarchical. Week 3 testing showed every
agent's tool is deterministic and the pipeline order is fixed by design
(Monitor always gates before Classifier; Classifier always runs before
SPARTA/Mitigation/Reporter) -- there's no decision about *which* agent to
call next that needs a manager LLM to make. A hierarchical process would
add cost, latency, and unpredictability for zero benefit here.

Guardrails:
  1. Confidence threshold before autonomous mitigation fires: already
     enforced inside decide_mitigation()'s policy bands (below 0.70,
     every class falls to a non-autonomous action).
  2. Fallback to "flag for review" on agent disagreement / malformed tool
     output: if the SPARTA or Mitigation tool returns an "error" key
     (e.g. an unrecognized class name), the pipeline stops autonomous
     handling and marks the incident FLAGGED_FOR_REVIEW instead of
     guessing.
"""
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from crewai import Crew, Task, Process

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

from tools.mitigation_tool import POLICY
from tools.monitor_tool import should_escalate, FEATURE_ORDER
from tools.classifier_tool import CLASSIFIER_EXPECTED_OUTPUT, parse_classification
from agents.classifier_agent import classifier_agent
from agents.sparta_agent import sparta_agent
from agents.mitigation_agent import mitigation_agent
from agents.incident_reporter_agent import incident_reporter_agent
from simulator.telemetry_simulator import TelemetryReplaySimulator


# Groq free tier caps gpt-oss at 8k tokens/minute and one 4-agent chain uses
# ~10k, so pause between tasks to keep the chain from hitting a 429 mid-run.
# Set PIPELINE_TASK_PAUSE_SEC=0 on a paid tier.
TASK_PAUSE_SEC = float(os.getenv("PIPELINE_TASK_PAUSE_SEC", "20"))


def _pause_between_tasks(_output) -> None:
    if TASK_PAUSE_SEC > 0:
        time.sleep(TASK_PAUSE_SEC)


def run_pipeline_for_window(window: dict) -> dict:
    """Runs the 4-agent sequential Crew for one already-escalated window.
    Returns a dict with each stage's raw result plus a top-level guardrail
    status ('AUTONOMOUS', 'FLAGGED_FOR_REVIEW', or 'ERROR')."""
    import json

    classify_task = Task(
        description=(
            "Use the classify_telemetry tool to classify this telemetry window, "
            "then report the class and confidence:\n\n" + json.dumps(window, indent=2)
        ),
        expected_output=CLASSIFIER_EXPECTED_OUTPUT,
        agent=classifier_agent,
        callback=_pause_between_tasks,
    )

    sparta_task = Task(
        description=(
            "The Classifier just detected an attack class (see context). Use "
            "get_sparta_class_mapping to look up its exact SPARTA tactic/technique "
            "mapping, then use search_sparta_incidents to find one related real-world "
            "precedent, then explain the threat in plain language citing both."
        ),
        expected_output="The SPARTA tactic ID, technique ID, a related incident, and a plain-language explanation.",
        agent=sparta_agent,
        context=[classify_task],
        callback=_pause_between_tasks,
    )

    mitigation_task = Task(
        description=(
            "Using the class and confidence the Classifier detected (see context), use "
            "decide_mitigation to get the exact policy-mandated action, then explain in "
            "plain language why that action fits. Do not propose a different action than "
            "what the tool returns."
        ),
        expected_output="The exact action and tool function from the policy, plus a plain-language justification.",
        agent=mitigation_agent,
        context=[classify_task],
        callback=_pause_between_tasks,
    )

    report_task = Task(
        description=(
            "Using the Classifier's detection, the SPARTA Analyst's threat context, and "
            "the Mitigation Agent's action (all in context), use assemble_incident_record "
            "to build the structured record, then write a short human-reviewer report: "
            "what was detected, the SPARTA context, what action was taken and why, the "
            "false-positive risk note, and that human review is pending. Only use facts "
            "from the tool's output."
        ),
        expected_output="A short, clearly organized incident report a human reviewer could act on in under a minute.",
        agent=incident_reporter_agent,
        context=[classify_task, sparta_task, mitigation_task],
    )

    crew = Crew(
        agents=[classifier_agent, sparta_agent, mitigation_agent, incident_reporter_agent],
        tasks=[classify_task, sparta_task, mitigation_task, report_task],
        process=Process.sequential,
        verbose=True,
    )

    # Guardrail: a Groq/tool-calling failure anywhere in the chain (e.g. the
    # model emitting a malformed function-call instead of a proper tool
    # call -- a real failure mode observed in testing, not hypothetical)
    # must not crash the whole pipeline. Flag for review instead.
    try:
        crew.kickoff()
    except Exception as e:
        return {
            "status": "ERROR",
            "classification": parse_classification(classify_task.output.raw) if classify_task.output else None,
            "sparta_context": "",
            "mitigation": "",
            "report": f"Pipeline failed during agent execution: {e}",
        }

    classification = parse_classification(classify_task.output.raw)
    sparta_raw = sparta_task.output.raw
    mitigation_raw = mitigation_task.output.raw
    report_raw = report_task.output.raw

    # Guardrail: agent disagreement / malformed tool output -> flag, don't
    # silently proceed as if everything was autonomous.
    status = "AUTONOMOUS"
    if classification is None:
        status = "ERROR"
    elif classification.confidence < (
        min([thresh for thresh, action, _, _ in POLICY.get(classification.predicted_class, []) if action not in ("log_only", "Escalate Alert")], default=1.0)
        if [thresh for thresh, action, _, _ in POLICY.get(classification.predicted_class, []) if action not in ("log_only", "Escalate Alert")]
        else (0.0 if classification.predicted_class == "Normal" else 1.0)
    ):
        status = "FLAGGED_FOR_REVIEW"
    elif "error" in sparta_raw.lower() or "error" in mitigation_raw.lower():
        status = "FLAGGED_FOR_REVIEW"
    else:
        # Disagreement check: downstream agents are LLM-written narrative, not
        # just tool passthrough -- they can drift from the actual detected
        # class despite instructions not to. Sanity-check the class name
        # they're supposed to be discussing actually appears in what they wrote.
        class_name = classification.predicted_class.lower()
        if class_name not in sparta_raw.lower():
            status = "FLAGGED_FOR_REVIEW"
        elif class_name not in report_raw.lower():
            status = "FLAGGED_FOR_REVIEW"

    return {
        "status": status,
        "classification": classification,
        "sparta_context": sparta_raw,
        "mitigation": mitigation_raw,
        "report": report_raw,
    }


if __name__ == "__main__":
    MAX_ROWS_TO_PROCESS = 3  # a couple more rows now that 1-row chain is proven working

    sim = TelemetryReplaySimulator(
        str(PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv"), buffer_size=50
    )
    sim.configure(speed_rows_per_sec=20, order_mode="shuffled", loop=False)
    sim.start()

    seen = 0
    escalated_count = 0

    while seen < MAX_ROWS_TO_PROCESS:
        snap = sim.snapshot()
        new_count = snap.rows_emitted - seen

        if new_count >= 1:
            new_rows = snap.buffer.tail(new_count)
            sim.pause()
            for _, row in new_rows.iterrows():
                seen += 1
                window = {f: float(row[f]) for f in FEATURE_ORDER}
                true_label = int(row["Label"])

                if should_escalate(window):
                    escalated_count += 1
                    if escalated_count > 1:
                        time.sleep(45)  # one row's 4-agent chain uses ~10-11k of the 12k TPM budget
                    try:
                        result = run_pipeline_for_window(window)
                    except Exception as e:
                        result = {"status": "ERROR", "report": f"Unhandled pipeline error: {e}"}
                    print(f"\n=== [{seen:02d}] true_label={true_label} status={result['status']} ===")
                    print(result["report"])
                else:
                    print(f"[{seen:02d}] true_label={true_label} -> skip (below escalation threshold)")

                if seen >= MAX_ROWS_TO_PROCESS:
                    break
            sim.resume()

        if snap.finished:
            break
        time.sleep(0.05)

    sim.stop()
    print(f"\nDone. {escalated_count}/{seen} rows escalated through the full pipeline.")
