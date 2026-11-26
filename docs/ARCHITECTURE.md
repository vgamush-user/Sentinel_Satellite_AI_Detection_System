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

## Real-Time Pipeline (Kafka)

The live system (`src/streaming/`, `src/web/`, `docker-compose.yml`, started by `scripts/start_all.py`) runs the same model and agents as an event-driven stream. Every stage is a separate process; they communicate only through Kafka topics.

| Topic | Producer | Consumers | Message |
|---|---|---|---|
| `telemetry.raw` | `producer.py` (CSV replay), `inject.py` (website panel, attack buttons, `POST /api/ingest`, CLI) | `detector.py` | entry id, source, timestamp, the 22 model features, optional ground-truth label |
| `telemetry.scored` | `detector.py` (XGBoost on every row, micro-batched) | `incident_manager.py`, website | the above + predicted class, confidence, per-class probabilities, latency |
| `incidents` | `incident_manager.py` | `agent_worker.py`, `recorder.py`, website | `opened` / `updated` / `closed` incident events, plus `entry_decision` events for hand-injected entries |
| `reports` | `agent_worker.py` (4-agent crew, one incident at a time) | `recorder.py`, website | `started` / `finished` with status, SPARTA context, mitigation, incident report, runtime |

**Two speeds.** Detection is microseconds per row and never waits for an LLM. Groq is called once per *incident*, not per row, so LLM cost scales with the number of attacks rather than telemetry volume. When several incidents open at once they queue in the `incidents` topic; the agent worker commits each offset only after publishing its report, so a crash mid-analysis re-runs that incident instead of losing it.

**Incident rules.** A row is attack evidence if XGBoost predicts a non-Normal class with confidence >= 0.7. An incident opens when 5 of the last 20 rows are evidence of the same class, and closes after 40 rows (or 30 s) without that class. "K of the last N" rather than "K in a row" because, in a live stream, attack rows arrive interleaved with normal traffic: in testing, the stricter rule never fired on an interleaved attack. Tuned on the datasets with a simulated interleaved stream: 0 false incidents across 3 loops of the Normal replay; clean 15-row attack bursts open exactly one correct incident 100% of the time; noisy bursts 17-48%, because on `noised_dataset.csv` the model is ~69% accurate and most noisy attack rows score below the 0.7 guard. The incident's class is always XGBoost's; the agents explain and respond to it.

**Storage.** `recorder.py` is the single writer of `data/live/sentinel.db` (SQLite, WAL mode) and only does idempotent upserts, so it can restart and replay from Kafka safely. The website reads history from it and live events from Kafka.

**Website.** `src/web/server.py` (FastAPI) runs one Kafka consumer in a background thread and pushes batches to browsers over a WebSocket every 250 ms. The page shows the live threat-score chart, pipeline counters, incident list with agent status (queued / analysing / ready) and full reports, and two entry points: *Test a new entry* (load a real row, edit features, send once or as a burst, follow it stage by stage) and *Launch an attack* (clean or noisy dataset rows).

**Restarts.** Single-instance services use Kafka static group membership (`group.instance.id`), so a killed and restarted service reclaims its partition immediately instead of waiting out the session timeout.
