import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Incidents, type Selection } from "./Incidents";
import { Overview, Method } from "./Overview";
import { ManualAnalysis } from "./ManualAnalysis";
import { Telemetry, type Snapshot } from "./Telemetry";
import { ThreatLab } from "./ThreatLab";
import { incident, request, type Decision, type Incident, type Row } from "./protocol";
import { focus } from "./presentation";
import { useReplay } from "./useReplay";
import "../../src/web/static/style.css";

const titles = { overview: "Overview", live: "Telemetry", incidents: "Incidents", lab: "Threat Lab", analysis: "Manual analysis", method: "How it works" };
type View = keyof typeof titles;
const routes: Record<View, string> = { overview: "overview", live: "telemetry", incidents: "incidents", lab: "threat-lab", analysis: "manual-analysis", method: "how-it-works" };
const readView = (): View => (Object.keys(routes) as View[]).find(view => "#" + routes[view] === location.hash) ?? "overview";
const emptyRows: Row[] = [];
const emptyClasses: string[] = [];
const emptyIncidents = new Map<string, Incident>();
const emptyDecisions = new Map<string, Decision>();

type Notification = { id: number; message: string };
function Toast({ item, remove }: { item: Notification; remove: (id: number) => void }) {
  const [phase, setPhase] = useState("");
  useEffect(() => {
    const enter = requestAnimationFrame(() => setPhase("show"));
    const leave = window.setTimeout(() => setPhase("leaving"), 4000);
    return () => { cancelAnimationFrame(enter); clearTimeout(leave); };
  }, []);
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => remove(item.id), 180);
    return () => clearTimeout(timer);
  }, [phase, remove, item.id]);
  return <div className={`toast error ${phase}`}><span className="toast-icon">⚠</span><span className="toast-msg">{item.message}</span>
    <button className="toast-close" aria-label="Dismiss" onClick={() => setPhase("leaving")}>&times;</button></div>;
}

function App() {
  const { data, loading, error, stale, retry, store } = useReplay();
  const [view, setView] = useState(readView);
  const activeView = useRef(view);
  const scroll = useRef(new Map<View, number>());
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("sentinelsat-theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("sentinelsat-theme", theme); } catch { /* Theme still applies. */ }
  }, [theme]);
  const navigate = useCallback((next: View, target?: string, fromHistory = false, restoreScroll = fromHistory) => {
    const changed = next !== activeView.current;
    if (changed) scroll.current.set(activeView.current, window.scrollY);
    activeView.current = next;
    if (!fromHistory && location.hash !== "#" + routes[next]) history.pushState(null, "", "#" + routes[next]);
    setView(next);
    if (changed) requestAnimationFrame(() => window.scrollTo(0, restoreScroll ? scroll.current.get(next) ?? 0 : 0));
    if (target) focus(target, target === "workspace-title");
  }, []);
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const pop = () => navigate(readView(), "workspace-title", true);
    window.addEventListener("popstate", pop);
    return () => { history.scrollRestoration = previous; window.removeEventListener("popstate", pop); };
  }, [navigate]);
  const [selection, setSelection] = useState<Selection>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const incidentRequest = useRef<AbortController | undefined>(undefined);
  const recent = data?.recent ?? emptyRows;
  const incidents = data?.incidents ?? emptyIncidents;
  useEffect(() => () => incidentRequest.current?.abort(), []);
  function inspect(next: Selection, returning?: Snapshot) {
    incidentRequest.current?.abort();
    const controller = new AbortController();
    incidentRequest.current = controller;
    const baseline = incidents.get(next.id);
    setSelection(next);
    navigate("incidents", undefined, false, !!returning);
    requestAnimationFrame(() => {
      const trigger = returning?.returnRow != null && document.querySelector<HTMLElement>(`[data-trigger-row="${returning.returnRow}"]`);
      (trigger || (returning && document.getElementById("view-trigger-rows")) || document.getElementById("dr-close"))?.focus({ preventScroll: !!returning });
    });
    void request(`/api/incidents/${encodeURIComponent(next.id)}`, incident, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted && value.incident_id === next.id) store(value, baseline); })
      .catch(() => { /* The recorder may still be persisting the incident. */ });
  }
  function openIncident(id: string, opener: HTMLElement) {
    inspect({ id, rows: recent, opener });
  }
  function closeIncident() {
    incidentRequest.current?.abort();
    setSelection(undefined);
    if (selection?.opener.id === "tracker-incident") {
      navigate("lab", selection.opener.hidden ? "show-simulation" : "tracker-incident");
    } else if (selection) {
      requestAnimationFrame(() => {
        const button = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(selection.id)}"]`);
        (button ?? document.getElementById("incident-search"))?.focus({ preventScroll: true });
      });
    }
  }
  function openSnapshot(next: Snapshot) {
    incidentRequest.current?.abort();
    setSelection(undefined);
    setSnapshot(next);
    navigate("live", "evidence-row");
  }
  function backIncident() {
    if (snapshot?.selection) inspect({ ...snapshot.selection, disclosures: snapshot.disclosures }, snapshot);
  }
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const toastId = useRef(0);
  const notify = useCallback((message: string) => {
    const item = { id: ++toastId.current, message };
    setNotifications(items => [...items, item]);
  }, []);
  const removeToast = useCallback((id: number) => setNotifications(items => items.filter(item => item.id !== id)), []);
  return <><div className="dashboard-shell">
<aside className="sidebar">
  <div className="brand"><div className="logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="30" height="30"><circle cx="16" cy="16" r="5" fill="currentColor" /><ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-25 16 16)" /></svg>
    </div><div><strong>SentinelSat</strong><small>CubeSat telemetry security</small></div></div>
  <nav className="workspace-nav" aria-label="Dashboard views">
    <button type="button" className="btn" id="show-overview" aria-controls="overview-view" aria-pressed={view === "overview"} onClick={() => navigate("overview", "workspace-title")}><svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M3 7h12M7 7v8" /></svg>Overview</button>
    <button type="button" className="btn" id="show-live" aria-controls="live-view" aria-pressed={view === "live"} onClick={() => navigate("live", "workspace-title")}><svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9h3l2-5 3 10 2-5h4" /></svg>Telemetry</button>
    <button type="button" className="btn" id="show-incidents" aria-controls="incidents-view" aria-pressed={view === "incidents"} onClick={() => navigate("incidents", "workspace-title")}><svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h12M3 9h12M3 14h12" /><path d="M6 4h.01M6 9h.01M6 14h.01" /></svg>Incidents</button>
    <button type="button" className="btn" id="show-lab" aria-controls="lab-view" aria-pressed={view === "lab"} onClick={() => navigate("lab", "workspace-title")}><svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 2h4M8 2v5l-4 7a1 1 0 0 0 1 2h8a1 1 0 0 0 1-2l-4-7V2M6 11h6" /></svg>Threat Lab</button>
    <span className="nav-section" aria-hidden="true">Learn</span>
    <button type="button" className="btn" id="show-method" aria-controls="method-view" aria-pressed={view === "method"} onClick={() => navigate("method", "workspace-title")}><svg aria-hidden="true" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="9" cy="9" r="6" /><path d="M9 8v4M9 5.5v1" /></svg>How it works</button>
    <button type="button" className="btn" id="show-analysis" aria-controls="analysis-view" aria-pressed={view === "analysis"} onClick={() => navigate("analysis", "workspace-title")}>Manual analysis</button>
  </nav>
</aside>

<div className="workspace">
  <header className="top">
    <h1 id="workspace-title" tabIndex={-1}>{titles[view]}</h1>
    <button className="btn ghost" id="theme-toggle" type="button" aria-pressed={theme === "dark"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Dark theme</button>
  </header>
  <main>
    <div className="card replay-notice" id="replay-notice" hidden={!error}><p id="replay-notice-text" role="status">Replay is unavailable. Cached samples can still be explored.</p><button className="btn" id="retry-replay" disabled={loading} onClick={retry} type="button">Retry connection</button></div>
<Overview hidden={view !== "overview"} stats={data?.stats} stale={stale} error={error} openTelemetry={() => navigate("live", "workspace-title")} /><Method hidden={view !== "method"} /><ManualAnalysis hidden={view !== "analysis"} /><Telemetry hidden={view !== "live"} recent={recent} snapshot={snapshot} setSnapshot={setSnapshot} stats={data?.stats} stale={stale} config={data?.config} theme={theme} openIncidents={() => navigate("incidents", "incidents-heading")} backIncident={backIncident} /><Incidents hidden={view !== "incidents"} incidents={incidents} classes={data?.config.classes ?? emptyClasses} loaded={!!data} error={error} selection={selection} open={openIncident} close={closeIncident} snapshot={openSnapshot} /><ThreatLab hidden={view !== "lab"} config={data?.config} recent={recent} incidents={incidents} decisions={data?.decisions ?? emptyDecisions} notify={notify} openIncident={openIncident} /></main>
</div>
</div>

<div id="toast-root" className="toast-container" aria-live="polite">{notifications.map(item => <Toast key={item.id} item={item} remove={removeToast} />)}</div></>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
