import { useEffect, useState, type FormEvent } from "react";
import { Fact, OutputDetails, confidenceNote, pct } from "./presentation";

type Row = Record<string, number | null>;
type Replay = {
  dataset: "noised" | "raw"; state: "stopped" | "running" | "paused" | "finished";
  total_rows: number; rows_emitted: number; elapsed: number; speed: number; order: string;
  loop: boolean; rows: Row[]; monitor: boolean | null; live_available: boolean;
};
type Result = {
  dataset: string; row: number; message_id: number; monitor: boolean; label: string | null;
  prediction: string; confidence: number; status: string; action?: string; guardrail?: string;
  report?: string; sparta?: string; mitigation?: string;
};
type Prediction = { prediction_class: number; is_anomaly: boolean; confidence_score: number; status: string };

const metrics = ["MessageRateInWindow", "MemoryAnonMB", "MsgLength", "SlidingWindowMeanIntervalSec",
  "MemoryPageTableMB", "UniqueMessageIDsInWindow"];
const fields = { MsgLength: 128, CmdCode: 4, TimeRadians: 1.57, ApId: 102, MsgId: 50 };

async function api<T>(path: string, payload?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/analysis/" + path, {
    signal,
    ...(payload && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : "The request could not be completed.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

function MetricChart({ rows, metric, select, label }: {
  rows: Row[]; metric: string; select: (value: string) => void; label: string;
}) {
  const values = rows.map(row => row[metric]).filter((value): value is number => typeof value === "number");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) =>
    [8 + index * 384 / Math.max(1, values.length - 1), 112 - (value - min) * 104 / (max - min || 1)].join(",")).join(" ");
  return <section className="card">
    <label>{label} <select value={metric} onChange={event => select(event.target.value)}>
      {metrics.map(name => <option key={name}>{name}</option>)}
    </select></label>
    {values.length ? <>
      <svg viewBox="0 0 400 120" className="analysis-chart" role="img" aria-label={metric + " over the replay buffer"}>
        {values.length === 1 ? <circle cx="8" cy="112" r="3" fill="currentColor" /> :
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="hint">Min {min.toPrecision(4)} · Max {max.toPrecision(4)} · Latest {values.at(-1)?.toPrecision(4)}</p>
    </> : <p className="hint">Waiting for replay rows.</p>}
  </section>;
}

function PacketTest() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Prediction>();
  const [error, setError] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const payload = Object.fromEntries([...new FormData(event.currentTarget)].map(([name, value]) => [name, Number(value)]));
    setPending(true);
    setError("");
    try { setResult(await api<Prediction>("predict", payload)); }
    catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <section className="card">
    <h2>Five-feature packet test</h2>
    <p className="hint">Scores an individual packet with the Phase 4 model. Requires the Phase 4 scaler and model files.</p>
    <form onSubmit={send} className="analysis-controls">
      {Object.entries(fields).map(([name, value]) => <label key={name}>{name}
        <input name={name} type="number" step="any" required defaultValue={value} />
      </label>)}
      <button className="btn primary" disabled={pending}>{pending ? "Scoring…" : "Score packet"}</button>
    </form>
    <div role="status">{result && <p>{result.status} · Class {result.prediction_class} · Confidence {pct(result.confidence_score)}</p>}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ManualAnalysis({ hidden }: { hidden: boolean }) {
  const [replay, setReplay] = useState<Replay>();
  const [dataset, setDataset] = useState<Replay["dataset"]>("noised");
  const [speed, setSpeed] = useState(10);
  const [order, setOrder] = useState("sequential");
  const [loop, setLoop] = useState(true);
  const [buffer, setBuffer] = useState(100);
  const [interval, setIntervalMs] = useState(500);
  const [metricA, setMetricA] = useState(metrics[0]);
  const [metricB, setMetricB] = useState(metrics[1]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result>();
  const [replayError, setReplayError] = useState("");
  const [actionError, setActionError] = useState("");
  const [analysisError, setAnalysisError] = useState("");

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const state = await api<Replay>("replay", undefined, controller.signal);
        if (!controller.signal.aborted) { setReplay(state); setReplayError(""); }
      } catch (error) {
        if (!controller.signal.aborted) setReplayError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, interval);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [hidden, interval]);

  async function control(action: string) {
    setBusy(true);
    setActionError("");
    try {
      const settings = action === "load" || action === "start" || action === "configure"
        ? { dataset, speed, order, loop, buffer_size: buffer } : {};
      await api("replay/" + action, settings);
    } catch (error) { setActionError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function analyze() {
    setRunning(true);
    setAnalysisError("");
    try { setResult(await api<Result>("run", {})); }
    catch (error) { setAnalysisError((error as Error).message); }
    finally { setRunning(false); }
  }

  const rows = replay?.rows ?? [];
  const columns = Object.keys(rows.at(-1) ?? {});
  const labels = new Map<number, number>();
  for (const row of rows) if (row.Label != null) labels.set(row.Label, (labels.get(row.Label) ?? 0) + 1);
  const monitor = replay?.monitor == null ? "Waiting for replay rows." :
    replay.monitor ? "Escalation criteria met." : "Escalation criteria not met.";
  const validSettings = Number.isInteger(speed) && speed >= 1 && speed <= 200 &&
    Number.isInteger(buffer) && buffer >= 20 && buffer <= 500;
  return <section className="grid" id="analysis-view" aria-labelledby="show-analysis" hidden={hidden}>
    <section className="card">
      <h2>Manual telemetry replay</h2>
      <p className="hint">Controls operate on a shared CSV replay for manual analysis. The live Kafka stream has its own controls.</p>
      <div className="analysis-controls">
        <label>Dataset <select value={dataset} onChange={event => setDataset(event.target.value === "raw" ? "raw" : "noised")}>
          <option value="noised">Noised telemetry</option><option value="raw">Raw simulated telemetry</option>
        </select></label>
        <button className="btn" disabled={busy || !validSettings} onClick={() => void control("load")}>Load dataset</button>
        <label>Rows per second <input type="number" min="1" max="200" value={speed} onChange={event => setSpeed(Number(event.target.value))} /></label>
        <label>Order <select value={order} onChange={event => setOrder(event.target.value)}>
          <option value="sequential">Sequential</option><option value="shuffled">Shuffled</option>
        </select></label>
        <label>Buffer rows <input type="number" min="20" max="500" step="10" value={buffer} onChange={event => setBuffer(Number(event.target.value))} /></label>
        <label>Refresh interval <select value={interval} onChange={event => setIntervalMs(Number(event.target.value))}>
          <option value="500">0.5 seconds</option><option value="1000">1 second</option><option value="2000">2 seconds</option><option value="3000">3 seconds</option>
        </select></label>
        <label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop playback</label>
      </div>
      <div className="analysis-controls">
        <button className="btn primary" disabled={busy || !validSettings || !replay || replay.state === "running" || replay.state === "paused"} onClick={() => void control("start")}>Start replay</button>
        <button className="btn" disabled={busy || replay?.state !== "running"} onClick={() => void control("pause")}>Pause</button>
        <button className="btn" disabled={busy || replay?.state !== "paused"} onClick={() => void control("resume")}>Resume</button>
        <button className="btn" disabled={busy || !replay || replay.state === "stopped"} onClick={() => void control("stop")}>Stop / reset</button>
        <button className="btn" disabled={busy || !validSettings} onClick={() => void control("configure")}>Apply settings</button>
      </div>
      {!validSettings && <p className="hint">Enter 1–200 rows per second and a buffer of 20–500 rows.</p>}
      <p role="status">{replay ? `${replay.dataset} · ${replay.state} · ${replay.rows_emitted.toLocaleString()} rows emitted · ${replay.speed} rows/s · ${replay.order}` : "Loading replay…"}</p>
      {(replayError || actionError) && <p role="alert">{actionError || replayError}</p>}
    </section>
    <div className="analysis-metrics">
      <MetricChart rows={rows} metric={metricA} select={setMetricA} label="Chart 1 metric" />
      <MetricChart rows={rows} metric={metricB} select={setMetricB} label="Chart 2 metric" />
    </div>
    <section className="card">
      <details><summary>Recent replayed telemetry rows</summary>
        {rows.length ? <div className="report-table" role="region" aria-label="Recent replay rows" tabIndex={0}>
          <table className="analysis-table"><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{rows.slice(-20).reverse().map((row, index) => <tr key={index}>
            {columns.map(column => <td key={column}>{row[column] ?? "—"}</td>)}
          </tr>)}</tbody></table>
        </div> : <p className="hint">No rows in the replay buffer.</p>}
      </details>
      <p>Dataset label mix <span className="hint">· Descriptive ground truth</span></p>
      {labels.size ? <ul>{[...labels].sort(([a], [b]) => a - b).map(([label, count]) =>
        <li key={label}>Label {label} · {count} rows</li>)}</ul> : <p className="hint">No dataset labels yet.</p>}
    </section>
    <section className="card">
      <h2>Analyze the latest replay window</h2>
      <p>Monitor: {monitor}</p>
      <button className="btn primary" disabled={running || !rows.length || !replay?.live_available} onClick={() => void analyze()}>Run full agent analysis</button>
      {replay && !replay.live_available && <p className="hint">Live analysis requires live agent mode and a Groq key. Cached scenarios are available in Overview.</p>}
      <p role="status">{running ? "Analysis running. Any result below is from the previous run." : analysisError || (result ? "Analysis complete." : "")}</p>
      {result && <>
        <h3>Live analysis · {result.dataset} replay row {result.row}</h3>
        <dl className="result-facts">
          <Fact label="Message ID" value={result.message_id} /><Fact label="Ground truth" value={result.label} />
          <Fact label="Prediction" value={result.prediction} /><Fact label="Confidence" value={pct(result.confidence)} />
          <Fact label="Review status" value={result.status === "FLAGGED_FOR_REVIEW" ? "Awaiting review" : "Policy result available for review"} />
        </dl>
        <p className="hint">{confidenceNote}</p>
        <ol className="agent-trace">
          <li><strong>Monitor</strong><span>{result.monitor ? "Escalation criteria met." : "Manual override of a Monitor decline."}</span></li>
          <li><strong>Classifier</strong><span>{result.prediction}</span></li>
          <li><strong>SPARTA Analyst</strong><span>{result.sparta ? "Context returned" : "Unavailable"}</span></li>
          <li><strong>Mitigation</strong><span>{result.action ?? "Unavailable"} {result.guardrail}</span></li>
          <li><strong>Incident Reporter</strong><span>{result.report ? "Narrative returned" : "Unavailable"}</span></li>
        </ol>
        <OutputDetails label="SPARTA context" content={result.sparta} />
        <OutputDetails label="Policy explanation" content={result.mitigation} />
        <OutputDetails label="Incident narrative" content={result.report} />
      </>}
    </section>
    <PacketTest />
  </section>;
}
