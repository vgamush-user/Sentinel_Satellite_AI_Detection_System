import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from crewai import Agent, Task, Crew, LLM

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

# Same workarounds as classifier_agent.py / sparta_agent.py — same CrewAI/Groq bugs apply here.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

from tools.mitigation_tool import MitigationPolicyTool

from agents.llm_config import make_llm  # retries Groq rate limits / network blips

llm = make_llm()

mitigation_agent = Agent(
    role="Mitigation",
    goal="Apply the fixed mitigation policy to a detected attack and justify it in plain language",
    backstory=(
        "A response specialist who executes the Cybersecurity Lead's exact confidence-band "
        "policy — never inventing its own response, only explaining and justifying the "
        "policy's decision."
    ),
    tools=[MitigationPolicyTool()],
    llm=llm,
    verbose=True,
)

if __name__ == "__main__":
    task = Task(
        description=(
            "The Classifier Agent detected 'Command Flooding' with confidence 0.96. "
            "Use decide_mitigation to get the exact policy-mandated action, then explain "
            "in plain language why that specific action fits this threat. Do not propose "
            "a different action than what the tool returns."
        ),
        expected_output="The exact action and tool function from the policy, plus a plain-language justification.",
        agent=mitigation_agent,
    )
    crew = Crew(agents=[mitigation_agent], tasks=[task], verbose=True)
    result = crew.kickoff()
    print(result)
