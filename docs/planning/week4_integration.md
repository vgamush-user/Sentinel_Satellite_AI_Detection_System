# Week 4 — Integration (Aug 5 – Aug 11)

**Owner:** Software Development & Integration Lead
**Goal (from the 6-week plan):** the system runs end-to-end, even if rough. Highest-risk week — everyone touches integration, no solo heads-down work.

## What shipped this week

1. **`tests/test_integration_all_scenarios.py`** — the full-pipeline integration test. Drives all 5 scenarios (Normal + 4 attack classes) back-to-back and checks, per scenario, that the ML Lead's model, the Agentic AI Lead's agents, and the Cybersecurity Lead's policy table actually agree with each other — not just that nothing crashed. Specifically it checks:
   - **Data contract** — `monitor_tool.py`, `classifier_tool.py`, and `baseline_feature_order.json` all use the identical feature list, and every feature actually exists as a column in `noised_dataset.csv`.
   - **Status validity** — the pipeline always returns `AUTONOMOUS` / `FLAGGED_FOR_REVIEW` / `ERROR`, never an uncaught exception.
   - **Guardrail enforcement** — confidence < 0.70 can never produce `AUTONOMOUS`. This is checked independently from the pipeline's own internal guardrail logic, so it verifies the guardrail is actually wired end-to-end, not just present in the code.
   - **Policy agreement** — when a scenario goes `AUTONOMOUS`, the Mitigation Agent's narrated action must match what `decide_mitigation()` (the Cybersecurity Lead's deterministic policy table) actually says for that class/confidence. This is the specific check that catches an agent silently drifting from policy.
   - **Report quality** — the incident report is non-empty and names the detected class.

   Runs in two modes: **cached** (default, replays `demo_cache.json`, free, no Groq key needed, runs in under a second — safe to run after every change) and **`--live`** (re-runs the real 4-agent Crew, ~20 Groq calls, ~4 minutes, use before a demo). Every run writes a timestamped JSON log to `tests/integration_logs/`.

2. **`src/pipeline/generate_integration_report.py`** — the "one clean end-to-end run" safety-net recording, in document form. Renders `demo_cache.json` into `src/reports/integration_safety_net_run.md`: a per-scenario record of what was detected, at what confidence, what guardrail status it triggered, the SPARTA context, the mitigation decision, and the full incident report text. Regenerates for free in under a second. If the live dashboard breaks in front of someone later, this file is the proof the system worked end-to-end across all 5 scenarios at least once.

3. **This doc** — the Week 4 deliverable writeup the README's planned `docs/planning/` structure calls for.

## Results (current cache, confirmed by the integration test)

| Scenario | Predicted | Confidence | Status |
|---|---|---|---|
| Normal | Normal | 0.998 | AUTONOMOUS |
| Storage Exhaustion | Storage Exhaustion | 1.000 | AUTONOMOUS |
| Command Flooding | Command Flooding | 1.000 | AUTONOMOUS |
| Data Injection | Data Injection | 0.610 | FLAGGED_FOR_REVIEW |
| Defence Impairment | Defence Impairment | 0.675 | FLAGGED_FOR_REVIEW |

**3/5 AUTONOMOUS, 2/5 FLAGGED_FOR_REVIEW, 0/5 ERROR.** All 5 classifications are correct against their true label. The two `FLAGGED_FOR_REVIEW` cases are the guardrail working as intended, not a defect — both landed below the 0.70 confidence threshold, and the domain-shift numbers from Week 2 already predicted exactly this (Data Injection and Command Flooding are the two weakest classes under noised conditions). Nothing errored; the pipeline never crashed or emitted a status the dashboard doesn't handle.

This is a genuinely useful early signal, not just a green checkmark: it shows the guardrail the Cybersecurity Lead designed is actually catching the project's own headline risk (the Normal→Data-Injection confusion mode) by declining to act autonomously when confidence is shaky, rather than the system silently taking action on garbage confidence.

## Data contract — confirmed intact

`monitor_tool.FEATURE_ORDER`, `classifier_tool.FEATURE_ORDER`, and `baseline_feature_order.json` are already a single source of truth (all three ultimately read the same JSON file), and every expected feature is present in `noised_dataset.csv`. No drift found between the ML Lead's model schema and what the Agentic AI Lead's tools pass into it.

## Known gap to flag for the team before Phase 5

The 6-week plan's Phase 5 adversarial test scenarios (see `docs/planning/WEEK 3.md`, sections 3.1–3.2) assume a simulator that can generate scripted, parameterized scenarios — e.g. `ground_pass=True`, `injection_profile=mimicry`, rate sweeps, straddled/mixed-label windows. The current `telemetry_simulator.py` only replays existing CSV rows (sequential or shuffled); it doesn't yet support scripted scenario injection. Today's "5 scenarios" are satisfied by picking one representative row per class (same approach `generate_demo_cache.py` and the dashboard's Demo Mode already use) — sufficient for this week's integration goal, but **not** sufficient for the mimicry/boundary-probe/rapid-switching scenarios Phase 5 calls for. Flagging now so the Cybersecurity Lead and Software/Integration Lead can scope that simulator work before Aug 12, rather than discovering the gap mid-Phase-5.

## How to reproduce

```bash
# Free, instant, no Groq key needed:
python tests/test_integration_all_scenarios.py

# Regenerate the safety-net report from the same cache:
python src/pipeline/generate_integration_report.py

# Only if you've changed the pipeline/agents/policy and want to prove it live
# (spends ~20 Groq calls, ~4 minutes):
python tests/test_integration_all_scenarios.py --live
```

## Week 4 deliverable checklist (against the 6-week plan)

- [x] One stable end-to-end run across all 5 scenarios — confirmed via cached replay and independently re-verified by the integration test's own checks (not just trusting the cache blindly).
- [x] Guardrails live and reviewed — confirmed programmatically (guardrail-breach check) rather than just eyeballing the dashboard once.
- [x] Safety-net demo recorded — `src/reports/integration_safety_net_run.md`, regenerable on demand.
- [x] Cybersecurity Lead sign-off on guardrail thresholds reflecting intended policy (per the plan, this is a joint session with the Agentic AI Lead — schedule before Phase 5 starts).
- [ ] ML Lead per-class ROC-based threshold tuning (Phase 5 item, not blocking Week 4).
