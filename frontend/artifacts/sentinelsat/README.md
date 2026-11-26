# SentinelSat

Satellite telemetry and threat operations console with five working destinations: Overview, Telemetry, Incidents, Threat Lab, and Manual Analysis.

## Run the sample demo

Start the managed **SentinelSat: web** workflow. The preview opens directly at Overview.

The default source is explicitly configured as `sample`. `VITE_SENTINEL_SOURCE=sample` selects the same adapter at build time. No server, external credentials, or database is required for this demo.

Replay position and simulation history are saved in the current browser's local storage. Use the Demo menu to reset the demo, disconnect the sample feed, or reconnect it. Playback and chart following are independent controls.

The deterministic sequence includes nominal readings, suspicious readings that never become incidents, incident opening/closing, missing samples, and a report progressing from pending to ready. Manual analysis uses transparent sample classification rules, not a production machine-learning model. SPARTA references and mitigation content are representative demo guidance.

## Connected mode

This build does **not** include a live SentinelSat backend or connected adapter. Setting another source value shows an explicit configuration error rather than silently substituting demo data.

To integrate an existing SentinelSat service:

1. Inspect that service's `frontend/src/protocol.ts`, `frontend/src/useReplay.ts`, `src/web/server.py`, and `src/web/analysis.py`; they are not present in this project.
2. Implement `SentinelAdapter` in `src/lib/sentinel/adapter.ts` against the service's validated request/response contract.
3. Map initial state, incident details, scenarios, samples, simulation, replay, and manual analysis to their actual supported endpoints.
4. Map incremental events into the existing store, retaining ID-based merges, reconnect resynchronization, and stale-state handling.
5. Route both HTTP and WebSocket paths through the same origin. Keep server credentials out of browser code.
6. Select the connected implementation explicitly; never fall back to sample after a connection failure.

## Development checks

```sh
pnpm run typecheck
PORT=23193 BASE_PATH=/ pnpm --filter @workspace/sentinelsat run build
```

The build command's port and base path match this artifact's managed configuration. They are not a replacement for starting its workflow.
