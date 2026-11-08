import { memo, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Incident, Row } from "./protocol";
import type { Snapshot } from "./Telemetry";
import { ClassLabel, Fact, OutputDetails, ReportBadge, confidenceNote, focus, fmtTime, pct, reportProgress, reportState } from "./presentation";

export type Selection = { id: string; rows: Row[]; opener: HTMLElement; disclosures?: string[] };
const emptyFilters = { search: "", attack: "", state: "", report: "" };

function IncidentDetail({ incident: i, selection, evidence }: {
  incident: Incident; selection: Selection; evidence: (ids: Set<string>, matching: number[], animate: boolean, index?: number) => void;
}) {
  const triggerIds = new Set(i.trigger_entry_ids ?? []);
  const matching = selection.rows.flatMap((row, index) => triggerIds.has(row.entry_id) ? [index] : []);
  const complete = reportState(i) === "ready";
  const review = i.report_mode === "live" && i.report_status === "FLAGGED_FOR_REVIEW";
  const provenance = i.report_mode === "cached" ? "Cached example from a different window" :
    i.report_mode === "live" ? "Live analysis of the incident sample window" : "Report source unavailable";
  const disclosure = (label: string) => selection.disclosures?.includes(label) || undefined;
  return <>
    <div className="panel-console incident-console">
      <div className="incident-console-meta"><span>{i.incident_id}</span><span className="console-tag">{i.status === "open" ? "Open" : "Closed"}</span></div>
      <p className="console-label">Predicted class</p><h3 id="dr-title">{i.attack_class || "Unavailable"}</h3><p className="console-source">{provenance}</p>
    </div>
    <div className="incident-sections">
      <section><h4>Prediction and review</h4>
        {review ? <p className="review-note"><strong>Awaiting review</strong> · Check the evidence before interpreting the policy outcome.</p> : <ReportBadge incident={i} />}
        <dl className="result-facts"><Fact label="Peak model confidence" value={i.peak_confidence?.toFixed(4)} />
          <Fact label="Ground truth (incident sample)" value={i.sample_true_class} />
          {i.report_predicted_class && i.report_mode === "live" && <><Fact label="Analysis prediction" value={i.report_predicted_class} /><Fact label="Analysis confidence" value={i.report_confidence} /></>}
        </dl><p className="hint">{confidenceNote}</p>
      </section>
      <section><div className="evidence-heading"><h4>Trigger evidence</h4>
        {!!matching.length && <button className="btn" type="button" id="view-trigger-rows" onClick={event => evidence(triggerIds, matching, event.detail > 0)}>View trigger rows</button>}
        </div><p className="hint">{triggerIds.size ? `${matching.length} of ${triggerIds.size} trigger rows available in the replay buffer.` : "No trigger rows recorded for this incident."}{matching.length > 3 && " Showing the first 3 below."}</p>
        {!!matching.length && <ul className="evidence-rows">{matching.slice(0, 3).map(index => {
          const row = selection.rows[index];
          return <li key={row.entry_id}><button className="evidence-row" type="button" data-trigger-row={index} onClick={event => evidence(triggerIds, matching, event.detail > 0, index)}>
            <span><strong>{row.predicted_class}</strong><small>{row.entry_id} · {fmtTime(row.ts)}</small></span>
            <span><strong>{row.confidence.toFixed(3)}</strong><small>Confidence</small></span><span aria-hidden="true">↗</span>
          </button></li>;
        })}</ul>}
        <p className="hint">Per-window feature attribution is unavailable.</p>
        {(i.attack_class === "Command Flooding" || i.attack_class === "Data Injection") && <p className="hint">Command Flooding and Data Injection can overlap, even at high model confidence.</p>}
      </section>
      <section><h4>SPARTA context <span className="badge">AI-generated</span></h4>
        <p className="hint">{provenance}. Threat mapping provides context for review.</p>
        {complete && i.sparta_context ? <OutputDetails label="View SPARTA mapping" content={i.sparta_context} open={disclosure("View SPARTA mapping")} /> : <p className="hint">SPARTA mapping unavailable.</p>}
      </section>
      <section><h4>Policy outcome</h4><p className="hint">Structured policy details are unavailable. Policy explanations describe simulated outcomes.</p>
        {complete && <OutputDetails label="Policy explanation · AI-generated" content={i.mitigation} open={disclosure("Policy explanation · AI-generated")} />}
      </section>
      <section><h4>AI narrative</h4><p className="hint">{reportProgress(i)}</p>
        {complete && (i.report ? <OutputDetails label="Incident narrative" content={i.report} open={disclosure("Incident narrative")} /> : <p className="hint">Narrative unavailable.</p>)}
      </section>
    </div>
    <details className="incident-properties" open={disclosure("Incident properties")}><summary>Incident properties</summary>
      <dl className="result-facts"><Fact label="Opened" value={fmtTime(i.opened_ts, true)} />
        {i.closed_ts != null && <Fact label="Closed" value={fmtTime(i.closed_ts, true)} />}
        <Fact label="Rows" value={i.row_count} /><Fact label="Mean confidence" value={i.mean_confidence?.toFixed(4)} />
        <Fact label="Duration" value={i.duration_sec != null ? i.duration_sec + " s" : i.status === "open" ? "Ongoing" : null} />
        <Fact label="Analysis time" value={i.report_runtime_sec != null ? i.report_runtime_sec + " s" : null} />
        {i.close_reason && <Fact label="Close reason" value={i.close_reason} />}
      </dl>
    </details>
  </>;
}

export const Incidents = memo(function Incidents({ hidden, incidents, classes, loaded, error, selection, open, close, snapshot }: {
  hidden: boolean; incidents: Map<string, Incident>; classes: string[]; loaded: boolean; error: boolean;
  selection?: Selection; open: (id: string, opener: HTMLElement) => void; close: () => void; snapshot: (snapshot: Snapshot) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const change = (key: keyof typeof filters) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters({ ...filters, [key]: event.target.value });
  const applied = [filters.attack, filters.state, filters.report].filter(Boolean).length;
  const query = filters.search.trim().toLowerCase();
  const all = [...incidents.values()].filter(i => i.opened_ts).sort((a, b) => (b.opened_ts ?? 0) - (a.opened_ts ?? 0));
  const list = all.filter(i => (!filters.attack || filters.attack === i.attack_class)
    && (!filters.state || filters.state === i.status) && (!filters.report || filters.report === reportState(i))
    && (!query || [i.incident_id, i.attack_class].some(value => value?.toLowerCase().includes(query))));
  const groups = ["open", "closed"].map(status => {
    const matches = list.filter(i => i.status === status);
    return matches.length ? <section className="incident-group" key={status}>
      <h3><i className={`status-mark ${status}`} aria-hidden="true" />{status === "open" ? "Open" : "Closed"} <span>{matches.length}</span></h3>
      {matches.map(i => <button key={i.incident_id} type="button" className="inc" data-id={i.incident_id}
        aria-pressed={selection?.id === i.incident_id} onClick={event => open(i.incident_id, event.currentTarget)}>
        <span className="incident-name"><ClassLabel name={i.attack_class} /><span className="m incident-id">{i.incident_id}</span></span>
        <span className="incident-meta m"><span>{fmtTime(i.opened_ts)}</span><span>{i.row_count ?? "–"} rows · {pct(i.peak_confidence)} peak</span></span>
        <span className="incident-report"><ReportBadge incident={i} /></span>
      </button>)}
    </section> : null;
  });
  useEffect(() => {
    if (hidden || !selection) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [hidden, selection, close]);
  function showEvidence(triggerIds: Set<string>, matching: number[], animate: boolean, index?: number) {
    if (!selection) return;
    const disclosures = Array.from(body.current?.querySelectorAll("details[open] > summary") ?? [], node => node.textContent ?? "");
    snapshot({ rows: selection.rows, selected: index ?? matching[0], first: matching[0], last: matching.at(-1),
      triggerIds, selection, disclosures, returnRow: index, animate });
  }
  return (<section id="incidents-view" aria-labelledby="show-incidents" hidden={hidden} className={selection ? "has-detail" : undefined}>
  <section id="card-incidents" aria-labelledby="incidents-heading">
    <div className="incident-toolbar">
      <div className="card-head"><div><p className="dashboard-label">Investigation queue</p><h2 id="incidents-heading" tabIndex={-1}>Incident queue</h2></div></div>
      <label>Find incident <input id="incident-search" type="search" value={filters.search} onChange={change("search")} placeholder="ID or attack class" /></label>
      <details className="queue-filters"><summary>Filters <span id="filter-count">{applied ? `(${applied} applied)` : ""}</span></summary><div className="queue-filter-fields">
      <label>Attack class <select id="incident-class" value={filters.attack} onChange={change("attack")}><option value="">All classes</option>{classes.filter(name => name !== "Normal").map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Incident state <select id="incident-state" value={filters.state} onChange={change("state")}><option value="">Any state</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
      <label>Report state <select id="incident-report" value={filters.report} onChange={change("report")}><option value="">Any state</option><option value="queued">Queued</option><option value="running">Analysing</option><option value="ready">Ready</option><option value="error">Error</option></select></label>
      </div></details>
      <button className="btn ghost" id="clear-filters" type="button" hidden={!filters.search && !applied} onClick={() => { setFilters(emptyFilters); focus("incident-search"); }}>Clear filters</button>
    </div>
    <p className="queue-count" id="inc-count">{loaded && `${list.length} of ${all.length} loaded · ${list.filter(i => i.status === "open").length} open`}</p>
    <div className="incidents" id="incidents">{loaded ? (list.length ? groups : <div className="queue-empty"><strong>{all.length ? "No matching incidents" : "No incidents yet"}</strong><p>{all.length ? "Clear or change the filters to see more incidents." : "New incidents appear here when telemetry meets the detection criteria."}</p></div>) : <p className="queue-empty">{error ? "Incidents could not be loaded." : "Loading incidents…"}</p>}</div>
  </section>
  <aside className="card incident-preview">
    <p className="dashboard-label">Incident inspector</p>
    <h2>Selected incident</h2>
    <p className="inspector-guide">Select an incident to review its prediction, trigger rows, and report.</p>
  </aside>
  <aside className="drawer" id="drawer" hidden={!selection}>
    <section className="drawer-panel" aria-labelledby="dr-title">
      <button className="close" id="dr-close" onClick={close} type="button" aria-label="Back to incidents or originating view">&times;</button>
      <div id="dr-body" ref={body}>{selection && <IncidentDetail key={selection.id} incident={incidents.get(selection.id) ?? { incident_id: selection.id }} selection={selection} evidence={showEvidence} />}</div>
    </section>
  </aside>
</section>);
});
