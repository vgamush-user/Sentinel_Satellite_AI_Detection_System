# SentinelSat UI v2

## Data contract

| UI field | Source | Unavailable state | Placement |
|---|---|---|---|
| Replay dataset, throughput and session accuracy | FastAPI state and WebSocket stats | Unknown dataset or no scored rows | Overview, Telemetry |
| Dataset label and predicted class | Labeled telemetry row and detector output | Unknown dataset label for edited inputs | Telemetry feed, incident detail |
| Cached sample prediction and confidence | `src/pipeline/demo_cache.json` | Cached scenario or classification unavailable | Overview walkthrough |
| Monitor decision | Gradio statistical check of the submitted replay window | No replay window, or no decision recorded in cache | Analyze |
| Kafka incident evidence | Incident manager and the captured replay buffer | No trigger rows recorded or rows outside the buffer | Incident detail |
| Report provenance | Report worker mode on each incident report event or stored record | Source unavailable for older records | Incident detail |
| Review signal | Pipeline status for the current analysis | Unavailable for the current incident when only a cached example exists | Cached walkthrough, Analyze, incident detail |
| Structured policy action | Existing deterministic policy lookup for a valid live Gradio result | Unavailable for cached examples and legacy Kafka reports | Analyze |
| SPARTA, mitigation explanation and narrative | Returned or cached agent text | Unavailable when a result lacks that output | Walkthrough, Analyze, incident detail |
| Domain-shift evaluation | Figures supplied from the project report | Verify against the source PDF before public deployment | How it works |

## Change log

- Implemented a keyless five-scenario walkthrough, methodology views, review-focused incident details and clearer replay labels.
- Preserved the Gradio manual analysis and replay controls, the Kafka WebSocket and Threat Lab submission paths, and all existing classifier, escalation and mitigation logic.
- Proposed structured stage events, durable review state and incident exports. Current outputs support a completed stage summary in Gradio, with no live per-stage timings.
- Verification pending against the original project PDF and a real provider-backed run before public release.
