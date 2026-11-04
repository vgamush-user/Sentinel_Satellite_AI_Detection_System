import os
import sys
import json
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, LLM

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

# Same workarounds as helloworldagent.py — same CrewAI/Groq bugs apply here.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

from tools.classifier_tool import ClassifyTelemetryTool, FEATURE_ORDER, CLASSIFIER_EXPECTED_OUTPUT, parse_classification

from agents.llm_config import make_llm  # retries Groq rate limits / network blips

llm = make_llm()

classifier_agent = Agent(
    role="Classifier",
    goal="Classify incoming telemetry windows into Normal or an attack class with a confidence score",
    backstory="A detection specialist that runs the baseline XGBoost model against telemetry windows.",
    tools=[ClassifyTelemetryTool()],
    llm=llm,
    verbose=True,
)

if __name__ == "__main__":
    # Pull one real row so the task has concrete values to hand the agent —
    # don't let the LLM invent numbers.
    noised = pd.read_csv(PROJECT_ROOT / "data" / "noised" / "noised_dataset.csv")
    sample_row = noised.iloc[0][FEATURE_ORDER].to_dict()

    task = Task(
        description=(
            "Use the classify_telemetry tool to classify this telemetry window, "
            "then report the class and confidence:\n\n"
            f"{json.dumps(sample_row, indent=2)}"
        ),
        expected_output=CLASSIFIER_EXPECTED_OUTPUT,
        agent=classifier_agent,
    )

    crew = Crew(agents=[classifier_agent], tasks=[task], verbose=True)
    result = crew.kickoff()
    print(parse_classification(result.raw))
