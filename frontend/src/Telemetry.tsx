import { memo, useLayoutEffect, useRef, useState } from "react";
import type { Config, Row, Stats } from "./protocol";
import { ClassLabel, Fact, classColor, colorTokens, datasetName, focus, fmtTime, pct } from "./presentation";
import type { Selection } from "./Incidents";

export type Snapshot = { rows: Row[]; selected: number; triggerIds: Set<string>; first?: number; last?: number;
  selection?: Selection; openerId?: string; returnRow?: number; disclosures?: string[]; animate?: boolean };
const chartPad = { l: 34, r: 10, t: 10, b: 20 };

function TriggerHighlight({ snapshot, hidden }: { snapshot?: Snapshot; hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const selection = snapshot?.selection;
  const animate = snapshot?.animate;
  useLayoutEffect(() => {
    const band = ref.current;
    if (!band || !animate || !selection || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const style = getComputedStyle(band);
    const timing = style.getPropertyValue("--duration-enter").trim();
    const duration = parseFloat(timing) * (timing.endsWith("ms") ? 1 : 1000);
    const animation = band.animate([{ opacity: 0.85 }, { opacity: 0 }], {
      duration,
      easing: style.getPropertyValue("--ease-out").trim(),
    });
    return () => animation.cancel();
  }, [selection, animate]);
  useLayoutEffect(() => {
    if (hidden) ref.current?.getAnimations().forEach(animation => animation.cancel());
  }, [hidden]);
  if (!animate || snapshot.first == null || snapshot.last == null) return null;
  const slots = Math.max(1, snapshot.rows.length - 1);
  return <div aria-hidden="true" className="trigger-highlight" style={{
    inset: `${chartPad.t}px ${chartPad.r}px ${chartPad.b}px ${chartPad.l}px`,
  }}><div ref={ref} style={{
    left: `calc(${100 * snapshot.first / slots}% - 5px)`,
    right: `calc(${100 * (slots - snapshot.last) / slots}% - 5px)`,
  }} /></div>;
}
const liveRowLimit = 300;
const shortClass: Record<string, string> = { "Storage Exhaustion": "Storage", "Command Flooding": "Flooding",
  "Data Injection": "Injection", "Defence Impairment": "Defence" };

function chartLayout(width: number, height: number, rows: Row[], evidence?: Snapshot) {
  const slots = evidence ? Math.max(2, rows.length) : liveRowLimit;
  const offset = slots - rows.length;
  const step = (width - chartPad.l - chartPad.r) / (slots - 1);
  return {
    rows,
    x: (i: number) => chartPad.l + step * (i + offset),
    y: (score: number) => chartPad.t + (height - chartPad.t - chartPad.b) * (1 - score),
  };
}

function drawChart(c: HTMLCanvasElement, rows: Row[], evidence: Snapshot | undefined, threshold: number) {
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight || 260;
  if (!W) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  const pad = chartPad;
  const { x, y } = chartLayout(W, H, rows, evidence);
  const palette = getComputedStyle(c);
  const accent = palette.getPropertyValue("--chart-accent").trim();
  const muted = palette.getPropertyValue("--chart-ink").trim();
  const colors = new Map([...colorTokens].map(([name, token]) => [name, palette.getPropertyValue(token).trim()]));

  if (evidence?.first != null && evidence.last != null) {
    const start = Math.max(pad.l, x(evidence.first) - 5);
    const end = Math.min(W - pad.r, x(evidence.last) + 5);
    g.fillStyle = accent;
    g.globalAlpha = .16;
    g.fillRect(start, pad.t, end - start, H - pad.t - pad.b);
    g.globalAlpha = 1;
    g.strokeStyle = accent;
    g.strokeRect(start, pad.t, end - start, H - pad.t - pad.b);
  }

  g.font = "11px system-ui, sans-serif";
  g.fillStyle = muted;
  g.strokeStyle = palette.getPropertyValue("--chart-grid").trim();
  g.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke();
    g.fillText(v.toFixed(2), 2, y(v) + 4);
  });


  g.strokeStyle = "rgba(143,160,187,.35)"; g.beginPath();
  rows.forEach((r, i) => (i ? g.lineTo(x(i), y(r.threat)) : g.moveTo(x(i), y(r.threat))));
  g.stroke();
  rows.forEach((r, i) => {
    const passesGuard = r.predicted_class !== "Normal" && r.confidence >= threshold;
    const rad = passesGuard ? 4 : 2.2;
    g.globalAlpha = evidence && evidence.selected !== i && !evidence.triggerIds.has(r.entry_id) ? .34 : 1;
    g.fillStyle = colors.get(r.predicted_class) || muted;
    g.beginPath(); g.arc(x(i), y(r.threat), rad, 0, Math.PI * 2); g.fill();
    if (r.source !== "replay") {
      g.strokeStyle = muted; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x(i), y(r.threat), rad + 2.5, 0, Math.PI * 2); g.stroke();
    }
    if (evidence?.triggerIds.has(r.entry_id)) {
      g.fillStyle = accent;
      g.fillRect(x(i) - 2, y(r.threat) + 8, 4, 4);
    }
    if (evidence?.selected === i) {
      g.strokeStyle = accent; g.lineWidth = 2;
      g.beginPath(); g.arc(x(i), y(r.threat), rad + 5, 0, Math.PI * 2); g.stroke();
    }
  });
  g.globalAlpha = 1;
  g.fillStyle = muted;
  g.fillText(evidence ? "snapshot start" : "older", pad.l, H - 5);
  g.textAlign = "right";
  g.fillText(evidence ? "snapshot end" : "now", W - pad.r, H - 5);
}

const Chart = memo(function Chart({ rows, snapshot, theme, hidden, threshold }: {
  rows: Row[]; snapshot?: Snapshot; theme: string; hidden: boolean; threshold: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (hidden || !ref.current) return;
    const canvas = ref.current;
    const redraw = () => drawChart(canvas, rows, snapshot, threshold);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [rows, snapshot, theme, hidden, threshold]);
  return <canvas id="chart" ref={ref} aria-label={snapshot ? "Frozen telemetry snapshot with the selected row highlighted" : "Threat score of the last 300 telemetry rows"} />;
});
function RowFacts({ row, trigger }: { row: Row; trigger: boolean }) {
  return <><Fact label="Predicted class" value={row.predicted_class} /><Fact label="Model confidence" value={row.confidence.toFixed(3)} />
    <Fact label="Dataset label" value={row.true_class} /><Fact label="Threat score" value={pct(row.threat)} />
    <Fact label="Timestamp" value={fmtTime(row.ts, true)} /><Fact label="Source" value={row.source === "replay" ? "Replay" : "Injected test"} />
    <Fact label="Row ID" value={row.entry_id} />{trigger && <Fact label="Incident evidence" value="Trigger row" />}</>;
}
function FeedRow({ row, selected, trigger, onClick }: { row: Row; selected: boolean; trigger: boolean; onClick: () => void }) {
  return <li><button type="button" className={`telemetry-row${trigger ? " is-trigger" : ""}`} data-row={row.entry_id} aria-pressed={selected} onClick={onClick}>
    <span className="feed-prediction"><small>Predicted</small><ClassLabel name={row.predicted_class} />{trigger && <span className="trigger-label">Trigger row</span>}</span>
    <span className="feed-confidence"><small>Confidence</small>{row.confidence.toFixed(3)}</span>
    <span className="feed-time"><small>Time</small>{fmtTime(row.ts)}<span className="sr-only"> · Row {row.entry_id}</span></span>
    <span className="feed-label"><small>Dataset label</small>{row.true_class ? <ClassLabel name={row.true_class} /> : "Unavailable"}</span>
    <span className="feed-source"><small>Source</small><span className="badge">{row.source === "replay" ? "Replay" : "Injected test"}</span></span>
  </button></li>;
}
export function Telemetry({ hidden, recent, snapshot, setSnapshot, stats, stale, config, theme, openIncidents, backIncident }: {
  hidden: boolean; recent: Row[]; snapshot?: Snapshot; setSnapshot: (snapshot?: Snapshot) => void;
  stats?: Stats; stale: boolean; config?: Config; theme: string; openIncidents: () => void; backIncident: () => void;
}) {
  const [held, setHeld] = useState<Row[] | null>(null);
  const rows = snapshot?.rows ?? recent;
  const position = (snapshot?.selected ?? 0) + 1;
  const selectedRow = snapshot?.rows[snapshot.selected];
  const triggers = snapshot?.rows.flatMap((row, index) => snapshot.triggerIds.has(row.entry_id) ? [index] : []) ?? [];
  const previous = triggers.findLast(index => index < position - 1);
  const next = triggers.find(index => index >= position);
  const source = held ?? rows;
  const end = snapshot ? Math.min(source.length, Math.max(14, position)) : source.length;
  const feed = source.slice(Math.max(0, end - 14), end).reverse();
  const age = stats?.last_row_age_sec == null ? "–" : stats.last_row_age_sec.toFixed(1) + " s ago";
  const total = stats?.rows_total.toLocaleString() ?? "–";
  const opened = (stats?.counts.incidents_opened ?? 0).toLocaleString();
  const classes = config?.classes ?? [];
  const guards = config?.guards ?? { min_confidence: 0.7, min_rows: 5, window_rows: 20 };
  const mixTotal = classes.reduce((sum, name) => sum + (stats?.pred_counts[name] ?? 0), 0);
  function select(index: number) {
    if (snapshot) setSnapshot({ ...snapshot, selected: index });
  }
  function jump(index: number | undefined, direction: number) {
    if (index == null) return;
    select(index);
    if (!triggers.some(candidate => direction * (candidate - index) > 0)) focus("evidence-row");
  }
  function inspect(row: Row) {
    const selected = source.findIndex(item => item.entry_id === row.entry_id);
    if (snapshot) select(selected);
    else setSnapshot({ rows: source, selected, triggerIds: new Set(), openerId: row.entry_id });
    setHeld(null);
    focus("evidence-row");
  }
  function resume() {
    setSnapshot(undefined);
    requestAnimationFrame(() => {
      const opener = snapshot?.openerId;
      const button = opener && document.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(opener)}"]`);
      (button || document.getElementById(opener ? "feed-heading" : "chart-heading"))?.focus();
    });
  }
  return (<section className={`grid wide-workspace${snapshot ? " is-snapshot" : ""}`} id="live-view" aria-labelledby="show-live" hidden={hidden}>
    <div className={`card telemetry-status${stale || (stats && !stats.kafka_ok) ? " is-stale" : ""}`} id="replay-metrics" hidden={!!snapshot} aria-label="Replay session metrics">
      <div className="replay-metric"><span>Rows scored this session</span><strong className="chart-total" id="chart-total">{total}</strong></div>
      <div className="replay-metric"><span>Replay connection</span><strong id="pill-kafka" className={!stale && stats?.kafka_ok ? "ok" : ""}><i className="dot" aria-hidden="true"></i><span id="kafka-status">{stale ? "Reconnecting to replay" : stats ? stats.kafka_ok ? "Kafka connected" : "Kafka disconnected" : "Status unavailable"}</span></strong><small className="replay-freshness" id="mobile-freshness">{stale ? "Last received values" : age === "–" ? "" : "Last row " + age}</small></div>
      <div className="replay-metric"><span>Throughput</span><strong><b id="st-rate">{stats?.rows_per_sec ?? "–"}</b> <small>rows/s</small></strong></div>
      <div className="replay-metric"><span>Median latency</span><strong id="st-lat">{stats?.latency_p50_ms == null ? "–" : Math.round(stats.latency_p50_ms) + " ms"}</strong></div>
    </div>
  <section className="card panel-console" id="card-chart">
    <header className="chart-console">
      <p className="console-label">Scoring workspace</p>
      <div className="console-heading"><h2 id="chart-heading" tabIndex={-1}>{snapshot ? "Telemetry snapshot" : "Threat score"}</h2><span className="console-tag" id="chart-mode">{snapshot ? "Snapshot" : "Live replay"}</span></div>
      <p className="console-source" id="chart-scope">{snapshot ? `${rows.length} captured rows · ${fmtTime(rows[0].ts, true)} to ${fmtTime(rows.at(-1)?.ts, true)}` : "Recent scored telemetry · up to 300 rows"}</p>
      <p className="console-source" id="chart-dataset" hidden={!!snapshot}>Replay dataset · <strong id="st-dataset">{stats ? datasetName(stats.replay_dataset) : "Unknown"}</strong></p>
    </header>
    <div className="chart-main">
      <div className="legend" id="legend">{classes.map(name => <span key={name} title={name}><i style={{background: `var(${classColor(name)})`}} /><span aria-hidden="true">{shortClass[name] ?? name}</span><span className="sr-only">{name}</span></span>)}</div>
      <div className="chart-wrap" id="chart-wrap">
        <Chart rows={rows} snapshot={snapshot} hidden={hidden} theme={theme} threshold={guards.min_confidence} />
        <TriggerHighlight snapshot={snapshot} hidden={hidden} />
      </div>
      <details className="chart-guide"><summary>How to read this chart</summary>
        <p className="hint">Each dot shows a row’s threat score (1 &minus; P(Normal)) and predicted class. Larger dots mark attack predictions that meet the incident manager’s per-row confidence guard (&ge; <span className="g-conf">{guards.min_confidence}</span>). Thin gray rings mark injected rows. A teal outline marks the selected row.</p>
      </details>
    </div>
    <div className="snapshot-header" id="snapshot-header" hidden={!snapshot}><p id="evidence-summary" className="hint">{snapshot?.selection ? `${snapshot.selection.id} · ${triggers.length} of ${snapshot.triggerIds.size} trigger rows captured` : "Snapshot held while new telemetry continues to arrive."}</p><button type="button" className="btn" id="back-live" onClick={resume}>Resume live view</button></div>
  </section>

  <aside className="telemetry-inspector" aria-labelledby="telemetry-inspector-title">
    <section className="card">
      <h2 id="telemetry-inspector-title">{snapshot ? "Selected evidence" : "Replay context"}</h2>
      <div id="live-context" hidden={!!snapshot}>
        <p className="inspector-guide">Select a recent row to inspect its prediction and evidence.</p>
        <dl className="inspector-facts">
          <div><dt>Last row received</dt><dd id="st-last-row">{age}</dd></div>
          <div><dt>Incidents opened this session</dt><dd id="st-incidents">{stats ? opened : "–"}</dd></div>
        </dl>
      </div>
      <div id="chart-evidence" className="evidence-controls" hidden={!snapshot}>
        <dl id="evidence-detail" className="inspector-facts">{selectedRow && <RowFacts row={selectedRow} trigger={!!snapshot?.triggerIds.has(selectedRow.entry_id)} />}</dl>
        <label htmlFor="evidence-row">Inspect snapshot row</label>
        <input id="evidence-row" type="range" min="1" max={snapshot?.rows.length ?? 1} value={position} step="1" onChange={event => select(Number(event.target.value) - 1)} aria-valuetext={selectedRow && `Row ${position} of ${rows.length} · ${fmtTime(selectedRow.ts, true)} · ${selectedRow.predicted_class}`} />
        <p id="snapshot-position" className="hint">{snapshot && `Row ${position} of ${rows.length}`}</p>
        <div className="evidence-actions"><button type="button" className="btn ghost" id="previous-trigger" hidden={triggers.length < 2} disabled={previous == null} onClick={() => jump(previous, -1)}>Previous trigger</button> <button type="button" className="btn ghost" id="next-trigger" hidden={triggers.length < 2} disabled={next == null} onClick={() => jump(next, 1)}>Next trigger</button> <button type="button" className="btn ghost" id="back-incident" hidden={!snapshot?.selection} onClick={backIncident}>Back to incident</button></div>
      </div>
    </section>
    <section className="card prediction-mix" id="prediction-mix" hidden={!!snapshot}>
      <p className="dashboard-label">Scoring session</p>
      <h2>Predictions by class</h2>
      <p className="hint">All scored rows since server start, including injected tests.</p>
      <ul id="prediction-counts">{classes.map(name => { const count = stats?.pred_counts[name] ?? 0; return <li key={name}><span><ClassLabel name={name} /></span><b>{count.toLocaleString()}</b><span className="mix-track" aria-hidden="true"><i style={{width: `${mixTotal ? 100 * count / mixTotal : 0}%`, background: `var(${classColor(name)})`}} /></span></li>; })}</ul>
    </section>
  </aside>

  <section className="card" id="card-feed">
    <div className="card-head"><div><p className="dashboard-label">Evidence history</p><h2 id="feed-heading" tabIndex={-1}>{snapshot ? "Snapshot telemetry rows" : "Recent telemetry rows"}</h2></div><span className="hint">Select a row to inspect</span></div>
    <p className="hint" id="feed-held" role="status" hidden={!held}>Rows are held while you navigate the feed. Replay continues in the background.</p>
    <ul id="feed" className="telemetry-rows"
      onFocus={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(rows); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(null); }}
    >{feed.length ? feed.map(row => <FeedRow key={row.entry_id} row={row} selected={selectedRow?.entry_id === row.entry_id} trigger={!!snapshot?.triggerIds.has(row.entry_id)} onClick={() => inspect(row)} />) : <li className="hint">Waiting for scored telemetry.</li>}</ul>
  </section>
  <details className="pipeline-details">
    <summary>Pipeline health</summary>
    <dl className="pipeline-metrics">
      <div><dt>Session accuracy</dt><dd id="st-acc">{pct(stats?.accuracy)}</dd><small>All labeled rows since server start, including injected tests.</small></div>
      <div><dt>Configured agent mode</dt><dd id="st-mode">{config?.agent_mode ?? "–"}</dd></div>
    </dl>
<section className="pipeline" aria-label="Pipeline">
  <div className="stage svc"><span>Producer</span><small>CSV replay + inject</small></div>
  <div className="arrow"></div>
  <div className="stage topic"><span>telemetry.raw</span></div>
  <div className="arrow"></div>
  <div className="stage svc"><span>Detector</span><small>XGBoost per row</small></div>
  <div className="arrow"></div>
  <button type="button" className="stage topic" onClick={() => focus("feed-heading")} aria-controls="card-feed" aria-label="Go to live feed"><span>telemetry.scored</span><b id="pc-rows">{stats ? total : 0}</b></button>
  <div className="arrow"></div>
  <div className="stage svc"><span>Incident manager</span><small id="pc-guard">{config ? `${guards.min_rows} of ${guards.window_rows} rows ≥ ${guards.min_confidence}` : "guards"}</small></div>
  <div className="arrow"></div>
  <button type="button" className="stage topic" onClick={openIncidents} aria-controls="card-incidents" aria-label="Go to incidents"><span>incidents</span><b id="pc-inc">{opened}</b></button>
  <div className="arrow"></div>
  <div className="stage svc"><span>4 AI agents</span><small>Live analysis or cached example</small></div>
  <div className="arrow"></div>
  <div className="stage topic"><span>reports</span><b id="pc-rep">{(stats?.counts.reports_finished ?? 0).toLocaleString()}</b></div>
</section>
    <p className="pipeline-link"><a href="http://localhost:8081" target="_blank" rel="noopener">Open Kafka UI</a></p>
  </details>
</section>);
}
