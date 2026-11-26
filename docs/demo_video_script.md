# Demo Video Script (draft) — Agentic AI Lead section

Target: 3-4 minutes total for the whole team's video. This is the Agentic AI Lead's
portion (~90-120s) — dashboard walkthrough + one live scenario + the honest failure case.
Combine with the Cybersecurity Lead's narrated failure-mode section and the ML Lead's
metrics section for the full video.

## Before recording
- Run `python src/pipeline/generate_demo_cache.py` once beforehand so Demo Mode is fully
  populated (avoids live Groq calls/rate-limit risk during the actual recording).
- Start the React dashboard as documented in the README and open Manual analysis.
- Close other tabs/apps hitting the same Groq key, to avoid a rate-limit surprise on camera.

## Shot list

**1. Live telemetry stream (15s)**
- Click Start replay in Manual analysis. Point out the live table, rolling metric charts, and the
  ground-truth label mix.
- Say: "This is streaming real rows from the CuCD-ID dataset — CubeSat telemetry with
  realistic sensor noise, not a toy simulation."

**2. The cost-aware Monitor gate (15s)**
- Point at the "Monitor: would escalate / nominal" indicator updating live, free, on every row.
- Say: "This check runs on every single packet for free — pure statistics, no LLM call. Only
  about 3% of nominal traffic and nearly 100% of actual attacks ever reach the expensive agents."

**3. One live agent analysis (30-40s)** — the "happy path"
- Click **🔍 Run Full Agent Analysis on Latest Row** on a window that's escalating.
- While it runs (~60-90s in reality — cut this in editing, or narrate over it):
  say what's happening: "Now the Classifier is running against the ML Lead's baseline model
  via Groq, then the SPARTA Analyst grounds it in real threat-intel, then Mitigation applies
  the Cybersecurity Lead's exact confidence-band policy, then the Incident Reporter writes
  the final report."
- Show the resulting report on screen: class detected, confidence, SPARTA tactic/technique,
  action taken, false-positive risk note.

**4. Demo Mode — the other 4 scenarios (20s)**
- Click through 2-3 of the cached class buttons quickly to show all 5 attack types are covered,
  without waiting on live Groq calls.
- Say: "These are pre-cached so anyone reviewing this can see all 5 scenarios instantly,
  without needing their own API key."

**5. Honest failure case (15-20s)** — REQUIRED, don't skip
- Show the `FLAGGED_FOR_REVIEW` example (Data Injection, ~0.61 confidence) from the cache.
- Say plainly: "Not every detection is high-confidence, and the system is built to know that —
  below 0.70 confidence, it doesn't act autonomously, it flags for human review instead."
- If time allows, also mention (even without showing on screen): "During testing we also hit
  two real infrastructure failures — Groq's rate limit, and the model occasionally emitting a
  malformed tool call — and the pipeline is built to fail gracefully into a flagged state
  instead of crashing when that happens."

## What NOT to do
- Don't claim the system is "always right" or gloss over the Normal-vs-Data-Injection confusion
  the ML Lead's numbers show — that's the Cybersecurity Lead's honest-limitations material and
  it should show up somewhere in the full video, even if not in this section.
- Don't run live, uncached agent calls back-to-back on camera — you will hit the rate limit
  exactly like we did in testing. Use Demo Mode for anything beyond the one live example.
