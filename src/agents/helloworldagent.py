import sys
import os
from dotenv import load_dotenv
from crewai import Agent,Task,Crew,LLM
from crewai.tools import tool

# Windows console default codepage can't print the emoji CrewAI logs.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# Work around a CrewAI 1.15.x bug: every message gets tagged with an internal
# "cache_breakpoint" flag meant for providers that support prompt caching
# (e.g. Anthropic). The code that should strip it for other providers is
# never actually called, so Groq's strict API validation rejects the request.
# Neutering mark_cache_breakpoint here (before it's used) avoids the tag
# ever being added.
import crewai.llms.cache as _crewai_cache
_crewai_cache.mark_cache_breakpoint = lambda message: dict(message)

load_dotenv()

@tool("Dummy Lookup Tool")
def dummy_lookup(query:str)->str:
    """
    Pretends to look something up and returns a fixed fake result.
    """
    return f"[dummy data] Result for '{query}':status=\"OK\",value=42"


from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # src/, for agents.llm_config
from agents.llm_config import make_llm  # retries Groq rate limits / network blips

llm = make_llm()  # free tier model on Groq

agent = Agent(
    role="Hello World Agent",
    goal="Demonstrate calling a tool and returning a result",
    backstory="A minimal test agent used to validate the CrewAI + Groq setup.",
    tools=[dummy_lookup],
    llm=llm,
    verbose=True,
)

task = Task(
    description="Use the Dummy Lookup Tool to look up 'satellite-1' and report the result.",
    expected_output="A short sentence stating the looked-up value.",
    agent=agent,
)

crew = Crew(agents=[agent], tasks=[task], verbose=True)
result = crew.kickoff()
print(result)
