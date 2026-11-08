# Dashboard migration checklist

The baseline is the FastAPI dashboard served from the former static HTML and JavaScript. The React implementation keeps its hash routes and stylesheet.

| View | Behaviors to verify |
| --- | --- |
| Overview | Replay metrics, light and dark theme persistence, all five cached scenarios, loading and retry states, focus on the walkthrough, telemetry shortcut |
| Telemetry | Connection and freshness, throughput and latency, chart and legend, prediction counts, recent feed with keyboard hold, frozen row selection, resume and focus restoration, pipeline links |
| Incidents | Initial SQLite history, open and closed groups, search and three filters, report lifecycle and provenance, trigger preview and snapshot navigation, disclosure and focus restoration, Escape |
| Threat Lab | Simulation dialog and validation, clean and noisy samples, restore previously loaded sample, feature editing and validation, single and burst submissions, previous result, run progress and incident shortcut |
| How it works | Workflow comparison, evaluation notes, and hosted manual-analysis link |
| Shared | Hash navigation and browser history, desktop and mobile layout, disconnected status and reconnect, accessible control names |

## Browser contract

- `GET /api/state` combines the bridge's statistics and last 300 scored rows with the recorder's 50 most recent incidents and the configured classes, features, and incident guards.
- `GET /api/incidents/{incident_id}` provides stored incident and report details. SQLite fields can be null and a newly opened incident can return 404 while the recorder catches up. Updates received while the detail request is in flight take precedence over the corresponding fields in the response.
- `GET /api/demo-scenarios` reads the cached walkthroughs. Each record can have classification, review status, SPARTA context, mitigation text, and narrative. This endpoint makes no agent calls.
- `GET /api/sample?cls=...&quality=...` returns a dataset label and numeric feature values. The editor requires every configured feature and clears the submitted ground truth when a value has been edited.
- `POST /api/panel/send` accepts features, count, optional ground truth, and interval. `POST /api/attack` accepts attack class, count, and quality. Both return entry IDs and a count. The tracker matches scored rows and decisions by entry ID, including events received before the HTTP response.
- `/ws` sends optional telemetry, incident, and report arrays with periodic stats. Telemetry contains an entry ID, epoch timestamp, predicted class, confidence and threat score, with nullable source, ground truth, and latency. Incident discriminators are `opened`, `updated`, `closed`, and `entry_decision`. Report discriminators are `started` and `finished`, with a mode and optional analysis fields. The browser sends a text keepalive every 20 seconds.
- The client buffers frames while refreshing state, uses the session row count to discard overlapping telemetry, and merges incident and report fields using their timestamps. It applies each validated frame together and retains up to 300 live rows and 1,000 recent entry decisions. Evidence snapshots keep their captured rows as replay continues.
