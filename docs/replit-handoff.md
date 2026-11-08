# SentinelSat Replit Technical Handoff

Prepared from the current workspace and rendered preview on **2026-11-08**.

## 1. Scope and preservation requirements

This handoff describes the **current Replit frontend**, not a proposed replacement.
Preserve its styling, layout, navigation, copy, assets, responsive behavior, and interactions when moving it into the existing SentinelSat repository.
The original dashboard uploads are functional references, not the visual specification.

**Current integration status**

- Real telemetry state, persisted incident detail, and WebSocket updates have been verified through the authenticated gateway to the user's Windows backend.
- The approved gateway is **read-only**: `GET /api/state`, `GET /api/incidents/:incident_id`, and WebSocket `/ws`.
- Simulation, custom-entry submission, replay control, packet scoring, window analysis, and cached-example fetching are **not authorized through this gateway**. Their implementation is retained, but connected-mode pages explain their unavailability and do not send those requests.
- The local Sample demo is separate, deterministic, and not production model output.
- This is a development-preview connection. The current static production artifact does not run Vite's server proxy.

### Existing ZIP

The user has already downloaded the source ZIP. **No replacement ZIP was created or inspected for this handoff.** Its contents and download time cannot be certified from this workspace.

The correct complete-project export root is `/home/runner/workspace`, containing `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `artifacts/`, and `lib/`. Exporting only `artifacts/sentinelsat` loses workspace configuration and declared package references.

Check the downloaded archive includes at least:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
tsconfig.base.json
artifacts/sentinelsat/package.json
artifacts/sentinelsat/vite.config.ts
artifacts/sentinelsat/server/gateway.ts
artifacts/sentinelsat/src/
artifacts/sentinelsat/public/
lib/api-client-react/
```

For a complete editable workspace, retain the other workspace manifests and source too. Before distributing the archive, exclude `.git/`, `.env` files with real values, credentials, session/cookie files, logs, `node_modules/`, caches, `.local/`, generated `dist/` directories, coverage, and `*.tsbuildinfo`. Inspect and sanitize registry configuration such as `.npmrc` if included. Do not export Replit Secrets values.

Keep generated **source** such as `lib/api-client-react/src/generated/`; it is not the same as disposable build output. Uploaded references under `attached_assets/` are not imported by the active frontend and are not required runtime assets; review them for relevance and privacy before sharing.

This newly created handoff and its screenshot files are separate additions and are not automatically present in the ZIP already downloaded.

## 2. Project structure and toolchain

### Main locations

| Path | Role |
|---|---|
| `artifacts/sentinelsat/` | Frontend package/root |
| `artifacts/sentinelsat/index.html` | HTML entry, metadata, favicon, font links |
| `artifacts/sentinelsat/src/main.tsx` | React mounting and stylesheet import |
| `artifacts/sentinelsat/src/App.tsx` | Providers, source initialization, Wouter routes |
| `artifacts/sentinelsat/src/pages/` | Screens |
| `artifacts/sentinelsat/src/components/` | Shell, reusable kit, inspector, charts, reports |
| `artifacts/sentinelsat/src/components/ui/` | Existing Radix/shadcn-style primitives |
| `artifacts/sentinelsat/src/components/backend/` | Original-backend operational workspaces and persistence helpers |
| `artifacts/sentinelsat/src/lib/sentinel/` | UI types, shared store, deterministic sample source/adapter, formatters |
| `artifacts/sentinelsat/src/lib/backend/` | Real API schemas, client, reducer, normalization, adapter/context/settings |
| `artifacts/sentinelsat/server/gateway.ts` | Server-only Vite proxy, route and origin guards |
| `artifacts/sentinelsat/public/` | `favicon.svg`, `robots.txt` |
| `artifacts/sentinelsat/.replit-artifact/artifact.toml` | Replit service, path routing, environment, static production configuration |
| `lib/api-client-react/` | Declared workspace dependency and TypeScript reference; generated API client source |
| `lib/api-spec/`, `lib/api-zod/`, `lib/db/` | Other template workspace packages; retain for full workspace reproduction |
| `artifacts/api-server/` | Existing template API scaffold; **not** the user's FastAPI backend |
| `artifacts/mockup-sandbox/` | Separate design-preview artifact, not a dashboard route |
| `docs/design-reference.md` | Design preservation reference |
| `docs/backend-connection.md` | Gateway configuration and limitations |

The frontend declares `@workspace/api-client-react` and references its TypeScript project. A search of the active frontend source found **no runtime `@workspace/` imports**. The real SentinelSat integration uses its custom client and Zod parsers, not the template generated React Query endpoints. Removing workspace packages requires deliberately updating manifests and TypeScript references; do not simply omit them.

### Versions and package manager

- Observed runtime: **Node.js v24.22.1**.
- Observed package manager: **pnpm 10.26.1**.
- Lockfile: root `pnpm-lock.yaml`.
- React/React DOM: catalog pin **19.1.0**.
- Vite: installed build reported **7.3.7**.
- TypeScript: root manifest `~5.9.3`.
- Tailwind CSS 4 with `@tailwindcss/vite`; catalog range `^4.1.14`.
- Wouter 3, Zod 3, Radix UI primitives, Lucide icons, TanStack Query provider.

Most frontend dependencies are intentionally declared under `devDependencies`: they are bundled into the static client. Do not install this package with development dependencies omitted before building.

### Commands: preserve workspace first

Run from the **repository/workspace root**, not from an isolated copied source directory.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/sentinelsat run dev
pnpm --filter @workspace/sentinelsat run build
pnpm --filter @workspace/sentinelsat run serve
```

Both dev and build load `vite.config.ts`, which currently requires `PORT`, `BASE_PATH`, and the two server gateway settings. Supply these through the process environment before invoking the commands.

For POSIX shells, after privately configuring the real gateway settings:

```sh
PORT=23193 BASE_PATH=/ pnpm --filter @workspace/sentinelsat run dev
PORT=23193 BASE_PATH=/ pnpm --filter @workspace/sentinelsat run build
```

PowerShell equivalent for the non-secret settings:

```powershell
$env:PORT = "23193"
$env:BASE_PATH = "/"
pnpm --filter @workspace/sentinelsat run dev
# Or:
pnpm --filter @workspace/sentinelsat run build
```

The existing config directly reads `process.env`; do not assume placing a `.env` file beside it automatically populates those values during config evaluation.
Use a private environment mechanism, or explicitly adapt environment loading during migration.

Build output is **`artifacts/sentinelsat/dist/public/`**. The `serve` script is Vite preview, not a FastAPI production deployment or a replacement for Replit access control.

For a build-only environment without real gateway credentials, syntactically valid placeholders can satisfy the current config validation; building does not connect to the upstream:

```sh
PORT=23193 BASE_PATH=/ \
SENTINEL_API_ORIGIN=https://gateway.example.invalid \
SENTINEL_API_TOKEN=BUILD_ONLY_PLACEHOLDER \
pnpm --filter @workspace/sentinelsat run build
```

These are placeholders, not usable runtime credentials. A migration may separate gateway startup configuration from static-build configuration instead.

### Important Windows/macOS portability issue

`pnpm-workspace.yaml` contains Linux-oriented overrides excluding many Windows/macOS `esbuild` and `lightningcss` binary packages.
Do not assume a frozen install of this exact workspace works on Windows unchanged.
Review those platform exclusions and install the correct host binaries; update the lockfile intentionally on a migration branch if needed.
Preserve the dependency versions and existing supply-chain safeguards rather than broadly upgrading the UI stack.

## 3. Screens and interactions

Routes are defined in `artifacts/sentinelsat/src/App.tsx`, inside `Shell` and a route-resetting error boundary. Wouter's base comes from `import.meta.env.BASE_URL`, with its trailing slash removed.

| URL | Source | Layout and behavior |
|---|---|---|
| `/` | `src/pages/overview.tsx` | Mission overview; four colored metric cards; connected-mode pipeline health; channel chart with time-range/hold controls; incident summary and evidence links; recent readings table. Counts use session stats, not the 300-row window. |
| `/telemetry` | `src/pages/telemetry.tsx` | Channel, source and prediction selectors; ID search; 2/5/10/15-minute windows; pan/hold/return-to-latest; chart; sortable, paginated reading table; reading inspector. Table filters do not filter the plot's full channel. Page size is 50. |
| `/incidents` | `src/pages/incidents.tsx` | Search/filter/sort incident list; class, lifecycle, report and source information; links to detail. Backend row counts are distinct from evidence still available in the client buffer. |
| `/incidents/:id` | `src/pages/incident-detail.tsx` | Back navigation, lifecycle/class/status summary, evidence chart/channel control, and tabs for Timeline, Trigger readings, SPARTA context, and Report & mitigation. Fetches persisted detail for deep links. Raw properties and unavailable evidence are explicit. |
| `/threat-lab` | `src/pages/threat-lab.tsx` | In Sample demo: labeled scenarios, count/intensity controls, local run tracking and evidence links. In gateway mode: existing page header and a read-only/unavailable panel; no sample load, simulation or submission requests. |
| `/analysis` | `src/pages/analysis.tsx` | In Sample demo: labeled sample loading, feature inputs, validation, local classifier result, confidence/explanation/SPARTA/mitigation, clear/copy/raw details. Does not create incidents. In gateway mode: explicit unavailability of replay/scoring/analysis/cached examples. |
| Any unmatched path | `src/pages/not-found.tsx` | Not-found page with navigation back to Overview. |

`components/backend/backend-lab.tsx` retains the grouped message/window/memory editor, clean/noisy sample selection, single/burst controls and entry-ID run tracker.
`components/backend/backend-analysis.tsx` retains independent dataset replay, metrics, label mix, row evidence, window analysis, packet scoring and cached examples.
They are **implemented but gated off** for the current read-only browser gateway.

### Shared shell and evidence navigation

`src/components/shell.tsx` provides:

- Desktop left navigation and mobile drawer.
- Source badge, transport/Kafka status, freshness, stale/resync/error notices.
- Data source dialog.
- Connected mode: backend-owned live stream and Resync.
- Sample mode: play/pause, stepping, 1×/2×/5× speeds, and Demo menu for disconnect/reconnect/reset. Reset has a confirmation dialog.

Reading links use `/telemetry?reading=<id>&at=<milliseconds>`. Incident evidence links use `/incidents/<id>` with optional `at` and `reading` query context.
IDs should be encoded; preserve source IDs rather than generating replacements.

The reading inspector is a desktop side panel and a full-screen mobile dialog. It shows source/provenance, predicted class, confidence, ground truth when supplied, threat score, feature values, probabilities when supplied, incident/decision linkage, and raw payload.
Selection retains a last copy when a row leaves the rolling window.
Submitted-run evidence has an additional bounded retention mechanism. Arbitrary old telemetry deep links still cannot retrieve a row from the backend: **there is no single-entry lookup endpoint**.

## 4. Design implementation

### Styles and colors

Primary stylesheet: **`artifacts/sentinelsat/src/index.css`**.
It imports Tailwind, `tw-animate-css`, and the typography plugin, and defines semantic CSS variables in `@theme inline` plus shared primitive tokens under `:root`.

The seven source palette colors are:

| Token | Value |
|---|---|
| `--color-palette-red` | `#ff0000` |
| `--color-palette-orange` | `#fbb034` |
| `--color-palette-yellow` | `#ffdd00` |
| `--color-palette-lime` | `#c1d82f` |
| `--color-palette-blue` | `#00a4e4` |
| `--color-palette-taupe` | `#8a7967` |
| `--color-palette-slate` | `#6a737b` |

Current warm surfaces include canvas `#fbf7ef`, nav `#fffaf0`, panel `#fffefb`, and raised `#fffdf8`.
The UI uses dark semantic text plus sky, sun, peach, leaf and blush tints; do not replace these with full-saturation fills everywhere.
Legacy token names such as `lav`, `mint`, `amber` and `rose` are current semantic aliases, not permission to substitute a different theme.
Primary action text is intentionally dark on the red action treatment.

### Fonts, icons and assets

- Inter is loaded **externally from Google Fonts**, both through the main CSS import and HTML font links. There are no bundled Inter font files in the public asset inventory.
- Sans fallback, monospace fallback, radius and other primitive tokens are in `index.css`.
- `index.html` requests Inter weights through 700; the CSS import requests 400/500/600.
- Icons primarily use `lucide-react`; the shell mark and chart graphics are implemented in components/SVG.
- Public files inspected: `public/favicon.svg`, `public/robots.txt`.
- There are no imported uploaded photographs or separate application image bundles in the active source.
- `@assets` points to root `attached_assets/` in Vite config, but no active frontend import uses it.

Keep the Google Font links for visual parity, or deliberately vendor the same Inter weights and update the references if offline operation is required.
The root-relative favicon link `/favicon.svg` needs review if the migrated app is mounted below `/`.

### Reusable components and responsive rules

- `components/kit.tsx`: buttons, panels, panel headers, page headers, fields, selects, segmented controls, prediction/class/lifecycle/report badges, skeletons, empty/error/raw/copy helpers.
- `components/ui/`: existing underlying primitives and dialog/dropdown/tab behavior.
- `components/telemetry-chart.tsx`: custom SVG telemetry chart, not a replacement Recharts dashboard. Preserve line styling, incident spans, flagged points, hatched gaps, tooltip and selection treatment.
- Chart keyboard behavior includes arrows to inspect points, Enter/Space to open, Escape to clear, and larger navigation steps with Shift.
- `components/reading-inspector.tsx`: evidence dialog.
- `components/report-prose.tsx`: safe report rendering; do not replace with unrestricted raw HTML injection.
- `components/error-boundary.tsx`: route-resetting error recovery.

Tailwind default responsive variants are used: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px. No replacement breakpoint system was found in the inspected theme.
The desktop nav begins at `lg`, is 216px wide, and the content container has a 1600px maximum.
The mobile drawer is 272px wide, limited by viewport width.
The inspector becomes a 460px right-side panel at `md`; below that it occupies the screen.
Keep the existing responsive utility classes rather than reconstructing the layout.

### Theme and persisted preferences

The active theme is the current light theme. Theme variables initialize through CSS, not a user-facing theme switch.
A dark variant declaration and the `next-themes` dependency exist, but they are not an active dashboard dark-mode feature.

Persisted browser state:

| Key/pattern | Meaning |
|---|---|
| `sentinelsat.backend.connection.v1` | Intentional `{mode:"gateway"}` or `{mode:"sample"}` selection. Default is gateway. Legacy saved direct URLs are ignored. |
| `sentinelsat.sample.v1` | Local sample adapter/replay persistence, not backend state. |
| `sentinelsat.backend.<same-origin-base>.<name>` | Non-secret backend form drafts and run records, using `components/backend/shared.tsx`. Names include lab/editor/runs/replay workspaces. |

Many screen filters and sample form fields are ordinary React local state, not durable preferences.
Do not claim that every filter/editor survives navigation or reload.
No authentication token belongs in these keys.

## 5. Data flow and ownership

### Initialization

```text
main.tsx
  -> App.tsx
     -> backend/settings.ts selects explicit Sample demo or default same-origin gateway
     -> BackendClient + ConnectedAdapter, or existing SampleAdapter
     -> BackendProvider (raw backend state)
     -> SentinelProvider (normalized UI state)
     -> Wouter + Shell + screen
```

`QueryClientProvider` exists in `App.tsx`, but the active telemetry stream is **not** primarily a React Query cache.
The shared state uses `useSyncExternalStore`.
Do not rewire this migration to template generated hooks without reproducing the current merge/selection behavior.

### Real backend path

```text
browser same-origin request /api/state or /api/incidents/<id>, WS /ws
  -> Replit path router
  -> Vite gateway in server/gateway.ts
  -> authenticated HTTPS Windows gateway
  -> existing FastAPI backend
  -> backend/protocol.ts validation
  -> backend/reducer.ts snapshot/event merge
  -> backend/normalize.ts UI conversion
  -> backend/adapter.ts normalized adapter events
  -> sentinel/store.tsx
  -> screen and shared components
```

- `useBackend()` exposes raw config/recent/incidents/stats, decisions, transport, errors and retained submitted evidence.
- `useSentinel()` exposes normalized UI state.
- `useAdapter()` supplies actions; connected adapters reject sample-only playback/reset/report retry.
- Overview reads normalized metrics and raw backend pipeline values.
- Telemetry reads the bounded rows/config and preserves selected evidence.
- Incidents reads normalized incidents; detail additionally calls the persisted incident endpoint.
- Threat Lab and Manual Analysis switch on connected state and gateway capability; their unavailable panels do not start unauthorized polling.

Wire timestamps are **epoch seconds**. Normalized UI timestamps are **milliseconds**.
Normalization preserves IDs, source class names, confidence and optional ground truth.
It creates `features.threat_score` for charting; that synthetic UI channel is not a model input.
Class labels are dynamic, with identity fallback; `Normal` and demo `nominal` are both recognized as non-attack predictions.

Backend aggregate totals/rates/accuracy are not reconstructed from the bounded buffer.
`readingIds` available locally and backend `row_count` can differ, particularly for old/cached incidents.
Kafka health and WebSocket transport health are separate.
Confidence is a model score, not proof that an event is malicious.

### Sample path

`artifacts/sentinelsat/src/lib/sentinel/sample-source.ts` supplies deterministic readings, fixtures, scenarios, classifier and explanation metadata.
`artifacts/sentinelsat/src/lib/sentinel/adapter.ts` manages local replay, scheduled injected sample readings, incidents and local report generation.
The demo uses nominal/jamming/spoofing/command-injection classes and a fixed sample timeline; it is not the backend's five-class detector.
Sample reports/classification are local/template behavior, not live agent/model verification.

## 6. HTTP integration contract

Defining parsers/types: **`src/lib/backend/protocol.ts`**.
HTTP behavior and capabilities: **`src/lib/backend/client.ts`**.
Every response below is parsed; malformed responses remain errors.

### Approved and live-verified gateway routes

| Transport | Path | Input | Output |
|---|---|---|---|
| GET | `/api/state` | No query/body | Initial snapshot `{config,recent,incidents,stats}` |
| GET | `/api/incidents/:incident_id` | Encoded ID path segment; no query/body | One incident object, not a list envelope |
| WebSocket | `/ws` | Same-origin WS/WSS upgrade; no browser credential/query | Batch objects described below |

Gateway state:

```ts
{
  config: {
    classes: string[];
    features: string[];
    agent_mode: string;
    guards: {
      min_confidence: number;
      min_rows: number;
      window_rows: number;
      close_gap_rows?: number;
    };
  };
  recent: BackendRow[];
  incidents: BackendIncident[];
  stats: {
    kafka_ok: boolean;
    rows_total: number;
    rows_per_sec: number;
    accuracy: number | null;
    replay_dataset: string | null;
    latency_p50_ms: number | null;
    last_row_age_sec: number | null;
    counts: Record<string, number>;
    pred_counts: Record<string, number>;
  };
}
```

Rows require `entry_id`, `ts`, `predicted_class`, `confidence`, `threat`.
Optional/nullish fields include `true_class`, `source`, `latency_ms`, `seq`, `burst_id`, feature map `f` (numeric or null values), and `probabilities`.

Incident objects require `incident_id`; remaining fields are optional/nullish:

- `attack_class`, `status`, `opened_ts`, `last_seen_ts`, `closed_ts`.
- `row_count`, `peak_confidence`, `mean_confidence`, `duration_sec`, `close_reason`.
- `trigger_entry_ids`, `sample_true_class`.
- `report_status`, `report_mode`, `report_runtime_sec`, `report_started_ts`, `report_finished_ts`.
- `report_predicted_class`, `report_confidence`, `report`, `sparta_context`, `mitigation`.

The incident schema preserves additional properties with `.passthrough()`.
Lifecycle and report state are independent; a closed incident may still have a pending report.
Cached report provenance must not be described as analysis of the current evidence window.

### Additional original-backend contracts: not exposed by this gateway

These methods exist in the retained client/components and match the inspected original implementation. **They were not exercised against the live backend through the current read-only gateway.**

| Method/path | Request | Response/capability |
|---|---|---|
| GET `/api/sample` | Query `cls`, `quality=clean\|noisy` | `{features:Record<string,number>,true_class,quality,dataset}` |
| POST `/api/panel/send` | `{features,count,true_class:string\|null,interval_sec}` | `{entry_ids:string[],count}`; acknowledgements validate that count equals returned ID count |
| POST `/api/attack` | `{cls,count,quality:"clean"\|"noisy"}` | Same acknowledgement |
| GET `/api/analysis/replay` | None | Replay state below |
| POST `/api/analysis/replay/load` | Replay settings | May return 204 |
| POST `/api/analysis/replay/configure` | Replay settings | May return 204 |
| POST `/api/analysis/replay/start` | Replay settings | May return 204 |
| POST `/api/analysis/replay/pause` | Settings body in retained client | May return 204 |
| POST `/api/analysis/replay/resume` | Settings body in retained client | May return 204 |
| POST `/api/analysis/replay/stop` | Settings body in retained client | May return 204; do not invent reset counts |
| POST `/api/analysis/run` | `{}` | Full-window result; source may return 409 for busy/no row and 503 for unavailable live agents |
| POST `/api/analysis/predict` | Numeric `MsgLength`, `CmdCode`, `TimeRadians`, `ApId`, `MsgId` | `{prediction_class,is_anomaly,confidence_score,status}`; missing model/scaler is unavailable |
| GET `/api/demo-scenarios` | None | Class/name-keyed cached examples with optional classification/status/report/SPARTA/mitigation |

Replay settings are `{dataset:"noised"|"raw", speed:1..200, order:"sequential"|"shuffled", loop:boolean, buffer_size:20..500}`.
The retained replay client sends a body for all six actions.
The UI refresh interval is a polling setting, not replay speed.

Replay output contains `dataset`, `state` (`stopped/running/paused/finished`), `total_rows`, `rows_emitted`, `elapsed`, `speed`, `order`, `loop`, numeric/null `rows`, `monitor:boolean|null`, and `live_available`.

Window-analysis output contains `dataset`, `row`, `message_id`, `monitor`, nullable `label`, `prediction`, `confidence`, `status`, and optional `action`, `guardrail`, `report`, `sparta`, `mitigation`.

Submission UI uses 1–100 entries and a 0.1-second interval for custom sends. Editing any configured sample feature clears `true_class` to null instead of retaining misleading dataset ground truth.
Samples must contain all configured finite numeric features.
Progress correlates returned entry IDs to actual scored rows, decisions, incidents and reports, not timers.

There is no original-backend report-retry endpoint, no browser CSV-upload endpoint, and no single-telemetry-row history endpoint. Dataset load means selecting server-side `noised`/`raw` data, not uploading a file.

### Errors

- Requests have a 20-second client timeout and optional caller cancellation.
- Non-2xx JSON responses propagate string `detail` when present, otherwise a status-based error.
- Non-JSON and schema-mismatched responses are explicit errors.
- HTTP 204 is accepted only where the action caller explicitly allows an empty response.
- Browser clients reject non-allowlisted API calls before fetching.
- Proxy writes to read routes receive 405; disallowed API paths/queries receive 404 when handled by the frontend service; cross-origin browser access is rejected.
- Upstream authentication failure is not a successful sample response. Transport failure remains an error/stale state.
- Other `/api` paths may be owned by the separate template API artifact in Replit; they are never forwarded by this credential-bearing gateway.

## 7. WebSocket, recovery and merge invariants

URL construction is same-origin and base-aware:
the client appends `/ws` to its gateway base and converts HTTP→WS or HTTPS→WSS.
No token is placed in URL query parameters or WebSocket subprotocols.

Each frame is an object with optional arrays/fields:

```ts
{
  telemetry?: BackendRow[];
  incidents?: (
    | {event:"entry_decision"; entry_id:string; incident_id?:string|null;
       decision:string; detail:string}
    | (BackendIncident & {event:"opened"|"updated"|"closed"})
  )[];
  reports?: {
    event:"started"|"finished";
    incident_id:string;
    attack_class:string;
    mode:string;
    started_ts?:number|null;
    status?:string;
    finished_ts?:number|null;
    runtime_sec?:number|null;
    predicted_class?:string|null;
    confidence?:number|null;
    report?:string|null;
    sparta_context?:string|null;
    mitigation?:string|null;
  }[];
  stats?: BackendStats;
}
```

Behavior in `backend/client.ts` and `backend/reducer.ts`:

1. Bootstrap an HTTP snapshot; subscribe/resynchronize when the socket opens.
2. Buffer frames while snapshot hydration is in flight. Abort superseded synchronization requests.
3. Use session row totals to handle frames straddling the snapshot cursor.
4. Deduplicate by `entry_id`, sort using sequence/timestamp, retain the newest 300 recent rows.
5. Merge incident lifecycle and report versions separately; older snapshots must not reopen closed incidents or overwrite newer reports.
6. When persisted detail returns, preserve live fields changed since that fetch began (`mergeStored`).
7. Send a text `ping` every 20 seconds; reconnect after socket close using a 2-second delay and rehydrate.
8. Reject malformed frames and expose an error. Keep stale data visibly labeled instead of replacing it with fixtures.
9. Retain submitted evidence/decisions separately for up to 1,000 tracked IDs. Normal decisions are otherwise bounded at 1,000 records.
10. Stop sockets, timers and in-flight synchronization on cleanup.

Do not collapse every ordinary frame into a resync banner or reset freshness merely because a duplicate row arrived.
Backend `last_row_age_sec` and WebSocket connection status serve different purposes.

## 8. Proxy and authentication

Server-only implementation: **`artifacts/sentinelsat/server/gateway.ts`**, called by **`vite.config.ts`**.

The server validates the configured origin, fails clearly if either required gateway setting is absent, and injects `Authorization: Bearer <server-token>` on both ordinary proxy requests and WebSocket upgrades.
Incoming browser Authorization does not replace the server credential.
Browser cookies and proxy-authentication headers are not forwarded upstream; upstream cookies/authentication headers are removed from responses.
Responses are marked `no-store`; upstream redirects are not followed.

The route list is narrowly enumerated, with method/origin/path checks, encoded-path validation, and no caller-selected target.
Do not replace it with a generic `/api` proxy to make disabled controls appear functional.
The server's generic transport error must not serialize an exception/request object that might contain the injected credential.

### Environment names only

| Name | Purpose | Example placeholder / handling |
|---|---|---|
| `PORT` | Required positive Vite port | `23193` |
| `BASE_PATH` | Required Vite/app base | `/` or reviewed subpath |
| `SENTINEL_API_ORIGIN` | Server-only authenticated gateway HTTPS origin | `https://gateway.example.invalid` |
| `SENTINEL_API_TOKEN` | Server-only token; code adds Bearer | `<TOKEN_ONLY_DO_NOT_COMMIT>` |
| `VITE_SENTINEL_SOURCE` | Legacy sample-adapter setting, default `sample`; not the current gateway URL selector | Do not use for credentials |
| `REPL_ID` | Optional Replit development-tool detection | Platform supplied; not required locally |
| `NODE_ENV` | Development-tool conditional behavior | Managed by toolchain |

`SESSION_SECRET` is not required by this frontend/gateway. `DATABASE_URL` belongs to the separate template database/API packages, not to this frontend's real FastAPI connection.

The current temporary tunnel URL is **not hardcoded in active frontend/server source or Vite config**; it is configured in Secrets. A filename-only search found a historical literal in `.local/tasks/sentinelsat-data-controls-integration.md`, which should be excluded from the export.
Do not treat that historical value as a permanent service address.

The user confirmed **Private preview** was enabled before proxy activation.
Private preview is a Replit platform protection, not an app login implemented in this codebase.
Replicate appropriate access control outside Replit; merely serving the same UI publicly does not preserve this protection.

## 9. Feature/capability mapping

| Control/feature | Sample demo | Current backend gateway | Migration action |
|---|---|---|---|
| Overview metrics/charts | Deterministic local data | Real state + live updates | Preserve scope, normalization, units |
| Telemetry filtering/hold/inspect | Local replay rows | Real bounded rows | Preserve selection and stable IDs |
| Incident list/deep links | Local incident state | State + persisted GET detail | Keep API route before SPA fallback |
| Report/SPARTA/mitigation | Local templates/metadata | Supplied live/cached fields; missing data labeled | Preserve provenance; no invented attribution |
| Shell replay play/pause/step/speed | Works locally | Not a live-stream control | Keep contexts separate |
| Demo reset/disconnect/reconnect | Works locally | Reset not exposed; Resync reconnects | Never reset real backend as a demo action |
| Labeled scenario simulation | Local deterministic injection | Unavailable | Requires explicitly approved POST route |
| Custom feature editor/sample loading | Separate backend integration retained | Unavailable | Requires sample GET + send POST authorization |
| Burst/scored/decision/report tracking | Local sample run trace | Retained implementation, no submissions | Real acknowledgements/events required |
| Manual single-reading analysis | Local classifier, not persisted as incident | Unavailable | Do not label sample prediction as backend |
| Independent server CSV replay | Not shell sample playback | Unavailable | Requires replay GET/actions and dataset availability |
| Full-window agent analysis | Not a live agent guarantee | Unavailable | Requires authorized route and real live-agent availability |
| Five-feature packet model | Not the sample feature classifier | Unavailable | Requires authorized route + trusted model/scaler |
| Cached example fetch | Local reports are different | Unavailable endpoint; incident cached reports can still display | Never label another window's example as current evidence |
| Report retry | Sample behavior | Not exposed by original backend | Do not invent endpoint |
| Theme toggle | None in current product | None | Preserve light design |

The main live-data views are not placeholders. Blocked controls are explicit capability restrictions, not silent simulated successes.

## 10. Porting to the existing FastAPI repository

### Preserve first, adapt infrastructure second

1. Copy the source package, public assets, styles, server reference, tests and needed workspace configuration intact on a migration branch. Keep the existing backend unchanged initially.
2. Reproduce the current appearance with the supplied styles/components. Avoid translating it into the uploaded original dashboard layout or rebuilding it with a different component library.
3. Choose either continued pnpm workspace layout or a deliberate standalone-package conversion. In a standalone conversion, resolve `catalog:` versions, the `workspace:*` dependency, and root TypeScript references explicitly.
4. Review Linux-only binary overrides before installing on Windows/macOS.
5. Remove/adapt Replit-only development tooling (`@replit/vite-plugin-*`, `.replit`, artifact descriptors, managed port injection) where not supported. Keep React, Tailwind and alias behavior.
6. Build the frontend and let the existing FastAPI application serve static assets and the SPA HTML. Register existing HTTP/WebSocket API routes **before** the SPA catch-all.
7. Add a real SPA fallback for `/telemetry`, `/incidents/:id`, `/threat-lab`, `/analysis` and not-found handling. A plain static directory's `html=True` setting alone is not a universal deep-link fallback.
8. Serve `/assets/*`, `/favicon.svg`, and `/robots.txt` correctly. API, WebSocket and missing asset requests must not be swallowed into `index.html`.
9. Keep HTTP/WebSocket browser URLs same-origin. If the existing FastAPI endpoints match the approved paths and are safely authenticated, the browser need not know an upstream token or tunnel URL.
10. If a server-to-server credential is still needed, keep a backend-for-frontend/reverse-proxy layer. Do not move its secret into Vite browser variables to avoid maintaining that layer.
11. For mounting below `/`, update Vite base, Wouter base, static asset references, API/WS route prefixes and server mounts together. The HTML favicon currently assumes `/`.
12. Only re-enable operational controls after explicitly authorizing their paths/methods and checking their real request/response/event contracts. Do not widen the read-only gateway implicitly.

### Replit assumptions to replace

- Root web preview path `/`; frontend service port 23193.
- Explicit frontend service paths `/`, `/api/state`, `/api/incidents`, `/ws`.
- A separate scaffold API artifact owns general `/api` paths. Replit matches the more specific frontend paths first.
- Vite listens on `0.0.0.0`, permits proxied hosts, uses strict port binding and a strict filesystem boundary.
- `@` resolves to the frontend `src`; `@assets` resolves to workspace uploads.
- Browser gateway base uses `location.origin` and Vite's `BASE_URL`.
- Generated template API source is not the SentinelSat contract; the custom parsers are.
- Published artifact is currently `serve = "static"` with SPA rewrites; that does not execute `server/gateway.ts`.
- No local database migration is needed to copy this frontend. Do not replace the existing FastAPI database with the unused Replit scaffold.

## 11. Verification evidence and limits

### Checks actually run earlier in this same working session

The following were run after the authenticated connection changes and before this documentation-only handoff. They are not being represented as fresh reruns during document writing:

```sh
pnpm run typecheck
pnpm --filter @workspace/sentinelsat exec tsx --test \
  server/gateway.test.ts src/lib/backend/backend.test.ts
PORT=23193 BASE_PATH=/ pnpm --filter @workspace/sentinelsat run build
```

Results:

- Workspace type checking passed.
- **17 tests passed**: contract parsing, normalization, lifecycle/report merge races, deduplication, snapshot overlap, source selection, rejected browser capabilities, configuration validation, allowlisting/origin guards, and actual fixture HTTP/WebSocket server-side authentication.
- Build passed. Existing non-fatal warnings: UI sourcemap reporting and a JavaScript chunk above 500 kB.
- Built browser assets had no matches for server credential/configuration markers (`SENTINEL_API_TOKEN`, `SENTINEL_API_ORIGIN`, tunnel hostname markers, or Bearer header text). This was a static marker check, not a general security audit.
- A real `GET /api/state` through the shared preview router returned schema-valid data with all five backend classes, 300 rows, five incidents and Kafka connected at that check.
- A real persisted incident GET passed its schema and identified a cached report.
- Real `/ws` traffic passed the batch schema. A separate **25-second stream check received 94 valid frames and 248 telemetry rows** without early closure.
- Actual read-route POST was rejected with 405; a disallowed state query was rejected with 404.
- Desktop Overview, desktop incident detail, mobile Threat Lab, and mobile Manual Analysis were visually inspected during implementation. This was not an interactive browser test of every control.

### Fresh handoff captures

Two screenshots were captured while preparing this handoff:

- Desktop Overview, **1440×1000**: `generated-artifacts/handoff/overview-desktop.jpg`.
- Mobile Telemetry, **402×874**: `generated-artifacts/handoff/telemetry-mobile.jpg`.

Both show the actual reconnecting/stale-data banner at capture time while retaining backend rows. Do not edit these images to imply continuous connectivity, or interpret a screenshot alone as proof of an end-to-end stream test.
No application code or styles were changed to prepare the handoff.

![Desktop Overview](generated-artifacts/handoff/overview-desktop.jpg)

![Mobile Telemetry](generated-artifacts/handoff/telemetry-mobile.jpg)

These generated screenshot files are excluded from Git/deployment and supplied separately for download. Put them at the paths above if viewing the Markdown locally with its image links.

### Not verified / not claimed

- Contents or sanitization of the ZIP already downloaded by the user.
- Installation/build on the user's Windows/macOS machine or inside the destination repository.
- FastAPI static hosting, SPA deep links, authentication or WS behavior after migration.
- Live simulation, submission, replay control, window analysis, packet model, report retry or CSV upload through the restricted gateway.
- Availability of the Windows backend, agents, Kafka, model files or temporary tunnel after the recorded checks.
- Every hidden dialog/tab/keyboard flow through an interactive browser test.
- A standalone security/SEO scan or production deployment.

## 12. Migration acceptance checklist

- [ ] Editable source and required workspace/package configuration are present, with no real secrets or disposable output.
- [ ] Windows/macOS dependency binaries install correctly without unintended UI upgrades.
- [ ] Typography, palette, metric cards, shell, chart, inspector, tables and responsive states match the screenshots/current source.
- [ ] Every listed client route loads directly as well as through navigation.
- [ ] `/api` errors and `/ws` are never served SPA HTML.
- [ ] Browser requests contain no server gateway token; access control still protects forwarded telemetry.
- [ ] Snapshot, incident and batch responses pass the existing parsers.
- [ ] Seconds/milliseconds, IDs, labels, backend guard rules and aggregate scopes remain correct.
- [ ] Refresh/reconnect preserves deduplication, report/lifecycle ordering and selected evidence.
- [ ] Demo data remains explicitly labeled and is never an automatic fallback for backend failure.
- [ ] Only explicitly authorized additional controls are enabled; unavailable models/agents remain errors, not placeholder successes.
- [ ] No production deployment relies on the Vite development proxy or Replit Private preview alone.
