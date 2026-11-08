import { memo, useRef, useState } from "react";
import { examples, request, type Example, type Stats } from "./protocol";
import { Fact, OutputDetails, confidenceNote, datasetName, focus } from "./presentation";

const scenarios: Record<string, string> = {
  Normal: "Explore a window with no attack class predicted.",
  "Storage Exhaustion": "Review patterns of excessive resource use.",
  "Command Flooding": "Inspect an unusual volume of commands.",
  "Data Injection": "Review patterns that resemble altered telemetry.",
  "Defence Impairment": "Explore possible interference with protective mechanisms.",
};
function Walkthrough({ name, example }: { name: string; example: Example }) {
  const classification = example.classification;
  const review = example.status === "FLAGGED_FOR_REVIEW" ? "Awaiting review" : example.status === "ERROR" ?
    "Analysis failed" : example.status === "AUTONOMOUS" ? "Policy result available for review" : "Unavailable";
  return <>
    <div className="sample-result-heading"><p className="dashboard-label">Prediction record</p>
      <div className="card-head"><h3>{name} walkthrough</h3><span className="badge">Cached example</span></div>
    </div>
    <div className="result-sections">
      <section><h4>Prediction and review</h4><dl className="result-facts">
        <Fact label="Predicted class" value={classification?.predicted_class} />
        <Fact label="Model confidence" value={classification?.confidence} /><Fact label="Review signal" value={review} />
      </dl><p className="hint">{confidenceNote}</p>
      {classification?.predicted_class === "Normal" && <p className="hint">No attack class was predicted. This is not a guarantee of safety.</p>}</section>
      <section><h4>Evidence</h4><dl className="result-facts"><Fact label="Ground truth (dataset)" value={name} /></dl>
        <p className="hint">Raw telemetry and the Monitor decision are unavailable for this cached example.</p></section>
      <section><h4>Policy outcome</h4><p className="hint">Structured policy details are unavailable. The cached explanation describes simulated actions.</p>
        <OutputDetails label="Policy explanation · AI-generated" content={example.mitigation} /></section>
      <section><h4>AI narrative</h4><OutputDetails label="SPARTA context · AI-generated" content={example.sparta_context} />
        <OutputDetails label="Incident narrative" content={example.report} />
        {!example.sparta_context && !example.report && <p className="hint">Narrative unavailable.</p>}</section>
    </div>
  </>;
}
export function Overview({ hidden, stats, stale, error, openTelemetry }: {
  hidden: boolean; stats?: Stats; stale: boolean; error: boolean; openTelemetry: () => void;
}) {
  const [selected, setSelected] = useState("Data Injection");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ name: string; example: Example }>();
  const cache = useRef<Promise<Record<string, Example>> | undefined>(undefined);
  const generation = useRef(0);
  function choose(name: string) {
    generation.current++;
    setSelected(name);
    setStatus("");
  }
  async function explore(event: React.MouseEvent<HTMLButtonElement>) {
    const trigger = event.currentTarget;
    const id = ++generation.current;
    setStatus("Loading cached scenario…");
    try {
      cache.current ??= request("/api/demo-scenarios", examples).catch(error => {
        cache.current = undefined;
        throw error;
      });
      const example = (await cache.current)[selected];
      if (generation.current !== id) return;
      if (!example) throw new Error("Scenario unavailable");
      setResult({ name: selected, example });
      setStatus("");
      if (document.activeElement === trigger) focus("scenario-result");
    } catch {
      if (generation.current === id) setStatus("This cached scenario couldn’t load. Try again or open Manual analysis.");
    }
  }
  return (<section className="grid wide-workspace" id="overview-view" aria-labelledby="show-overview" hidden={hidden}>
  <section className="card telemetry-status" aria-label="Replay session">
    <div className="replay-metric"><span>Replay session</span><strong id="overview-session" role="status">{error ? "Replay status unavailable" : stale ? "Reconnecting · showing last received values" : stats ? stats.kafka_ok ? "Replay connected" : "Replay disconnected" : "Waiting for replay status"}</strong></div>
    <div className="replay-metric"><span>Dataset</span><strong id="overview-dataset">{stats ? datasetName(stats.replay_dataset) : "–"}</strong></div>
    <div className="replay-metric"><span>Rows scored this session</span><strong id="overview-total">{stats?.rows_total.toLocaleString() ?? "–"}</strong></div>
    <div className="replay-metric"><span>Throughput</span><strong id="overview-rate">{stats ? stats.rows_per_sec + " rows/s" : "–"}</strong></div>
  </section>
  <section className="card scenario-library" aria-labelledby="scenarios-heading">
    <div className="card-head"><div><p className="dashboard-label">Scenario library</p><h2 id="scenarios-heading">Choose a sample</h2></div><span className="badge">5 classes</span></div>
    <fieldset className="scenario-picker"><legend className="sr-only">Sample class</legend><div id="scenario-cards" className="scenario-cards">{Object.keys(scenarios).map(name => <label className="scenario-option" key={name}><input type="radio" name="scenario" value={name} checked={selected === name} onChange={() => choose(name)} /><span>{name}</span></label>)}</div></fieldset>
  </section>
  <div className="scenario-workspace">
    <section className="card panel-console scenario-console" aria-labelledby="scenario-name">
      <div className="console-heading"><p className="console-label">Selected scenario</p><span className="console-tag">Cached · No key needed</span></div>
      <h2 id="scenario-name">{selected}</h2>
      <p id="scenario-description" className="console-source">{scenarios[selected]}</p>
      <div className="scenario-actions">
        <button className="btn primary" type="button" id="try-sample" onClick={explore}>Explore sample</button>
        <button className="btn console-secondary" type="button" onClick={openTelemetry}>Open Telemetry</button>
      </div>
      <ol className="scenario-route" aria-label="Walkthrough sections">
        <li><span>01</span> Prediction</li><li><span>02</span> Evidence</li><li><span>03</span> Policy</li><li><span>04</span> Narrative</li>
      </ol>
      <p id="scenario-status" role="status" className="console-source">{status}</p>
    </section>
  </div>
  <div className="card" id="scenario-result" tabIndex={-1} hidden={!result}>{result && <Walkthrough key={result.name} {...result} />}</div>
</section>);
}
export const Method = memo(function Method({ hidden }: { hidden: boolean }) {
  return (<section className="grid intro-view" id="method-view" aria-labelledby="show-method" hidden={hidden}>
  <section className="card methodology workflow-overview">
    <p className="dashboard-label">Field guide</p>
    <h2>From telemetry to review</h2>
    <p>Both workflows use simulated CubeSat telemetry. They differ in when analysis starts and what evidence they return.</p>
    <table className="research-table">
      <caption className="sr-only">Comparison of SentinelSat workflows</caption>
      <thead><tr><th scope="col">Stage</th><th scope="col">Kafka telemetry</th><th scope="col">Manual analysis</th></tr></thead>
      <tbody>
        <tr><th scope="row">Input</th><td>Replay or injected test rows</td><td>Latest replay window at submission</td></tr>
        <tr><th scope="row">Trigger</th><td>Incident guards for confidence and row count</td><td>Statistical screening, then full analysis on request</td></tr>
        <tr><th scope="row">Output</th><td>Scored rows, incident evidence, and report when available</td><td>Prediction, SPARTA context, policy outcome, and narrative when returned</td></tr>
      </tbody>
    </table>
  </section>
  <section className="card methodology">
    <p className="dashboard-label">Agent pipeline</p>
    <h2>Manual analysis · Five-stage workflow</h2>
    <ol className="agent-trace">
      <li><strong>Monitor</strong><span>Statistical screening against the nominal baseline.</span></li>
      <li><strong>Classifier</strong><span>XGBoost predicts a class. The agent presents the model output.</span></li>
      <li><strong>SPARTA Analyst</strong><span>Maps the predicted class to threat context. The mapping does not establish attribution.</span></li>
      <li><strong>Mitigation</strong><span>A deterministic policy selects an action from the class and score.</span></li>
      <li><strong>Incident Reporter</strong><span>Summarizes the evidence and review context.</span></li>
    </ol>
    <p>The statistical Monitor checks the replayed window. A manual analysis can proceed after a Monitor decline.</p>
  </section>
  <section className="card methodology">
    <p className="dashboard-label">Live detection</p>
    <h2>Web workspace · Kafka telemetry replay</h2>
    <p>The detector scores replay and test rows. The incident manager groups qualifying rows using the configured confidence and row-count guards. Reports may be generated for the incident sample or drawn from a cached example.</p>
  </section>
  <section className="card methodology">
    <p className="dashboard-label">Evaluation and limitations</p>
    <h2>Reported model evaluation</h2>
    <div className="evaluation"><p><strong>68.9%</strong> Domain-shift accuracy</p><p><strong>0.697</strong> Macro F1</p></div>
    <p>Project report figures for training on clean simulated telemetry and evaluating on noised telemetry. The near-perfect clean in-domain result is a simulator ceiling and an unsuitable estimate of generalization. Replay session accuracy uses a different denominator.</p>
    <h3>Why review matters</h3>
    <p>The reported experiment counted 1,786 Normal windows predicted as Data Injection. A blended Command Flooding and Data Injection case produced a 0.999 confidence score for Data Injection despite ambiguous evidence.</p>
    <p>Per-window feature attribution is unavailable in this build. The demo uses simulated telemetry and reports policy outputs for review.</p>
  </section>
</section>);
});
