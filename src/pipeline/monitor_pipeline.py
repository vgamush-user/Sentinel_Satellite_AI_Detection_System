import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, LLM

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

# Same workarounds as classifier_agent.py — same CrewAI/Groq bugs apply here.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

from tools.monitor_tool import should_escalate, FEATURE_ORDER
from tools.classifier_tool import ClassifyTelemetryTool, ClassificationResult, CLASSIFIER_EXPECTED_OUTPUT, parse_classification
from simulator.telemetry_simulator import TelemetryReplaySimulator

from agents.llm_config import make_llm  # retries Groq rate limits / network blips

llm = make_llm()

classifier_agent = Agent(
    role="Classifier",
    goal="Classify incoming telemetry windows into Normal or an attack class with a confidence score",
    backstory="A detection specialist that runs the baseline XGBoost model against telemetry windows.",
    tools=[ClassifyTelemetryTool()],
    llm=llm,
    verbose=False,
)


def classify_window(window: dict) -> ClassificationResult:
    task = Task(
        description=(
            "Use the classify_telemetry tool to classify this telemetry window, "
            "then report the class and confidence:\n\n"
            f"{json.dumps(window, indent=2)}"
        ),
        expected_output=CLASSIFIER_EXPECTED_OUTPUT,
        agent=classifier_agent,
    )
    crew = Crew(agents=[classifier_agent], tasks=[task], verbose=False)
    output = crew.kickoff()
    return parse_classification(output.raw)


MAX_ROWS_TO_PROCESS = 8  # smoke-test cap: bound Groq calls, don't burn the whole dataset

sim = TelemetryReplaySimulator(str(PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv"), buffer_size=50)
sim.configure(speed_rows_per_sec=20, order_mode="shuffled", loop=False)
sim.start()

seen = 0
escalated_count = 0

while seen < MAX_ROWS_TO_PROCESS:
    snap = sim.snapshot()
    new_count = snap.rows_emitted - seen

    if new_count >= 1:
        # Process every row emitted since the last check, in order — not just
        # the latest one, since the classifier call below can block long
        # enough for several more rows to stream in behind it.
        new_rows = snap.buffer.tail(new_count)
        sim.pause()  # don't let more rows stream in while we classify
        for _, row in new_rows.iterrows():
            seen += 1
            window = {f: float(row[f]) for f in FEATURE_ORDER}
            true_label = int(row["Label"])

            if should_escalate(window):
                escalated_count += 1
                if escalated_count > 1:
                    time.sleep(15)  # stay under Groq free-tier tokens-per-minute cap
                result = classify_window(window)
                print(f"[{seen:02d}] true_label={true_label} -> ESCALATED -> class={result.predicted_class} confidence={result.confidence}")
            else:
                print(f"[{seen:02d}] true_label={true_label} -> skip (below escalation threshold)")

            if seen >= MAX_ROWS_TO_PROCESS:
                break
        sim.resume()

    if snap.finished:
        break
    time.sleep(0.05)

sim.stop()
print(f"\nDone. {escalated_count}/{seen} rows escalated to the Classifier Agent.")
