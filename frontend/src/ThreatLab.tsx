import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { request, sample, submission, type Config, type Decision, type Incident, type Row, type Sample } from "./protocol";
import { ClassLabel, Fact, focus, reportProgress, reportState } from "./presentation";

type Run = { label: string; error?: string; ids?: string[]; trueClass?: string | null; rows: Map<string, Row>; decisions: Map<string, Decision> };
function FeatureInput({ feature, value, changed, invalid, change }: {
  feature: string; value: string; changed: boolean; invalid: boolean; change: (feature: string, value: string) => void;
}) {
  const id = "feature-" + feature;
  return <label title={feature}>{feature}<input type="number" step="any" id={id} data-f={feature}
    className={invalid ? "invalid" : changed ? "changed" : undefined} value={value}
    aria-invalid={invalid || undefined} aria-describedby={invalid ? id + "-error" : undefined}
    onChange={event => change(feature, event.target.value)} />
    {invalid && <small className="feature-error" id={id + "-error"}>Enter a number.</small>}</label>;
}
function Step({ state, title, children }: { state: "done" | "run" | "wait" | "no" | "err"; title: string; children?: ReactNode }) {
  const labels = { done: "Complete", run: "In progress", wait: "Waiting", no: "Skipped", err: "Failed" };
  return <li className={state}><b>{title}</b><span className="step-status">{labels[state]}</span><span>{children}</span></li>;
}
function runIncident(run: Run, incidents: Map<string, Incident>) {
  for (const decision of run.decisions.values()) {
    if (decision.incident_id && incidents.has(decision.incident_id)) return incidents.get(decision.incident_id);
  }
  return [...incidents.values()].find(i => i.trigger_entry_ids?.some(id => run.ids?.includes(id)));
}
function RunSummary({ run }: { run: Run }) {
  const rows = [...run.rows.values()];
  const single = run.ids?.length === 1;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.predicted_class, (counts.get(row.predicted_class) ?? 0) + 1);
  const prediction = single ? rows[0].predicted_class : [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => count + " × " + name).join(" · ");
  const confidence = (rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length).toFixed(3);
  return <><h3>Prediction and evidence</h3><dl className="result-facts">
    <Fact label={single ? "Predicted class" : "Predictions so far"} value={prediction} />
    <Fact label={single ? "Model confidence" : "Mean model confidence"} value={confidence} />
    <Fact label="Source" value="Injected test" /><Fact label="Ground truth (dataset)" value={run.trueClass} />
  </dl></>;
}
const decisionLabels: Record<string, string> = { normal: "No incident: detected as Normal.",
  below_confidence: "No incident: below the confidence guard.", pending: "No incident: not enough attack rows in the window." };
function RunProgress({ run, previous, incidents, openIncident }: {
  run?: Run; previous?: Run; incidents: Map<string, Incident>; openIncident: (id: string, opener: HTMLElement) => void;
}) {
  const ids = run?.ids;
  const n = ids?.length ?? 0;
  const scored = run?.rows.size ?? 0;
  const last = ids?.findLast(id => run?.decisions.has(id));
  const decision = last ? run?.decisions.get(last) : undefined;
  const decided = !!n && (run?.decisions.size ?? 0) >= n;
  const incident = run && ids && runIncident(run, incidents);
  const progress = incident ? reportProgress(incident) : decided ? "No incident report for this run." : "";
  const state = incident ? reportState(incident) : "wait";
  const reportStyle = { queued: "run", running: "run", ready: "done", error: "err", wait: "wait" } as const;
  const latency = n === 1 ? run?.rows.values().next().value?.latency_ms : null;
  return <section className="card panel-console" id="card-tracker">
    <header className="tracker-head"><p className="console-label">Pipeline activity</p><h2>Run progress</h2><p className="console-source" id="tr-title">{run?.label ?? "No runs yet"}</p></header>
    <ol className="tracker" id="tracker">{run ? <>
      <Step state={run.error ? "err" : ids ? "done" : "run"} title={run.error ? "Submission failed" : "Submitted"}>
        {run.error ? run.error + " Check the connection and try again." : ids ? `${n} entr${n > 1 ? "ies" : "y"} written to telemetry.raw` : "sending…"}
      </Step>
      <Step state={!ids ? "wait" : scored < n ? "run" : "done"} title="Scored">
        {!ids ? "" : !scored ? "waiting for the detector…" : n === 1 ? "1 entry scored" + (latency == null ? "" : " · " + Math.round(latency) + " ms latency") : `${scored} of ${n} entries scored`}
      </Step>
      <Step state={incident ? "done" : decided ? "no" : scored ? "run" : "wait"} title={incident || decision ? "Incident decision" : "Incident"}>
        {incident ? <><ClassLabel name={incident.attack_class} /> · {incident.status === "open" ? "open" : "closed"} · {incident.row_count} rows</>
          : decision ? decided ? <>{decisionLabels[decision.decision] ?? "No incident."}<br /><small>{decision.detail}</small></> : decision.detail
          : scored ? "waiting for the incident manager…" : ""}
      </Step>
      <Step state={reportStyle[state]} title="Report">{progress}</Step>
    </> : ["Submitted", "Scored", "Incident decision", "Report"].map((title, index) =>
      <li className="wait" key={title}><b>{title}</b><span>{index === 0 ? "Send a telemetry entry or run a simulation" : ""}</span></li>)}</ol>
    <button type="button" className="btn" id="tracker-incident" hidden={!incident}
      onClick={event => { if (incident) openIncident(incident.incident_id, event.currentTarget); }}>Open incident</button>
    <div id="run-result" className="run-result" hidden={!scored}>{run && scored > 0 && <RunSummary run={run} />}</div>
    <div id="previous-run" className="previous-run" hidden={!previous}>{previous && <details key={previous.ids?.[0]}><summary>Previous run · {previous.label}</summary><RunSummary run={previous} /></details>}</div>
    <p id="tracker-announcement" className="sr-only" role="status">{run && (run.error ? "Submission failed." : !ids ? "Sending telemetry." : progress || (incident ? "Incident available." : scored >= n ? "Telemetry scored." : "Waiting for scored telemetry."))}</p>
  </section>;
}

export function ThreatLab({ hidden, config, recent, decisions, incidents, notify, openIncident }: {
  hidden: boolean; config?: Config; recent: Row[]; decisions: Map<string, Decision>; incidents: Map<string, Incident>;
  notify: (message: string) => void; openIncident: (id: string, opener: HTMLElement) => void;
}) {
  const [editor, setEditor] = useState(false);
  const [sampleClass, setClass] = useState("Command Flooding");
  const [quality, setQuality] = useState("clean");
  const [loadStatus, setLoadStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<{ sample: Sample; cls: string; quality: string }>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<string[]>([]);
  const [burst, setBurst] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [run, setRun] = useState<Run>();
  const [previous, setPrevious] = useState<Run>();
  const sampleRequest = useRef<AbortController | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const burstInput = useRef<HTMLInputElement>(null);
  const featureEditor = useRef<HTMLDetailsElement>(null);
  const features = config?.features ?? [];
  const groups: Record<string, string[]> = {};
  for (const group of ["Message fields", "Window statistics", "Memory readings"]) {
    const fields = features.filter(feature => group === (/^Memory/.test(feature) ? "Memory readings" :
      /Window|Sliding/.test(feature) ? "Window statistics" : "Message fields"));
    if (fields.length) groups[group] = fields;
  }
  const matches = !!loaded && loaded.cls === sampleClass && loaded.quality === quality;
  const edited = loaded ? features.filter(feature => values[feature] === "" || Number(values[feature]) !== loaded.sample.features[feature]) : [];

  async function load(cls: string, quality: string) {
    sampleRequest.current?.abort();
    const controller = new AbortController();
    sampleRequest.current = controller;
    setLoading(true);
    setLoadStatus("Loading selected sample…");
    try {
      const value = await request(`/api/sample?cls=${encodeURIComponent(cls)}&quality=${encodeURIComponent(quality)}`, sample, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!features.every(feature => Number.isFinite(value.features[feature]))) throw new Error("Incomplete sample");
      setLoaded({ sample: value, cls, quality });
      setValues(Object.fromEntries(features.map(feature => [feature, String(value.features[feature])])));
      setInvalid([]);
      setLoadStatus("Sample loaded.");
    } catch {
      if (!controller.signal.aborted) setLoadStatus(current => current && (loaded
        ? "Couldn’t load the selected sample. The previously loaded values are still shown. Select Load sample to retry."
        : "Couldn’t load the sample. Select Load sample to retry."));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const ready = !!config;
  useEffect(() => {
    if (ready) void load("Command Flooding", "clean");
    return () => sampleRequest.current?.abort();
    // Hydrate the default sample once, independent of subsequent live updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function choose(cls: string, quality: string) {
    sampleRequest.current?.abort();
    setLoading(false);
    setClass(cls);
    setQuality(quality);
    setLoadStatus(loaded?.cls === cls && loaded.quality === quality ? "" : "Load the selected sample or use the previously loaded one.");
  }
  function useLoaded() {
    if (!loaded) return;
    choose(loaded.cls, loaded.quality);
    focus("t-send");
  }
  function changeFeature(feature: string, value: string) {
    setValues(current => ({ ...current, [feature]: value }));
    setInvalid(current => current.filter(name => name !== feature));
  }
  useEffect(() => {
    setRun(current => {
      if (!current?.ids) return current;
      const ids = new Set(current.ids);
      const rows = new Map(current.rows);
      const matched = new Map(current.decisions);
      for (const row of recent) if (ids.has(row.entry_id)) rows.set(row.entry_id, row);
      for (const id of ids) {
        const decision = decisions.get(id);
        if (decision) matched.set(id, decision);
      }
      if (rows.size === current.rows.size && [...matched].every(([id, decision]) => current.decisions.get(id) === decision)) return current;
      return { ...current, rows, decisions: matched };
    });
  }, [recent, decisions, run?.ids]);
  async function submit(url: string, payload: object, label: string, trueClass: string | null, prefix: string, button: string) {
    if (submitting.current) return;
    submitting.current = true;
    if (run?.ids && run.rows.size >= run.ids.length && (runIncident(run, incidents) || run.decisions.size >= run.ids.length)) setPrevious(run);
    setPending(true);
    const next: Run = { label, trueClass, rows: new Map(), decisions: new Map() };
    setRun(next);
    try {
      const response = await request(url, submission, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setRun({ ...next, ids: response.entry_ids });
    } catch (error) {
      const message = prefix + (error instanceof Error ? error.message : String(error));
      setRun({ ...next, error: message });
      notify(message);
    } finally {
      submitting.current = false;
      setPending(false);
      if (document.activeElement === document.body && !document.getElementById("lab-view")?.hidden) focus(button);
    }
  }
  function send() {
    if (!loaded || !matches || loading || pending) return;
    const bad = features.filter(feature => !values[feature]?.trim() || !Number.isFinite(Number(values[feature])));
    setInvalid(bad);
    if (bad.length) {
      if (featureEditor.current) featureEditor.current.open = true;
      focus("feature-" + bad[0]);
      notify("Every feature needs a number. Click “Load sample” to start from a real row.");
      return;
    }
    if (burst && !burstInput.current?.reportValidity()) return;
    const count = burst ? burstInput.current!.valueAsNumber : 1;
    const trueClass = edited.length ? null : loaded.sample.true_class;
    const label = (burst ? count + "× " : "") + "test entry" + (edited.length ? ` (${edited.length} field${edited.length > 1 ? "s" : ""} edited)` : "");
    void submit("/api/panel/send", { features: Object.fromEntries(features.map(feature => [feature, Number(values[feature])])),
      count, true_class: trueClass, interval_sec: 0.1 }, label, trueClass, "Send failed: ", "t-send");
  }
  function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cls = String(form.get("attack"));
    const count = Number(form.get("count"));
    const quality = String(form.get("quality"));
    dialog.current?.close();
    void submit("/api/attack", { cls, count, quality }, `${cls} attack (${count} ${quality} rows)`, cls, "Simulation failed: ", "show-simulation");
  }
  return <><section className="grid wide-workspace" id="lab-view" aria-labelledby="show-lab" hidden={hidden}>
  <section className="card lab-modes" aria-label="Threat Lab workflows">
    <div><div><p className="dashboard-label">01 · Labeled samples</p><h2>Simulate a scenario</h2><p>Send a burst of attack samples through the replay pipeline.</p></div>
      <button className="btn primary" id="show-simulation" disabled={!config || pending} onClick={() => dialog.current?.showModal()} type="button">Run simulation</button></div>
    <div><div><p className="dashboard-label">02 · Custom input</p><h2>Test a telemetry entry</h2><p>Load a dataset row, edit features if needed, then send it once or as a burst.</p></div>
      <button className="btn" type="button" id="show-entry-editor" aria-controls="card-test" aria-expanded={editor} onClick={() => { setEditor(!editor); if (!editor) focus("entry-heading"); }}>{editor ? "Hide entry editor" : "Open entry editor"}</button></div>
  </section>
  <section className="card lab-ready" id="lab-ready" hidden={editor}>
    <p className="dashboard-label">Input workspace</p>
    <h2>Prepare a telemetry test</h2>
    <p className="hint">Choose a labeled simulation or open the entry editor above. Both send test data through the same replay pipeline.</p>
    <ol className="lab-guide">
      <li><strong>Choose input</strong><span>Use labeled attack samples or start from a dataset row.</span></li>
      <li><strong>Review and send</strong><span>Edited features make dataset ground truth unavailable for that entry.</span></li>
      <li><strong>Inspect the result</strong><span>Follow scoring, the incident decision, and report availability in Run progress.</span></li>
    </ol>
  </section>
  <section className="card lab-editor" id="card-test" hidden={!editor}>
    <div className="card-head"><div><p className="dashboard-label">Input workspace</p><h2 id="entry-heading" tabIndex={-1}>Entry editor</h2></div><span className="badge">Injected test</span></div>
    <section className="editor-section" aria-labelledby="editor-source">
      <h3 id="editor-source">01 · Choose a sample</h3>
      <div className="row">
        <label>Start from
          <select id="t-class" value={sampleClass} onChange={event => choose(event.target.value, quality)}>{config?.classes.map(name => <option key={name}>{name}</option>)}{config && <option value="random">Random row</option>}</select>
        </label>
        <label>Quality
          <select id="t-quality" value={quality} onChange={event => choose(sampleClass, event.target.value)}>
            <option value="clean">Clean</option>
            <option value="noisy">Noisy</option>
          </select>
        </label>
        <button className="btn ghost" id="t-load" disabled={!config} onClick={() => void load(sampleClass, quality)}>Load sample</button>
        <button className="btn ghost" id="t-use-loaded" type="button" hidden={!loaded || matches} onClick={useLoaded}>Use loaded sample</button>
      </div>
      <div className="sample-provenance">
        <p className="hint" id="t-origin">{loaded ? `Source sample: ${loaded.sample.true_class} · ${loaded.quality}` : "No sample loaded."}</p>
        <p className="hint" id="t-ground-truth">{loaded && (edited.length ? `Submitted entry: ${edited.length} edited fields · Dataset ground truth unavailable` : "Submitted entry: dataset ground truth " + loaded.sample.true_class)}</p>
        <p className="hint" id="t-load-status" role="status">{loadStatus}</p>
      </div>
    </section>
    <section className="editor-section" aria-labelledby="editor-features">
      <h3 id="editor-features">02 · Review features</h3>
      <details id="feature-editor" ref={featureEditor}><summary>Edit feature values</summary><div id="t-features">{Object.entries(groups).map(([name, fields]) => <fieldset className="feature-group" key={name}><legend>{name}</legend><div className="features">{fields.map(feature => <FeatureInput key={feature} feature={feature} value={values[feature] ?? ""} changed={edited.includes(feature)} invalid={invalid.includes(feature)} change={changeFeature} />)}</div></fieldset>)}</div></details>
    </section>
    <section className="editor-section" aria-labelledby="editor-send">
      <h3 id="editor-send">03 · Submit test data</h3>
      <div className="row send-row">
        <label className="radio"><input type="radio" name="t-mode" value="once" checked={!burst} onChange={() => setBurst(false)} /> Send once</label>
        <label className="radio"><input type="radio" name="t-mode" value="burst" checked={burst} onChange={() => setBurst(true)} /> Burst</label>
        <label id="burst-count" hidden={!burst}>Burst row count <input id="t-burst" ref={burstInput} type="number" min="2" max="50" step="1" defaultValue="10" required disabled={!burst} aria-describedby="t-burst-range" /></label>
        <span className="hint" id="t-burst-range" hidden={!burst}>2–50 rows</span>
        <button className="btn primary" id="t-send" disabled={!matches || loading || pending} onClick={send}>Send entry</button>
      </div>
      <p className="hint">A single entry is classified instantly, but an incident needs <b className="g-rows">{config?.guards.min_rows ?? 5}</b> attack rows within the last <b className="g-win">{config?.guards.window_rows ?? 20}</b>, so a single entry alone cannot open an incident.</p>
    </section>
  </section>

  <RunProgress run={run} previous={previous} incidents={incidents} openIncident={openIncident} />
</section>
<dialog id="simulation" ref={dialog} aria-labelledby="simulation-title">
  <form id="simulation-form" onSubmit={simulate}>
    <div className="card-head"><h2 id="simulation-title">Run simulation</h2>
      <button className="close" id="simulation-close" onClick={() => dialog.current?.close()} type="button" aria-label="Close simulation">&times;</button>
    </div>
    <p className="hint">Send labeled sample attack rows into the simulated telemetry stream.</p>
    <label>Attack class <select id="atk-class" name="attack" required>{config?.classes.filter(name => name !== "Normal").map(name => <option key={name}>{name}</option>)}</select></label>
    <div className="row">
      <label>Telemetry quality
        <select id="atk-quality" name="quality"><option value="clean">Clean</option><option value="noisy">Noisy</option></select>
      </label>
      <label>Rows <input id="atk-count" name="count" type="number" min="5" max="100" defaultValue="15" required /></label>
    </div>
    <div className="dialog-actions"><button className="btn primary" id="atk-submit" type="submit">Run simulation</button></div>
  </form>
</dialog></>;
}
