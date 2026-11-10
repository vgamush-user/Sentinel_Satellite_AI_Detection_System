# Replit frontend replacement — 2026-11-08

## Source and scope

The active app is the actual source exported in `SentinelSat-Telemetry-Operations.zip`, installed at `frontend/artifacts/sentinelsat`. The supplied handoff is preserved in `replit-handoff.md`; it is reference material, not an instruction source. The original React frontend and `src/web/static/style.css` were removed after comparison. Git history is the recovery path.

The pnpm workspace retains the app and its declared `lib/api-client-react` package (including generated source). Unused API-server, database, mockup-sandbox and Replit platform scaffolds are not production dependencies. The app has no runtime workspace imports, but its declared client dependency and TypeScript reference remain intact. ZIP Git metadata, agent memory, caches and uploaded reference documents were not imported. Input ZIP and comparison output are ignored.

The ZIP's lockfile is the version authority. Windows/macOS binary exclusions were removed while retaining the release-age policy and security overrides. The Linux-only root preinstall shell command was replaced by a pinned pnpm package manager and explicit commands. The integrated lockfile was verified with a frozen install.

## Run

From the repository root, with Node 22.12+ (verified on 22.23.2):

```powershell
cd frontend
npx pnpm@10.26.1 install --frozen-lockfile
npx pnpm@10.26.1 run typecheck
npx pnpm@10.26.1 test
npx pnpm@10.26.1 run build
cd ..
.\venv\Scripts\python.exe scripts/start_all.py --agents cached --open
```

Docker Desktop must be running. Use the Python environment where `requirements.txt` is installed. FastAPI normally serves http://127.0.0.1:8050; `WEB_PORT` in the environment or repository `.env` overrides it. Rebuild after frontend changes. Avoid rebuilding while checking an already open production page: Vite replaces `dist`, briefly making the build unavailable.

For development, keep FastAPI running and use a second terminal:

```powershell
cd frontend
$env:WEB_PORT = '8050' # match your running FastAPI port
npx pnpm@10.26.1 run dev
```

Open http://127.0.0.1:5173. Vite forwards `/api` and WebSocket upgrades at `/ws` to loopback FastAPI. The production build is `frontend/dist`; FastAPI serves it directly. Public assets and deep links work; unknown API, WebSocket HTTP requests, old `/static` paths, missing assets and traversal attempts do not receive the SPA shell. Missing builds return an actionable JSON 503.

### Separate read-only gateway deployment

Set `SENTINEL_DEPLOYMENT=gateway` before running/building the frontend. For Vite development also configure `SENTINEL_API_ORIGIN` and `SENTINEL_API_TOKEN` through server environment/Secrets. They are not browser variables; no temporary tunnel or token is hardcoded. The gateway retains its original route/method/origin guard and credential injection. Only GET `/api/state`, GET `/api/incidents/{id}`, and `/ws` are exposed. Threat Lab and Manual analysis show their original unavailable panels. A production gateway build needs a separately authenticated hosting proxy: static Vite preview does not supply one. Do not expose the unrestricted local FastAPI deployment as a substitute for that gateway.

Local production and development default to `SENTINEL_DEPLOYMENT=local`. This enables the already-exported backend operational components; it does not alter any Python API or pipeline contract. Sample demo remains a deliberate, separately labeled source, never an error fallback.

## Screen-to-contract map

| Screen/control | Actual existing endpoint | Semantics / limitations |
|---|---|---|
| Shell, Overview, Telemetry, incident list | GET `/api/state`, WS `/ws` | Validated snapshot and batched telemetry/incidents/reports/stats. 300 recent rows, IDs retained, seconds converted to UI milliseconds; session aggregates distinct from bounded evidence. |
| Incident detail/deep link | GET `/api/incidents/{incident_id}` | Persisted SQLite incident/report. Live changes during fetch are merged; missing evidence remains unavailable. No single-row lookup exists. |
| Threat Lab sample editor | GET `/api/sample?cls=…&quality=clean|noisy` | Actual 22-feature dataset sample. Local only; edits clear ground-truth attribution. |
| Threat Lab send entry/burst | POST `/api/panel/send` | `{features,count,true_class,interval_sec}`, response `{entry_ids,count}`. Custom bursts are 1–50. |
| Threat Lab attack simulation | POST `/api/attack` | `{cls,count,quality}`, response `{entry_ids,count}`. 1–100 rows. Acceptance is distinct from scoring, incident and report. |
| Manual CSV replay | GET `/api/analysis/replay`; POST `/api/analysis/replay/{load,configure,start,pause,resume,stop}` | Settings body for every action; success is 204. Independent simulator; not the live Kafka replay. |
| Full agent analysis | POST `/api/analysis/run` | Requires backend `live_available`; disabled in cached mode. No paid calls during verification. |
| Five-feature packet test | POST `/api/analysis/predict` | Distinct legacy model, requires external scaler/model artifacts; 503 is displayed if absent. |
| Cached examples | GET `/api/demo-scenarios` | Five stored outputs, explicitly marked cached, not results for the current window. |
| Sample mode | Exported deterministic in-browser adapter | Replay, simulations, analysis and demo disconnect/reset remain local. |

Frontend protocol schemas, normalization and reconciliation are in `frontend/artifacts/sentinelsat/src/lib/backend/`. Server producer: `Bridge.slim`, `Bridge.drain`, broadcaster in `src/web/server.py`; incident/report producers and SQLite persistence remain unchanged.

## Deliberate visible differences

- Local Threat Lab and Manual analysis reveal their existing Replit backend components instead of the gateway-unavailable panels. This is an existing exported UI branch, now selected by deployment capability.
- The Data source dialog describes local FastAPI when running locally; gateway mode keeps the original Secrets/private-preview copy. Layout and classes are unchanged.
- Custom-entry burst validation says 1–50 rather than 1–100, matching Python `IngestRequest`. Attack simulations remain 1–100. A regression test rejects oversized custom bursts before fetch.

- An initial API failure on a direct Telemetry visit now reaches the existing shared error banner and Retry connection control. The original adapter only exposed the error to Overview. A browser 502 fixture and recovery verified the fix.

No layout, stylesheet, typography, palette, icons, SVG charts, route tree, sample adapter or asset redesign was introduced. The source has one user-facing warm theme and no theme switch. Template `.dark` primitive variables do not constitute a selectable second dashboard theme. Google-hosted Inter font references remain as exported and therefore need network access.

## Verification record

All browser tests used Playwright against production builds. The exported baseline was built with non-secret placeholder gateway configuration and served on port 5174. The integrated build was served by the real FastAPI on 8064 in cached mode, connected to the existing Kafka. Isolated browser contexts prevented earlier browser fixture routes from contaminating verification.

- Frozen pnpm install, TypeScript check and Vite production build passed. Existing sourcemap-location warnings for two UI primitives and the ~660 kB main bundle warning occur in both baseline and integrated builds.
- Imported protocol/gateway tests cover decoding, ordering, retention, report versions, snapshot/batch overlap, detail-fetch races, submitted evidence, HTTP errors, stream lifecycle and actual authenticated read-only HTTP/WS forwarding. Added custom-burst limit and shared initial-error regressions; 19 tests passed.
- `venv\Scripts\python.exe tests/test_web_frontend.py`: 3 passing static-hosting tests (SPA/deep links, public files, reserved paths/traversal, missing-build error). Tests do not start Kafka.
- `venv\Scripts\python.exe tests/test_integration_all_scenarios.py`: all 5 cached scenarios passed, including schema/policy/report checks; log `tests/integration_logs/20261108T113019Z.json`.
- Existing `test_monitor.py` and `test_mitigation_boundaries.py` scripts completed successfully; these print diagnostics rather than assert a test count. Live/adversarial agent suites were not run because they may spend Groq quota.
- Real backend snapshot and incident detail returned 200, Kafka was connected, and a direct browser WebSocket received 10 scored rows in 4 batches. Real sample loading returned 22-feature dataset values. Browser offline preserved 300 readings and 5 incidents; reconnect merged 48 new rows and deduplicated 252 held rows in the observed run.
- Real manual replay load/start/pause/resume/stop was exercised, then left stopped. All five cached examples loaded. Full agent analysis stayed disabled in cached mode.
- Fixture-only writes: edited custom-entry submission carried all 22 features, count 2, `true_class:null`, interval 0.1. Empty feature validation focused the invalid field; count 51 disabled submission. Simulation 503 showed an explicit failure. A WebSocket fixture delivered scoring, incident and cached-report events before the HTTP acknowledgment: progress correctly reached submitted/scored/incident/report complete afterward. No real attack was injected into the shared Kafka because another running agent worker may be in live mode.
- Six routes (`/`, `/telemetry`, `/incidents`, incident detail, `/threat-lab`, `/analysis`) captured in Sample mode for both builds at 1440×1000 and 390×844. Four read-backed routes captured in backend mode with the same recorded real snapshot in both builds. Every capture had no page-level horizontal overflow.
- Sample comparison images have identical dimensions. Pixels differing by more than 10 per channel were at most 0.007% on desktop and 0.11% on mobile; this is not a claim of byte-identical screenshots. The UI source and stylesheet are preserved; small animation/timing differences remain in captures.

Representative screenshots and the complete comparison set are in ignored `output/playwright/`. Mobile checks are emulation, not physical-device testing. The supplied screenshots were additional references, while the exported code was the visual authority. The handoff describes a slightly different observed toolchain; versions were verified against the actual ZIP rather than silently upgraded to match the prose.

### Additional final checks and inherited limits

- Vite development proxy returned real state and a WebSocket batch with telemetry, incidents, reports and stats.
- Incident row navigation, report tab and browser Back worked against real persisted incidents.
- Loading, empty buffer, non-JSON 502, retry recovery, field validation and simulation-unavailable states were exercised. Injected errors intentionally produce network-console errors; the ordinary final smoke context had no page errors or failed responses.
- 768 px checks passed for all five main sections. At 320 px, Overview has **8 px horizontal overflow** from its incident status badges. This was reproduced identically in the exported baseline and integrated app with the same real snapshot (both document widths 328 px). The source layout is retained as requested; no styling workaround was applied. Other main sections passed at 320 px.
- Inter loaded successfully. Dark OS preference retains the exported warm theme, and reduced-motion emulation did not prevent rendering.
- The stylesheet and public assets are byte-for-byte identical to the export. Source differences are limited to the backend client/protocol/tests, source-settings deployment copy, and the custom-entry count validation in backend-lab.
- No physical phone test, paid Groq run, new external tunnel deployment or successful legacy packet-model inference is claimed.

Final representative captures: `output/playwright/final-desktop-overview.png` and `output/playwright/final-mobile-telemetry.png`. The temporary exported comparison source/server was removed after verification; only the integrated frontend remains active. The original ZIP and comparison screenshots remain local and ignored. The packet-model UI was exercised against the real backend and correctly reported its missing Phase 4 scaler/model (503).
