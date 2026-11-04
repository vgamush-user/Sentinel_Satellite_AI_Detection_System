import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, LLM

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

# Same workarounds as classifier_agent.py / sparta_agent.py / mitigation_agent.py.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

from tools.incident_reporter_tool import AssembleIncidentRecordTool

from agents.llm_config import make_llm  # retries Groq rate limits / network blips

llm = make_llm()

incident_reporter_agent = Agent(
    role="Incident Reporter",
    goal="Turn a detected-and-mitigated incident into a clear, useful report for a human reviewer",
    backstory=(
        "A technical writer for spacecraft security operations. Writes reports a tired "
        "ground controller can act on fast -- not a JSON dump with sentences wrapped "
        "around it. Never invents facts not present in the assembled incident record."
    ),
    tools=[AssembleIncidentRecordTool()],
    llm=llm,
    verbose=True,
)

if __name__ == "__main__":
    task = Task(
        description=(
            "An incident was detected and handled by the pipeline:\n"
            "- Classifier: 'Command Flooding' at confidence 0.96\n"
            "- SPARTA Analyst: tactic ST0009 / ST0003, technique SV-MA-1\n"
            "- Mitigation: action 'flush_command_queue + Rate Limit' via tool_rate_limit_uplink, "
            "guardrail note 'Keep emergency ground command channel unthrottled.', executed autonomously\n\n"
                        "Use assemble_incident_record to build the structured record, then write a short "
            "human-reviewer report covering: what was detected and how confident the system was, "
            "the SPARTA threat context, what action was taken and why, the false-positive risk "
            "note, and that human review is still pending. Only use facts from the tool's output -- "
            "do not invent packet counts, timestamps beyond what the tool returned, or SHAP details "
            "the tool didn't provide.\n\n"
            "CRITICAL FORMATTING INSTRUCTION: Write the report as a cohesive narrative paragraph "
            "(or a few short paragraphs) that reads naturally to a human operator. DO NOT format it "
            "as a JSON dump, bulleted list of fields, or key-value pairs."
        ),
        expected_output="A short, narrative incident report in paragraph form that a human reviewer could act on in under a minute.",
        agent=incident_reporter_agent,
    )
    crew = Crew(agents=[incident_reporter_agent], tasks=[task], verbose=True)
    result = crew.kickoff()
    print(result)
