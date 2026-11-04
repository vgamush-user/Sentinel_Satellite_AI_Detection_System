## Weekly Execution of the Project

## Agent Orchestration Layer (Agentic AI Lead)

### Agent Roster

| Agent | Role | Tool(s) | LLM used? |
|---|---|---|---|
| Monitor | Decides whether a telemetry window is anomalous enough to escalate | `should_escalate()` — z-score check against nominal-baseline stats, calibrated on genuinely-Normal *noised* data (not clean raw data — see Known Limitations) | No — pure deterministic function, by design. Cost-aware: only ~3% of Normal traffic ever reaches an LLM call. |
| Classifier | Classifies an escalated window into Normal or one of 4 attack classes | `classify_telemetry()` — wraps the ML Lead's baseline XGBoost model | Yes (Groq, `openai/gpt-oss-120b`) |
| SPARTA Analyst | Explains a detection in SPARTA threat-taxonomy terms, with real-world precedent | `get_sparta_class_mapping()` (exact metadata lookup) + `search_sparta_incidents()` (semantic search over a ChromaDB knowledge base of 5 class mappings + 8 real incidents) | Yes |
| Mitigation | Applies the Cybersecurity Lead's confidence-band policy | `decide_mitigation()` — deterministic policy lookup; the LLM only narrates justification, never overrides the tool's action | Yes (narration only) |
| Incident Reporter | Turns a full detection into a human-reviewer report | `assemble_incident_record()` — deterministic severity + false-positive-risk assessment, matching the JSON schema in `cybersecurity_lead_complete_package.md` §5 | Yes |

### Process Choice: Sequential, Not Hierarchical

The formalized `Crew` (`src/pipeline/full_pipeline.py`) uses `Process.sequential`. The pipeline order is fixed by design — Monitor always gates before Classifier; Classifier always runs before SPARTA/Mitigation/Reporter — so there's no "which agent should run next" decision that needs a manager LLM to make. A hierarchical process would add cost, latency, and unpredictability for zero benefit here.

### Guardrails

1. **Confidence threshold before autonomous action**: enforced inside `decide_mitigation()`'s policy bands — below each class's threshold, the action always falls back to `log_only` or `Escalate Alert` (non-autonomous).
2. **Pipeline-level confidence guardrail**: any detection below 0.70 confidence resolves to `FLAGGED_FOR_REVIEW` regardless of class.
3. **Agent disagreement check**: after the SPARTA Analyst and Incident Reporter write their narrative, the pipeline verifies the actual detected class name appears in what they wrote — LLMs can drift from tool outputs into plausible-but-wrong narrative despite instructions not to; this catches that.
4. **Crash resilience**: `crew.kickoff()` is wrapped in a try/except. Verified against two real failure modes during testing (not hypothetical): Groq's tools-per-minute rate limit, and the model emitting a malformed tool-call format (`<function=...>` instead of proper JSON). Both now resolve to a graceful `ERROR` status instead of crashing the whole pipeline run.

### Cached Demo Mode

`src/pipeline/generate_demo_cache.py` pre-computes one full pipeline run per attack class and caches it to `demo_cache.json`. The dashboard's "Demo Mode" buttons read from this cache instead of calling Groq live — so a reviewer can see all 5 scenarios with zero API cost, zero rate-limit risk, and no Groq key of their own required.

### Known Limitations

- **SHAP drivers are a placeholder.** The Incident Reporter's `shap_drivers` field (required by the JSON schema) isn't populated yet — the ML Lead's SHAP work currently only produces a summary plot, not a per-window exportable value. Flagged to her; not blocking, since the report is still useful without it.
- **Groq free-tier daily token cap (100,000/day) is a real constraint.** Hit during demo-cache generation — 4/5 classes cached successfully, the 5th failed with `RateLimitError` (tokens-per-day, not per-minute) and needs the quota to reset before regenerating. This is honest evidence for the "cost-aware" design requirement in the project brief, not just a theoretical concern.
- **`should_escalate()`'s baseline was recalibrated against noised data, not raw data.** The first version, calibrated against clean raw-data statistics, escalated 100% of *all* traffic (including genuinely Normal windows) once tested against noised data — because several features have near-zero variance in clean data, so any realistic sensor noise blew past a 3-sigma threshold. Recalibrating against noised-Normal data fixed it (down to 2.8% false-escalation rate on Normal, ~96-100% catch rate on attacks). Worth remembering if the noised dataset itself changes.
