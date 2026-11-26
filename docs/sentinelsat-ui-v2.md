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

## Applying the design references

The ACRU study sets the visual target for the web workspace. Use its quiet canvas, light panels, compact sidebar, chart with supporting metrics, and context rail. SentinelSat supplies its own telemetry values, action colors, and review states.

| Reference | Rule to reuse | Implementation |
|---|---|---|
| Linear | Keep dense rows aligned and make selection obvious. | Telemetry rows, incident filters and selected evidence use a shared border, surface and accent. |
| Mercury | Separate panels with subtle tonal changes and prioritize one main action in a group. | Light and dark surface roles, the replay context rail, the sample action and the Threat Lab submission controls. |
| Stripe | Align numbers and name their scope. | Tabular telemetry figures, labeled session metrics and a distinct frozen snapshot heading. |
| Jobright | Give newcomers a clear first choice and action. | A five-class sample selector with one keyless Explore sample action. |
| Claude | Teach through a short example with details available when needed. | Overview walkthrough and methodology, using the shared UI typography. |
| MongoDB | Present technical detail in predictable disclosures and forms. | Raw feature editor, field-level validation, and expandable reports. |
| Cohere | Use compact evidence and taxonomy sections. | SPARTA threat context inside the AI narrative, with provenance shown before report content. |

The stylesheet owns the color, spacing, radius, typography and motion roles. The web result renderer owns the reading order: prediction and review, evidence, policy outcome, AI narrative. Gradio uses the same language with its native controls. When adding a metric or state, use an existing role and label the data source and scope alongside it.

- Implemented in the ACRU pass: compact mobile telemetry, frozen snapshot scope and trigger navigation, incident focus restoration, faster scenario selection, previous-run context, theme persistence and a Gradio trace based on available outputs.
- Future data contracts: durable trigger-row storage beyond the replay buffer, structured policy fields for Kafka incidents and per-stage events from the analysis pipeline.
