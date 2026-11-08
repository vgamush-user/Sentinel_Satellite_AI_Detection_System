"use strict";
// Sentinel live monitor client: initial state from /api/state, then live
// batches over the /ws WebSocket (telemetry rows, incident and report events).

const CLASS_COLOR_TOKENS = new Map([
  ["Normal", "--c-normal"],
  ["Storage Exhaustion", "--c-se"],
  ["Command Flooding", "--c-cf"],
  ["Data Injection", "--c-di"],
  ["Defence Impairment", "--c-dim"],
]);
const classColorToken = (name) => CLASS_COLOR_TOKENS.get(name) || "--muted";
const chartPad = { l: 34, r: 10, t: 10, b: 20 };
const liveRowLimit = 300;
const S = {
  config: null,
  recent: [],              // last 300 slim telemetry rows
  incidents: new Map(),    // incident_id -> merged incident + report fields
  tracker: null,           // the latest thing sent from this page
  decisions: new Map(),    // entry_id -> latest entry_decision (recent injected entries)
  evidence: null,          // the snapshot currently displayed on the chart
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtTime(ts, includeDate = false) {
  if (!Number.isFinite(ts)) return "–";
  const date = new Date(ts * 1000);
  if (!Number.isFinite(date.getTime())) return "–";
  const iso = date.toISOString();
  const time = iso.slice(11, 19) + " UTC";
  return includeDate ? iso.slice(0, 10) + " " + time : time;
}
const pct = (v) => v == null ? "–" : (v * 100).toFixed(1) + "%";
const cls = (name) => `<span class="cls"><i style="background:var(${classColorToken(name)})"></i>${esc(name || "–")}</span>`;

let drawerSelection = null;
const workspaces = { overview: "Overview", live: "Telemetry", incidents: "Incidents", lab: "Threat Lab", method: "How it works" };
const workspaceRoutes = { overview: "overview", live: "telemetry", incidents: "incidents", lab: "threat-lab", method: "how-it-works" };
let currentWorkspace;
const workspaceScroll = new Map();
let feedSnapshot = [];
let predictionMixKey;
let loadedSample;
let sampleRequest = 0;
let sampleLoading = false;
let runPending = false;
const incidentFilters = ["incident-search", "incident-class", "incident-state", "incident-report"];

// ------------------------------------------------------------------------- //
// Non-blocking toast notifications (replaces blocking alert)
// ------------------------------------------------------------------------- //
function toast(message, type = "info") {
  const root = $("toast-root") || document.body;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icon = type === "error" ? "⚠" : type === "success" ? "✓" : "ℹ";
  t.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${esc(message)}</span>
    <button class="toast-close" aria-label="Dismiss">&times;</button>
  `;
  const close = () => {
    t.classList.remove("show");
    t.classList.add("leaving");
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 180);
  };
  t.querySelector(".toast-close").addEventListener("click", close);
  root.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("show")));
  setTimeout(close, 4000);
}

// ------------------------------------------------------------------------- //
// Boot
// ------------------------------------------------------------------------- //
async function boot() {
  const retry = $("retry-replay");
  retry.disabled = true;
  let st;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Replay unavailable");
    st = await response.json();
    if (!st.config || !Array.isArray(st.recent) || !Array.isArray(st.incidents) || !st.stats) throw new Error("Replay state unavailable");
  } catch (_) {
    $("overview-session").textContent = "Replay status unavailable";
    $("incidents").textContent = "Incidents could not be loaded.";
    $("replay-notice-text").textContent = "Replay is unavailable. Cached samples can still be explored.";
    $("replay-notice").hidden = false;
    retry.disabled = false;
    return;
  }
  $("replay-notice").hidden = true;
  $("show-simulation").disabled = false;
  $("t-load").disabled = false;
  S.config = st.config;
  S.recent = st.recent;
  st.incidents.reverse().forEach((i) => S.incidents.set(i.incident_id, i));
  setupStatic();
  renderStats(st.stats);
  renderIncidents();
  renderFeed();
  drawChart();
  connect();
  loadSample();
}

const scenarios = {
  Normal: "Explore a window with no attack class predicted.",
  "Storage Exhaustion": "Review patterns of excessive resource use.",
  "Command Flooding": "Inspect an unusual volume of commands.",
  "Data Injection": "Review patterns that resemble altered telemetry.",
  "Defence Impairment": "Explore possible interference with protective mechanisms.",
};

const confidenceNote = "Model confidence is a score, not the probability that an event is malicious. A high score can still be wrong.";

function setupOverview() {
  const root = document.documentElement;
  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    $("theme-toggle").setAttribute("aria-pressed", String(theme === "dark"));
  };
  try { applyTheme(localStorage.getItem("sentinelsat-theme") === "dark" ? "dark" : "light"); } catch (_) { applyTheme("light"); }
  $("theme-toggle").addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem("sentinelsat-theme", theme); } catch (_) { /* Theme still applies to this page. */ }
    drawChart();
  });
  Object.keys(workspaces).forEach((view) => {
    $("show-" + view).addEventListener("click", () => {
      showWorkspace(view);
      $("workspace-title").focus({ preventScroll: true });
    });
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showWorkspace(button.dataset.view);
      $("workspace-title").focus();
    });
  });
  const routeView = () => Object.keys(workspaceRoutes).find((view) => "#" + workspaceRoutes[view] === location.hash) || "overview";
  history.scrollRestoration = "manual";
  showWorkspace(routeView(), { fromHistory: true });
  window.addEventListener("popstate", () => {
    showWorkspace(routeView(), { fromHistory: true });
    $("workspace-title").focus({ preventScroll: true });
  });
  const cards = $("scenario-cards");
  cards.innerHTML = Object.keys(scenarios).map((name) => `
    <label class="scenario-option"><input type="radio" name="scenario" value="${name}" ${name === "Data Injection" ? "checked" : ""}><span>${name}</span></label>`).join("");
  const selectedSample = () => cards.querySelector(":checked").value;
  const describeSample = () => {
    const name = selectedSample();
    $("scenario-name").textContent = name;
    $("scenario-description").textContent = scenarios[name];
  };
  cards.addEventListener("change", describeSample);
  describeSample();
  let cache;
  let selection = 0;
  cards.addEventListener("change", () => {
    selection++;
    $("scenario-status").textContent = "";
  });
  async function openSample(name, trigger) {
    const request = ++selection;
    $("scenario-status").textContent = "Loading cached scenario…";
    try {
      cache ??= fetch("/api/demo-scenarios").then((response) => {
        if (!response.ok) throw new Error("Cache unavailable");
        return response.json();
      }).catch((error) => { cache = null; throw error; });
      const example = (await cache)[name];
      if (!example) throw new Error("Scenario unavailable");
      if (request !== selection) return;
      renderScenario(name, example);
      if (currentWorkspace === "overview" && document.activeElement === trigger) $("scenario-result").focus();
      $("scenario-status").textContent = "";
    } catch (_) {
      if (request !== selection) return;
      $("scenario-status").textContent = "This cached scenario couldn’t load. Try again or open the hosted demo.";
    }
  }
  $("try-sample").addEventListener("click", (event) => openSample(selectedSample(), event.currentTarget));
}

function fact(label, value) {
  return `<div><dt>${label}</dt><dd>${esc(value ?? "Unavailable")}</dd></div>`;
}

function resultSections({ prediction, evidence, policy, narrative }) {
  return `<div class="result-sections">
    <section><h4>Prediction and review</h4>${prediction}</section>
    <section><h4>Evidence</h4>${evidence}</section>
    <section><h4>Policy outcome</h4>${policy}</section>
    <section><h4>AI narrative</h4>${narrative}</section>
  </div>`;
}

function outputDetails(label, content) {
  if (!content) return "";
  return `<details><summary>${label}</summary><div class="md">${md(content)}</div></details>`;
}

function renderScenario(name, example) {
  const classification = example.classification;
  const result = $("scenario-result");
  result.innerHTML = `
    <div class="sample-result-heading"><p class="dashboard-label">Prediction record</p>
      <div class="card-head"><h3>${esc(name)} walkthrough</h3><span class="badge">Cached example</span></div>
    </div>
    ${resultSections({
      prediction: `<dl class="result-facts">
        ${fact("Predicted class", classification?.predicted_class)}
        ${fact("Model confidence", classification?.confidence)}
        ${fact("Review signal", reviewSignal(example.status))}
      </dl><p class="hint">${confidenceNote}</p>
      ${classification?.predicted_class === "Normal" ? '<p class="hint">No attack class was predicted. This is not a guarantee of safety.</p>' : ""}`,
      evidence: `<dl class="result-facts">${fact("Ground truth (dataset)", name)}</dl>
        <p class="hint">Raw telemetry and the Monitor decision are unavailable for this cached example.</p>`,
      policy: `<p class="hint">Structured policy details are unavailable. The cached explanation describes simulated actions.</p>
        ${outputDetails("Policy explanation · AI-generated", example.mitigation)}`,
      narrative: outputDetails("SPARTA context · AI-generated", example.sparta_context) + outputDetails("Incident narrative", example.report)
        || '<p class="hint">Narrative unavailable.</p>',
    })}`;
  result.hidden = false;
}

function reviewSignal(status) {
  if (status === "FLAGGED_FOR_REVIEW") return "Awaiting review";
  if (status === "ERROR") return "Analysis failed";
  if (status === "AUTONOMOUS") return "Policy result available for review";
  return "Unavailable";
}

function setupStatic() {
  document.querySelectorAll(".pipeline button[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      showWorkspace(button.dataset.target === "incidents-heading" ? "incidents" : "live");
      $(button.dataset.target).focus();
    });
  });
  const g = S.config.guards;
  document.querySelectorAll(".g-conf").forEach((e) => (e.textContent = g.min_confidence));
  document.querySelectorAll(".g-rows").forEach((e) => (e.textContent = g.min_rows));
  document.querySelectorAll(".g-win").forEach((e) => (e.textContent = g.window_rows));
  $("pc-guard").textContent = `${g.min_rows} of ${g.window_rows} rows ≥ ${g.min_confidence}`;
  $("st-mode").textContent = S.config.agent_mode;

  const shortClass = { "Storage Exhaustion": "Storage", "Command Flooding": "Flooding", "Data Injection": "Injection", "Defence Impairment": "Defence" };
  $("legend").innerHTML = S.config.classes.map((c) => `<span title="${esc(c)}"><i style="background:var(${classColorToken(c)})"></i><span aria-hidden="true">${esc(shortClass[c] || c)}</span><span class="sr-only">${esc(c)}</span></span>`).join("");

  const attackOptions = S.config.classes.filter((c) => c !== "Normal")
    .map((c) => `<option>${esc(c)}</option>`).join("");
  $("atk-class").innerHTML = attackOptions;
  $("incident-class").insertAdjacentHTML("beforeend", attackOptions);
  incidentFilters.forEach((id) => $(id).addEventListener("input", renderIncidents));
  $("clear-filters").addEventListener("click", () => {
    incidentFilters.forEach((id) => { $(id).value = ""; });
    renderIncidents();
    $("incident-search").focus();
  });
  $("incidents").addEventListener("click", (e) => {
    const row = e.target.closest(".inc");
    if (row) openDrawer(row.dataset.id);
  });

  const simulation = $("simulation");
  $("show-simulation").addEventListener("click", () => simulation.showModal());
  $("simulation-close").addEventListener("click", () => simulation.close());
  $("simulation-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    simulation.close();
    await launchAttack($("atk-class").value, $("show-simulation"));
  });

  const sel = $("t-class");
  sel.innerHTML = S.config.classes.map((c) => `<option>${esc(c)}</option>`).join("") + `<option value="random">Random row</option>`;
  sel.value = "Command Flooding";

  const featureGroups = { "Message fields": [], "Window statistics": [], "Memory readings": [] };
  for (const feature of S.config.features) {
    const group = /^Memory/.test(feature) ? "Memory readings" :
      /Window|Sliding/.test(feature) ? "Window statistics" : "Message fields";
    featureGroups[group].push(feature);
  }
  $("t-features").innerHTML = Object.entries(featureGroups).filter(([, fields]) => fields.length)
    .map(([name, fields]) => `<fieldset class="feature-group"><legend>${name}</legend><div class="features">${fields.map((f) =>
      `<label title="${esc(f)}">${esc(f)}<input type="number" step="any" id="feature-${esc(f)}" data-f="${esc(f)}"></label>`).join("")}</div></fieldset>`).join("");
  $("t-features").addEventListener("input", (e) => {
    if (e.target.dataset.f) {
      e.target.classList.toggle("changed", e.target.value === "" || Number(e.target.value) !== Number(e.target.dataset.orig));
      e.target.classList.remove("invalid");
      e.target.removeAttribute("aria-invalid");
      e.target.removeAttribute("aria-describedby");
      e.target.parentElement.querySelector(".feature-error")?.remove();
      renderSampleState();
    }
  });
  $("show-entry-editor").addEventListener("click", () => {
    const editor = $("card-test");
    editor.hidden = !editor.hidden;
    $("lab-ready").hidden = !editor.hidden;
    $("show-entry-editor").setAttribute("aria-expanded", String(!editor.hidden));
    $("show-entry-editor").textContent = editor.hidden ? "Open entry editor" : "Hide entry editor";
    if (!editor.hidden) $("entry-heading").focus();
  });
  $("tracker-incident").addEventListener("click", () => openDrawer($("tracker-incident").dataset.open));
  $("feed").addEventListener("click", (event) => {
    const button = event.target.closest("[data-row]");
    if (button) {
      const selected = feedSnapshot.findIndex((row) => String(row.entry_id) === button.dataset.row);
      if (selected < 0) return;
      if (S.evidence) {
        const range = $("evidence-row");
        range.value = selected + 1;
        selectEvidenceRow();
        range.focus();
      } else {
        showSnapshot({ rows: feedSnapshot, selected, triggerIds: new Set(), openerId: button.dataset.row });
      }
    }
  });
  $("feed").addEventListener("focusout", (event) => {
    if (!$("feed").contains(event.relatedTarget)) queueMicrotask(renderFeed);
  });
  $("feed").addEventListener("focusin", renderFeed);
  $("t-load").addEventListener("click", loadSample);
  for (const id of ["t-class", "t-quality"]) {
    $(id).addEventListener("change", () => {
      sampleRequest++;
      sampleLoading = false;
      $("t-load-status").textContent = sampleMatchesSelection() ? "" : "Load the selected sample or use the previously loaded one.";
      renderSampleState();
    });
  }
  $("t-use-loaded").addEventListener("click", () => {
    $("t-class").value = loadedSample.requestedClass;
    $("t-quality").value = loadedSample.quality;
    $("t-class").dispatchEvent(new Event("change"));
    $("t-send").focus();
  });
  document.querySelectorAll("[name=t-mode]").forEach((radio) => {
    radio.addEventListener("change", () => {
      const burst = radio.value === "burst";
      $("t-burst").disabled = !burst;
      $("burst-count").hidden = !burst;
      $("t-burst-range").hidden = !burst;
    });
  });
  $("t-send").addEventListener("click", sendEntry);
  $("dr-close").addEventListener("click", () => closeDrawer());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("incidents-view").hidden) closeDrawer();
  });
  $("evidence-row").addEventListener("input", selectEvidenceRow);
  $("back-live").addEventListener("click", returnToLive);
  for (const [id, direction] of [["previous-trigger", -1], ["next-trigger", 1]]) {
    $(id).addEventListener("click", () => {
      const evidence = S.evidence;
      const index = evidence?.triggerIndices.filter((i) => direction * (i - evidence.selected) > 0);
      const target = direction < 0 ? index?.at(-1) : index?.[0];
      if (target == null) return;
      $("evidence-row").value = target + 1;
      selectEvidenceRow();
      if ($(id).disabled) $("evidence-row").focus();
    });
  }
  $("back-incident").addEventListener("click", () => {
    const { id, rows, incidentOpener, disclosures, returnRow } = S.evidence;
    openDrawer(id, rows, incidentOpener, { disclosures, returnRow });
  });

  window.addEventListener("resize", drawChart);
}

function showWorkspace(view, { fromHistory = false } = {}) {
  const changed = view !== currentWorkspace;
  if (changed && currentWorkspace) workspaceScroll.set(currentWorkspace, window.scrollY);
  currentWorkspace = view;
  const hash = "#" + workspaceRoutes[view];
  if (!fromHistory && location.hash !== hash) history.pushState(null, "", hash);

  Object.keys(workspaces).forEach((name) => {
    $(name + "-view").hidden = name !== view;
    $("show-" + name).setAttribute("aria-pressed", String(name === view));
  });
  $("workspace-title").textContent = workspaces[view];
  if (changed) window.scrollTo(0, fromHistory ? workspaceScroll.get(view) || 0 : 0);
  if (view === "live") {
    renderFeed();
    drawChart();
  }
}

// ------------------------------------------------------------------------- //
// WebSocket
// ------------------------------------------------------------------------- //
function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  let ping;
  ws.onopen = () => { ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 20000); };
  ws.onmessage = (ev) => onBatch(JSON.parse(ev.data));
  ws.onclose = () => {
    clearInterval(ping);
    $("pill-kafka").classList.remove("ok");
    $("kafka-status").textContent = "Reconnecting to replay";
    const message = "Reconnecting · showing last received values";
    if ($("overview-session").textContent !== message) $("overview-session").textContent = message;
    $("mobile-freshness").textContent = "Last received values";
    $("replay-metrics").classList.add("is-stale");
    setTimeout(connect, 2000);
  };
}

let chartDirty = false;
function onBatch(b) {
  if (b.telemetry && b.telemetry.length) {
    S.recent.push(...b.telemetry);
    if (S.recent.length > liveRowLimit) S.recent.splice(0, S.recent.length - liveRowLimit);
    b.telemetry.forEach(trackRow);
    if (!S.evidence) {
      renderFeed();
      chartDirty = true;
    }
  }
  (b.incidents || []).forEach(onIncidentEvent);
  (b.reports || []).forEach(onReportEvent);
  if ((b.incidents || []).some((e) => e.event !== "entry_decision") || (b.reports || []).length) renderIncidents();
  if (drawerSelection && ((b.incidents || []).some((e) => e.event !== "entry_decision" && e.incident_id === drawerSelection.id)
      || (b.reports || []).some((e) => e.incident_id === drawerSelection.id))) renderDrawer();
  if (b.stats) renderStats(b.stats);
  if (S.tracker) renderTracker();
}
setInterval(() => { if (chartDirty) { chartDirty = false; drawChart(); } }, 250);

function onIncidentEvent(e) {
  if (e.event === "entry_decision") {
    // Remember recent decisions: a burst is partly processed before the POST
    // that sent it returns, so the tracker backfills from here.
    S.decisions.set(e.entry_id, e);
    if (S.decisions.size > 1000) S.decisions.delete(S.decisions.keys().next().value);
    const t = S.tracker;
    if (t && t.ids.has(e.entry_id)) {
      t.decisions.set(e.entry_id, e);
      if (e.incident_id) t.incidentId = e.incident_id;
    }
    return;
  }
  const cur = S.incidents.get(e.incident_id) || {};
  const merged = { ...cur, ...e };
  if (e.event === "opened") {
    merged.status = "open";
    const t = S.tracker;
    if (t && (e.trigger_entry_ids || []).some((id) => t.ids.has(id))) t.incidentId = e.incident_id;
  } else if (e.event === "closed") {
    merged.status = "closed";
  }
  delete merged.event;
  S.incidents.set(e.incident_id, merged);
}

function onReportEvent(e) {
  const cur = { incident_id: e.incident_id, attack_class: e.attack_class, ...S.incidents.get(e.incident_id) };
  if (e.event === "started") {
    Object.assign(cur, { report_status: "RUNNING", report_mode: e.mode, report_started_ts: e.started_ts });
  } else if (e.event === "finished") {
    Object.assign(cur, {
      report_status: e.status, report_mode: e.mode, report_runtime_sec: e.runtime_sec,
      report_finished_ts: e.finished_ts, report_predicted_class: e.predicted_class,
      report_confidence: e.confidence, report: e.report, sparta_context: e.sparta_context, mitigation: e.mitigation,
    });
  }
  S.incidents.set(e.incident_id, cur);
}

// ------------------------------------------------------------------------- //
// Stats, feed, chart
// ------------------------------------------------------------------------- //
function renderStats(s) {
  $("pill-kafka").classList.toggle("ok", !!s.kafka_ok);
  $("kafka-status").textContent = s.kafka_ok ? "Kafka connected" : "Kafka disconnected";
  $("st-rate").textContent = s.rows_per_sec;
  $("st-acc").textContent = pct(s.accuracy);
  const dataset = s.replay_dataset;
  $("st-dataset").textContent = dataset === "raw" ? "Raw telemetry"
    : dataset === "noised" ? "Noised telemetry" : dataset || "unknown";
  $("st-lat").textContent = s.latency_p50_ms == null ? "–" : Math.round(s.latency_p50_ms) + " ms";
  $("st-last-row").textContent = s.last_row_age_sec == null ? "–" : `${s.last_row_age_sec.toFixed(1)} s ago`;
  $("mobile-freshness").textContent = s.last_row_age_sec == null ? "" : "Last row " + $("st-last-row").textContent;
  $("st-incidents").textContent = (s.counts.incidents_opened || 0).toLocaleString();
  $("pc-rows").textContent = s.rows_total.toLocaleString();
  if (!S.evidence) $("chart-total").textContent = s.rows_total.toLocaleString();
  const replayStatus = s.kafka_ok ? "Replay connected" : "Replay disconnected";
  if ($("overview-session").textContent !== replayStatus) $("overview-session").textContent = replayStatus;
  $("replay-metrics").classList.toggle("is-stale", !s.kafka_ok);
  $("overview-dataset").textContent = $("st-dataset").textContent;
  $("overview-total").textContent = $("pc-rows").textContent;
  $("overview-rate").textContent = s.rows_per_sec + " rows/s";
  $("pc-inc").textContent = (s.counts.incidents_opened || 0).toLocaleString();
  $("pc-rep").textContent = (s.counts.reports_finished || 0).toLocaleString();
  renderPredictionMix(s.pred_counts || {});
}

function renderPredictionMix(counts) {
  const classes = S.config.classes;
  const values = classes.map((name) => counts[name] || 0);
  const key = values.join(",");
  if (key === predictionMixKey) return;
  predictionMixKey = key;
  const total = values.reduce((sum, count) => sum + count, 0);
  $("prediction-counts").innerHTML = classes.map((name, index) => {
    const count = values[index];
    const share = total ? (100 * count / total).toFixed(1) : 0;
    return `<li><span>${cls(name)}</span><b>${count.toLocaleString()}</b>
      <span class="mix-track" aria-hidden="true"><i style="width:${share}%;background:var(${classColorToken(name)})"></i></span></li>`;
  }).join("");
}

function renderFeed() {
  const feed = $("feed");
  if (currentWorkspace !== "live") return;
  const held = feed.contains(document.activeElement);
  $("feed-held").hidden = !held;
  if (held) return;
  const evidence = S.evidence;
  feedSnapshot = evidence?.rows ?? S.recent.slice();
  const end = evidence ? Math.min(feedSnapshot.length, Math.max(14, evidence.selected + 1)) : feedSnapshot.length;
  const selectedId = evidence ? String(feedSnapshot[evidence.selected].entry_id) : null;
  const rows = new Map();
  for (const row of feedSnapshot.slice(Math.max(0, end - 14), end).reverse()) {
    const id = String(row.entry_id);
    if (!rows.has(id)) rows.set(id, row);
  }
  if (!rows.size) {
    if (feed.querySelector("[data-row]")) feed.innerHTML = '<li class="hint">Waiting for scored telemetry.</li>';
    return;
  }
  const existing = new Map();
  for (const item of [...feed.children]) {
    const id = item.firstElementChild?.dataset.row;
    if (rows.has(id)) existing.set(id, item);
    else item.remove();
  }
  let next = feed.firstElementChild;
  for (const [id, row] of rows) {
    let item = existing.get(id);
    if (!item) {
      item = document.createElement("li");
      item.innerHTML = `<button type="button" class="telemetry-row" data-row="${esc(id)}">
    <span class="feed-prediction"><small>Predicted</small>${cls(row.predicted_class)}</span>
    <span class="feed-confidence"><small>Confidence</small>${row.confidence.toFixed(3)}</span>
    <span class="feed-time"><small>Time</small>${fmtTime(row.ts)}<span class="sr-only"> · Row ${esc(row.entry_id)}</span></span>
    <span class="feed-label"><small>Dataset label</small>${row.true_class ? cls(row.true_class) : "Unavailable"}</span>
    <span class="feed-source"><small>Source</small><span class="badge">${row.source === "replay" ? "Replay" : "Injected test"}</span></span>
  </button>`;
    }
    const trigger = Boolean(evidence?.triggerIds.has(row.entry_id));
    item.firstElementChild.classList.toggle("is-trigger", trigger);
    const marker = item.querySelector(".trigger-label");
    if (trigger && !marker) item.querySelector(".feed-prediction").insertAdjacentHTML("beforeend", '<span class="trigger-label">Trigger row</span>');
    if (!trigger) marker?.remove();
    const pressed = String(id === selectedId);
    if (item.firstElementChild.getAttribute("aria-pressed") !== pressed) item.firstElementChild.setAttribute("aria-pressed", pressed);
    if (item === next) next = next.nextElementSibling;
    else feed.insertBefore(item, next);
  }
}

function chartLayout(width, height) {
  const rows = S.evidence?.rows ?? S.recent;
  const slots = S.evidence ? Math.max(2, rows.length) : liveRowLimit;
  const offset = slots - rows.length;
  const step = (width - chartPad.l - chartPad.r) / (slots - 1);
  return {
    rows,
    x: (i) => chartPad.l + step * (i + offset),
    y: (score) => chartPad.t + (height - chartPad.t - chartPad.b) * (1 - score),
  };
}

function drawChart() {
  const c = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight || 260;
  if (!W) return;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const pad = chartPad;
  const { rows, x, y } = chartLayout(W, H);
  const evidence = S.evidence;
  const palette = getComputedStyle(c);
  const accent = palette.getPropertyValue("--chart-accent").trim();
  const muted = palette.getPropertyValue("--chart-ink").trim();
  const colors = new Map([...CLASS_COLOR_TOKENS].map(([name, token]) => [name, palette.getPropertyValue(token).trim()]));

  if (evidence?.first != null) {
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
  const thr = S.config ? S.config.guards.min_confidence : 0.7;

  g.strokeStyle = "rgba(143,160,187,.35)"; g.beginPath();
  rows.forEach((r, i) => (i ? g.lineTo(x(i), y(r.threat)) : g.moveTo(x(i), y(r.threat))));
  g.stroke();
  rows.forEach((r, i) => {
    const passesGuard = r.predicted_class !== "Normal" && r.confidence >= thr;
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

function showEvidence(selection, triggerIds, matching, returnRow) {
  selection.disclosures = [...$("dr-body").querySelectorAll("details[open] > summary")].map((summary) => summary.textContent);
  closeDrawer(false);
  showSnapshot({ id: selection.id, rows: selection.rows, triggerIds, first: matching[0],
    last: matching.at(-1), selected: returnRow ?? matching[0],
    matchingCount: matching.length, incidentOpener: selection.opener, disclosures: selection.disclosures, returnRow });
}

function showSnapshot(snapshot) {
  snapshot.triggerIndices = snapshot.rows.flatMap((row, index) => snapshot.triggerIds.has(row.entry_id) ? [index] : []);
  S.evidence = snapshot;
  $("chart-heading").textContent = "Telemetry snapshot";
  $("chart-scope").textContent = `${snapshot.rows.length} captured rows · ${fmtTime(snapshot.rows[0].ts, true)} to ${fmtTime(snapshot.rows.at(-1).ts, true)}`;
  $("chart-dataset").hidden = true;
  $("replay-metrics").hidden = true;
  $("snapshot-header").hidden = false;
  $("telemetry-inspector-title").textContent = "Selected evidence";
  $("live-view").classList.add("is-snapshot");
  showWorkspace("live");
  $("chart").setAttribute("aria-label", "Frozen telemetry snapshot with the selected row highlighted");
  $("chart-evidence").hidden = false;
  $("live-context").hidden = true;
  $("prediction-mix").hidden = true;
  $("chart-mode").textContent = "Snapshot";
  $("feed-heading").textContent = "Snapshot telemetry rows";
  $("back-incident").hidden = !snapshot.id;
  $("evidence-summary").textContent = snapshot.id
    ? `${snapshot.id} · ${snapshot.matchingCount} of ${snapshot.triggerIds.size} trigger rows captured`
    : "Snapshot held while new telemetry continues to arrive.";
  const range = $("evidence-row");
  range.max = snapshot.rows.length;
  range.value = snapshot.selected + 1;
  selectEvidenceRow();
  range.focus();
}

function selectEvidenceRow() {
  const evidence = S.evidence;
  if (!evidence) return;
  const range = $("evidence-row");
  evidence.selected = Number(range.value) - 1;
  const row = evidence.rows[evidence.selected];
  const trigger = evidence.triggerIds.has(row.entry_id);
  const source = row.source === "replay" ? "Replay" : "Injected test";
  $("evidence-detail").innerHTML = [
    fact("Predicted class", row.predicted_class), fact("Model confidence", row.confidence.toFixed(3)),
    fact("Dataset label", row.true_class), fact("Threat score", pct(row.threat)),
    fact("Timestamp", fmtTime(row.ts, true)), fact("Source", source), fact("Row ID", row.entry_id),
    trigger ? fact("Incident evidence", "Trigger row") : "",
  ].join("");
  $("snapshot-position").textContent = "Row " + range.value + " of " + evidence.rows.length;
  for (const [id, direction] of [["previous-trigger", -1], ["next-trigger", 1]]) {
    $(id).hidden = evidence.triggerIndices.length < 2;
    $(id).disabled = !evidence.triggerIndices.some((i) => direction * (i - evidence.selected) > 0);
  }
  range.setAttribute("aria-valuetext", `Row ${range.value} of ${evidence.rows.length} · ${fmtTime(row.ts, true)} · ${row.predicted_class}`);
  renderFeed();
  drawChart();
}

function returnToLive() {
  const openerId = S.evidence?.openerId;
  S.evidence = null;
  $("chart-total").textContent = $("pc-rows").textContent;
  $("chart-heading").textContent = "Threat score";
  $("chart-scope").textContent = "Recent scored telemetry · up to 300 rows";
  $("chart-dataset").hidden = false;
  $("replay-metrics").hidden = false;
  $("snapshot-header").hidden = true;
  $("telemetry-inspector-title").textContent = "Replay context";
  $("live-view").classList.remove("is-snapshot");
  $("chart-evidence").hidden = true;
  $("live-context").hidden = false;
  $("prediction-mix").hidden = false;
  $("chart-mode").textContent = "Live replay";
  $("feed-heading").textContent = "Recent telemetry rows";
  $("chart").setAttribute("aria-label", "Threat score of the last 300 telemetry rows");
  drawChart();
  renderFeed();
  const row = openerId && $("feed").querySelector(`[data-row="${CSS.escape(openerId)}"]`);
  (row || $(openerId ? "feed-heading" : "chart-heading")).focus();
}

// ------------------------------------------------------------------------- //
// Incidents + drawer
// ------------------------------------------------------------------------- //
function reportState(i) {
  if (!i.report_status) return "queued";
  if (i.report_status === "RUNNING") return "running";
  if (i.report_status === "ERROR") return "error";
  return "ready";
}

function agentBadge(i) {
  const state = reportState(i);
  if (state === "ready" && i.report_mode === "live" && i.report_status === "FLAGGED_FOR_REVIEW") {
    return '<span class="badge run">Awaiting review</span>';
  }
  const label = reportProgress(i).replace(/\.$/, "");
  const styles = { running: "run", error: "err", ready: "done" };
  const style = state === "ready" && i.report_mode !== "live" ? "" : styles[state] || "";
  return `<span class="badge ${style}">${label}</span>`;
}

function renderIncidents() {
  const all = [...S.incidents.values()].filter((i) => i.opened_ts).sort((a, b) => b.opened_ts - a.opened_ts);
  const [search, attackClass, state, report] = incidentFilters.map((id) => $(id).value);
  const query = search.trim().toLowerCase();
  const list = all.filter((i) => (!attackClass || i.attack_class === attackClass)
    && (!state || i.status === state) && (!report || reportState(i) === report)
    && (!query || [i.incident_id, i.attack_class].some((value) => value?.toLowerCase().includes(query))));
  const filtersApplied = [attackClass, state, report].filter(Boolean).length;
  $("filter-count").textContent = filtersApplied ? "(" + filtersApplied + " applied)" : "";
  $("clear-filters").hidden = !(search || filtersApplied);
  $("inc-count").textContent = `${list.length} of ${all.length} loaded · ${list.filter((i) => i.status === "open").length} open`;
  const focused = document.activeElement;
  const groups = ["open", "closed"].map((status) => {
    const incidents = list.filter((i) => i.status === status);
    if (!incidents.length) return "";
    const title = status === "open" ? "Open" : "Closed";
    return `<section class="incident-group">
      <h3><i class="status-mark ${status}" aria-hidden="true"></i>${title} <span>${incidents.length}</span></h3>
      ${incidents.map((i) => `<button type="button" class="inc" data-id="${esc(i.incident_id)}" aria-pressed="${drawerSelection?.id === i.incident_id}">
        <span class="incident-name">${cls(i.attack_class)} <span class="m">${esc(i.incident_id)}</span></span>
        <span class="incident-meta m">${fmtTime(i.opened_ts)} · ${i.row_count ?? "–"} rows · ${pct(i.peak_confidence)} peak</span>
        <span>${agentBadge(i)}</span>
      </button>`).join("")}
    </section>`;
  }).join("");
  const markup = groups || `<div class="queue-empty"><strong>${all.length ? "No matching incidents" : "No incidents yet"}</strong><p>${all.length ? "Clear or change the filters to see more incidents." : "New incidents appear here when telemetry meets the detection criteria."}</p></div>`;
  const queue = $("incidents");
  if (queue.dataset.rendered === markup) return;
  queue.innerHTML = markup;
  queue.dataset.rendered = markup;
  if (focused.matches(".inc")) restoreIncidentFocus(focused);
}

// Tiny Markdown renderer for agent output (escapes first, then formats).
function md(text) {
  if (!text) return "<p class='empty'>–</p>";
  const lines = esc(text).split(/\r?\n/);
  let html = "", inList = false, table = [];
  let tableCount = 0;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  const flushTable = () => {
    if (!table.length) return;
    html += `<div class="report-table" role="region" aria-label="Report table ${++tableCount}" tabindex="0"><table>`
      + table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) =>
        "<tr>" + r.replace(/^\||\|$/g, "").split("|").map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>").join("") + "</table></div>";
    table = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith("|")) { table.push(l); continue; } else flushTable();
    if (/^[-*•]\s+/.test(l)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(l.replace(/^[-*•]\s+/, ""))}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (!l) continue;
    if (/^#{1,6}\s/.test(l)) html += `<h5>${inline(l.replace(/^#+\s*/, ""))}</h5>`;
    else html += `<p>${inline(l)}</p>`;
  }
  flushTable();
  if (inList) html += "</ul>";
  return html;
}

async function openDrawer(id, evidenceRows, opener = document.activeElement, snapshotReturn = null) {
  const selection = {
    id,
    rows: evidenceRows ?? [...new Map(S.recent.map((row) => [row.entry_id, row])).values()],
    opener,
    snapshotDisclosures: snapshotReturn?.disclosures,
  };
  const cached = S.incidents.get(id) || {};
  drawerSelection = selection;
  showWorkspace("incidents");
  $("drawer").hidden = false;
  $("incidents-view").classList.add("has-detail");
  renderIncidents();
  renderDrawer();
  if (snapshotReturn) window.scrollTo(0, workspaceScroll.get("incidents") || 0);
  const trigger = snapshotReturn?.returnRow != null ? incidentTriggerButton(snapshotReturn.returnRow) : null;
  (trigger || (snapshotReturn && $("view-trigger-rows")) || $("dr-close")).focus();

  try {
    const response = await fetch(`/api/incidents/${encodeURIComponent(id)}`);
    if (!response.ok) return; // the recorder may not have persisted the event yet
    const stored = await response.json();
    if (drawerSelection !== selection) return;
    const current = S.incidents.get(id) || {};
    const liveChanges = Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== cached[key]));
    S.incidents.set(id, { ...cached, ...stored, ...liveChanges });
    renderDrawer();
  } catch (_) { /* keep the incident data already shown */ }
}

function incidentTriggerButton(index) {
  return $("dr-body").querySelector(`[data-trigger-row="${CSS.escape(index)}"]`);
}

function renderDrawer() {
  const selection = drawerSelection;
  const { id, rows } = selection;
  const i = S.incidents.get(id) || {};
  const triggerIds = new Set(i.trigger_entry_ids || []);
  const matching = rows.map((row, index) => triggerIds.has(row.entry_id) ? index : -1).filter((index) => index >= 0);
  const evidenceSummary = triggerIds.size ? `${matching.length} of ${triggerIds.size} trigger rows available in the replay buffer.`
    : "No trigger rows recorded for this incident.";
  const status = i.report_status;
  const state = reportState(i);
  const cached = i.report_mode === "cached";
  const complete = state === "ready";
  const provenance = cached ? "Cached example from a different window" :
    i.report_mode === "live" ? "Live analysis of the incident sample window" : "Report source unavailable";
  const body = $("dr-body");
  const previousFocus = document.activeElement;
  const focusedTable = [...body.querySelectorAll(".report-table")].indexOf(previousFocus);
  const tableScroll = focusedTable >= 0 ? previousFocus.scrollLeft : 0;
  const summaries = [...body.querySelectorAll("summary")];
  const focusedSummary = summaries.includes(previousFocus) ? previousFocus.textContent : null;
  const openDetails = new Set(selection.snapshotDisclosures ?? (body.dataset.incidentId === id
    ? summaries.filter((summary) => summary.parentElement.open).map((summary) => summary.textContent)
    : []));
  selection.snapshotDisclosures = null;
  body.dataset.incidentId = id;
  const review = i.report_mode === "live" && status === "FLAGGED_FOR_REVIEW";
  const triggerPreview = matching.slice(0, 3).map((index) => {
    const row = rows[index];
    return `<li><button class="evidence-row" type="button" data-trigger-row="${index}">
      <span><strong>${esc(row.predicted_class)}</strong><small>${esc(row.entry_id)} · ${fmtTime(row.ts)}</small></span>
      <span><strong>${row.confidence.toFixed(3)}</strong><small>Confidence</small></span>
      <span aria-hidden="true">↗</span>
    </button></li>`;
  }).join("");

  body.innerHTML = `
    <div class="panel-console incident-console">
      <div class="incident-console-meta"><span>${esc(id)}</span><span class="console-tag">${i.status === "open" ? "Open" : "Closed"}</span></div>
      <p class="console-label">Predicted class</p>
      <h3 id="dr-title">${esc(i.attack_class || "Unavailable")}</h3>
      <p class="console-source">${provenance}</p>
    </div>
    <div class="incident-sections">
      <section><h4>Prediction and review</h4>
        ${review ? '<p class="review-note"><strong>Awaiting review</strong> · Check the evidence before interpreting the policy outcome.</p>' : agentBadge(i)}
        <dl class="result-facts">${fact("Peak model confidence", i.peak_confidence?.toFixed(4))}
        ${fact("Ground truth (incident sample)", i.sample_true_class)}
        ${i.report_predicted_class && i.report_mode === "live" ? fact("Analysis prediction", i.report_predicted_class) + fact("Analysis confidence", i.report_confidence) : ""}</dl>
        <p class="hint">${confidenceNote}</p>
      </section>
      <section><div class="evidence-heading"><h4>Trigger evidence</h4>
        ${matching.length ? '<button class="btn" type="button" id="view-trigger-rows">View trigger rows</button>' : ""}
        </div><p class="hint">${evidenceSummary}${matching.length > 3 ? " Showing the first 3 below." : ""}</p>
        ${triggerPreview ? `<ul class="evidence-rows">${triggerPreview}</ul>` : ""}
        <p class="hint">Per-window feature attribution is unavailable.</p>
        ${["Command Flooding", "Data Injection"].includes(i.attack_class) ? '<p class="hint">Command Flooding and Data Injection can overlap, even at high model confidence.</p>' : ""}
      </section>
      <section><h4>SPARTA context <span class="badge">AI-generated</span></h4>
        <p class="hint">${provenance}. Threat mapping provides context for review.</p>
        ${complete && i.sparta_context ? outputDetails("View SPARTA mapping", i.sparta_context) : '<p class="hint">SPARTA mapping unavailable.</p>'}
      </section>
      <section><h4>Policy outcome</h4>
        <p class="hint">Structured policy details are unavailable. Policy explanations describe simulated outcomes.</p>
        ${complete ? outputDetails("Policy explanation · AI-generated", i.mitigation) : ""}
      </section>
      <section><h4>AI narrative</h4>
        <p class="hint">${esc(reportProgress(i))}</p>
        ${complete ? outputDetails("Incident narrative", i.report) || '<p class="hint">Narrative unavailable.</p>' : ""}
      </section>
    </div>
    <details class="incident-properties"><summary>Incident properties</summary>
      <dl class="result-facts">
        ${fact("Opened", fmtTime(i.opened_ts, true))}
        ${i.closed_ts != null ? fact("Closed", fmtTime(i.closed_ts, true)) : ""}
        ${fact("Rows", i.row_count)}${fact("Mean confidence", i.mean_confidence?.toFixed(4))}
        ${fact("Duration", i.duration_sec != null ? i.duration_sec + " s" : i.status === "open" ? "Ongoing" : null)}
        ${fact("Analysis time", i.report_runtime_sec != null ? i.report_runtime_sec + " s" : null)}
        ${i.close_reason ? fact("Close reason", i.close_reason) : ""}
      </dl>
    </details>`;
  body.querySelectorAll("summary").forEach((summary) => {
    summary.parentElement.open = openDetails.has(summary.textContent);
    if (summary.textContent === focusedSummary) summary.focus({ preventScroll: true });
  });
  if (focusedTable >= 0) {
    const table = body.querySelectorAll(".report-table")[focusedTable];
    (table?.closest("details")?.open ? table : $("dr-close")).focus({ preventScroll: true });
    if (table) table.scrollLeft = tableScroll;
  }
  const button = $("view-trigger-rows");
  button?.addEventListener("click", () => showEvidence(selection, triggerIds, matching));
  body.querySelectorAll("[data-trigger-row]").forEach((rowButton) => {
    rowButton.addEventListener("click", () => showEvidence(selection, triggerIds, matching, Number(rowButton.dataset.triggerRow)));
  });
  if (previousFocus.dataset.triggerRow != null) {
    (incidentTriggerButton(previousFocus.dataset.triggerRow) || button || $("dr-close")).focus({ preventScroll: true });
  }
  if (previousFocus.id === "view-trigger-rows") (button ?? $("dr-close")).focus({ preventScroll: true });
}

function closeDrawer(restoreFocus = true) {
  if (!drawerSelection) return;
  const { opener } = drawerSelection;
  drawerSelection = null;
  $("drawer").hidden = true;
  $("incidents-view").classList.remove("has-detail");
  renderIncidents();
  if (!restoreFocus) return;
  if (opener.id === "tracker-incident") {
    showWorkspace("lab");
    (opener.hidden ? $("show-simulation") : opener).focus();
  } else {
    restoreIncidentFocus(opener);
  }
}

function restoreIncidentFocus(opener) {
  const id = opener.dataset.id;
  const row = id && $("incidents").querySelector(`[data-id="${CSS.escape(id)}"]`);
  (row || $("incident-search")).focus({ preventScroll: true });
}

// ------------------------------------------------------------------------- //
// Entry points: test panel and simulation
// ------------------------------------------------------------------------- //
async function loadSample() {
  const c = $("t-class").value, q = $("t-quality").value;
  const request = ++sampleRequest;
  sampleLoading = true;
  $("t-load-status").textContent = "Loading selected sample…";
  renderSampleState();
  try {
    const response = await fetch(`/api/sample?cls=${encodeURIComponent(c)}&quality=${q}`);
    if (!response.ok) throw new Error("Sample unavailable");
    const sample = await response.json();
    if (request !== sampleRequest) return;
    const inputs = [...$("t-features").querySelectorAll("input")];
    const values = inputs.map((input) => sample.features?.[input.dataset.f]);
    if (!sample.true_class || values.some((value) => !Number.isFinite(value))) throw new Error("Incomplete sample");
    inputs.forEach((input, index) => {
      input.value = String(values[index]);
      input.dataset.orig = input.value;
      input.classList.remove("changed", "invalid");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      input.parentElement.querySelector(".feature-error")?.remove();
    });
    loadedSample = { requestedClass: c, quality: q, trueClass: sample.true_class };
    $("t-load-status").textContent = "Sample loaded.";
  } catch (_) {
    if (request !== sampleRequest) return;
    $("t-load-status").textContent = loadedSample
      ? "Couldn’t load the selected sample. The previously loaded values are still shown. Select Load sample to retry."
      : "Couldn’t load the sample. Select Load sample to retry.";
  } finally {
    if (request === sampleRequest) {
      sampleLoading = false;
      renderSampleState();
    }
  }
}

function sampleMatchesSelection() {
  return loadedSample?.requestedClass === $("t-class").value && loadedSample.quality === $("t-quality").value;
}

function editedFeatureCount() {
  return $("t-features").querySelectorAll(".changed").length;
}

function renderSampleState() {
  $("t-send").disabled = runPending || sampleLoading || !sampleMatchesSelection();
  $("t-use-loaded").hidden = !loadedSample || sampleMatchesSelection();
  $("t-origin").textContent = loadedSample ? `Source sample: ${loadedSample.trueClass} · ${loadedSample.quality}` : "No sample loaded.";
  const edited = editedFeatureCount();
  $("t-ground-truth").textContent = loadedSample
    ? (edited ? "Submitted entry: " + edited + " edited fields · Dataset ground truth unavailable" : "Submitted entry: dataset ground truth " + loadedSample.trueClass)
    : "";
}

function startTracker(kind, ids, label, trueClass) {
  const t = { kind, ids: new Set(ids), order: ids, label, trueClass, rows: new Map(), decisions: new Map(), incidentId: null, sentAt: Date.now() };
  // Backfill: the server sends a burst before answering the POST, so some
  // rows, decisions and even the incident may already have arrived.
  S.recent.forEach((r) => { if (t.ids.has(r.entry_id)) t.rows.set(r.entry_id, r); });
  ids.forEach((id) => {
    const d = S.decisions.get(id);
    if (d) { t.decisions.set(id, d); if (d.incident_id) t.incidentId = d.incident_id; }
  });
  S.incidents.forEach((inc) => {
    if ((inc.trigger_entry_ids || []).some((id) => t.ids.has(id))) t.incidentId = inc.incident_id;
  });
  S.tracker = t;
  renderTracker();
}

// Keep the previous completed result separate from the active submission.
function showSending(label) {
  const tracker = S.tracker;
  if (tracker && tracker.rows.size >= tracker.ids.size && (tracker.incidentId || tracker.decisions.size >= tracker.ids.size)) {
    const previous = $("previous-run");
    previous.innerHTML = "<details><summary>Previous run · " + esc(tracker.label) + "</summary>" + $("run-result").innerHTML + "</details>";
    previous.hidden = false;
  }
  S.tracker = null;
  $("tr-title").textContent = label;
  delete $("tracker").dataset.rendered;
  $("tracker-incident").hidden = true;
  $("run-result").hidden = true;
  $("run-result").textContent = "";
  $("tracker-announcement").textContent = "Sending telemetry.";
  $("tracker").innerHTML = step("run", "Submitted", "sending…") + step("wait", "Scored", "") +
    step("wait", "Incident", "") + step("wait", "Report", "");
}

function setRunPending(pending) {
  runPending = pending;
  renderSampleState();
  $("show-simulation").disabled = pending;
}

function showRunFailure(message) {
  $("tracker").firstElementChild.outerHTML = step("err", "Submission failed", esc(message) + " Check the connection and try again.");
  $("tracker-announcement").textContent = "Submission failed.";
  toast(message, "error");
}

function trackRow(r) {
  const t = S.tracker;
  if (t && t.ids.has(r.entry_id)) t.rows.set(r.entry_id, r);
}

async function sendEntry() {
  if ($("t-send").disabled) return;
  const feats = {};
  let bad = false;
  $("t-features").querySelectorAll("input").forEach((inp) => {
    const v = parseFloat(inp.value);
    if (!isFinite(v)) {
      bad = true;
      inp.classList.add("invalid");
      inp.setAttribute("aria-invalid", "true");
      if (!inp.parentElement.querySelector(".feature-error")) {
        const error = document.createElement("small");
        error.className = "feature-error";
        error.id = inp.id + "-error";
        error.textContent = "Enter a number.";
        inp.setAttribute("aria-describedby", error.id);
        inp.after(error);
      }
    } else {
      inp.classList.remove("invalid");
    }
    feats[inp.dataset.f] = v;
  });
  if (bad) {
    $("feature-editor").open = true;
    $("t-features").querySelector(".invalid").focus();
    toast("Every feature needs a number. Click “Load sample” to start from a real row.", "error");
    return;
  }
  const burst = document.querySelector("input[name=t-mode]:checked").value === "burst";
  if (burst && !$("t-burst").reportValidity()) return;
  const count = burst ? $("t-burst").valueAsNumber : 1;
  const edited = editedFeatureCount();
  // Edited rows have no known ground truth, so don't count them toward accuracy.
  const trueClass = edited ? null : loadedSample.trueClass;
  const btn = $("t-send");
  setRunPending(true);
  showSending(`${burst ? count + "× " : ""}test entry`);
  try {
    const r = await fetch("/api/panel/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: feats, count, true_class: trueClass, interval_sec: 0.1 }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || r.statusText);
    startTracker(burst ? "burst" : "once", j.entry_ids,
      `${burst ? count + "× " : ""}test entry${edited ? ` (${edited} field${edited > 1 ? "s" : ""} edited)` : ""}`, trueClass);
  } catch (e) {
    showRunFailure("Send failed: " + e.message);
  } finally {
    setRunPending(false);
    if (!$("lab-view").hidden && document.activeElement === document.body) btn.focus();
  }
}

async function launchAttack(c, btn) {
  const quality = $("atk-quality").value;
  const count = Number($("atk-count").value);
  setRunPending(true);
  showSending(`${c} attack (${count} ${quality} rows)`);
  try {
    const r = await fetch("/api/attack", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cls: c, count, quality }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || r.statusText);
    startTracker("burst", j.entry_ids, `${c} attack (${count} ${quality} rows)`, c);
  } catch (e) {
    showRunFailure("Simulation failed: " + e.message);
  } finally {
    setRunPending(false);
    if (!$("lab-view").hidden && document.activeElement === document.body) btn.focus();
  }
}

function step(state, title, body) {
  const labels = { done: "Complete", run: "In progress", wait: "Waiting", no: "Skipped", err: "Failed" };
  const status = labels[state] || "Unavailable";
  return `<li class="${state}"><b>${title}</b><span class="step-status">${status}</span><span>${body}</span></li>`;
}

function renderTracker() {
  const t = S.tracker;
  if (!t) return;
  $("tr-title").textContent = t.label;
  const n = t.ids.size, got = t.rows.size;
  const items = [step("done", "Submitted", `${n} entr${n > 1 ? "ies" : "y"} written to telemetry.raw`)];

  // 2. Detection
  if (!got) {
    items.push(step("run", "Scored", "waiting for the detector…"));
  } else if (n === 1) {
    const r = [...t.rows.values()][0];
    const latency = Number.isFinite(r.latency_ms) ? " · " + Math.round(r.latency_ms) + " ms latency" : "";
    items.push(step("done", "Scored", "1 entry scored" + latency));
  } else {
    items.push(step(got < n ? "run" : "done", "Scored", `${got} of ${n} entries scored`));
  }

  // 3. Incident
  const inc = t.incidentId ? S.incidents.get(t.incidentId) : null;
  const last = [...t.order].reverse().map((id) => t.decisions.get(id)).find(Boolean);
  if (inc) {
    items.push(step("done", "Incident decision", `${cls(inc.attack_class)} · ${inc.status === "open" ? "open" : "closed"} · ${inc.row_count} rows`));
  } else if (last) {
    const finished = t.decisions.size >= n;
    const msg = finished
      ? ({ normal: "No incident: detected as Normal.", below_confidence: "No incident: below the confidence guard.", pending: "No incident: not enough attack rows in the window." }[last.decision] || "No incident.") + `<br><small>${esc(last.detail)}</small>`
      : esc(last.detail);
    items.push(step(finished ? "no" : "run", "Incident decision", msg));
  } else {
    items.push(step(got ? "run" : "wait", "Incident", got ? "waiting for the incident manager…" : ""));
  }

  // The action stays mounted as replay and report events update progress.
  const state = inc ? reportState(inc) : "wait";
  const reportStyle = { queued: "run", running: "run", ready: "done", error: "err", wait: "wait" };
  const progress = inc ? reportProgress(inc) : t.decisions.size >= n ? "No incident report for this run." : "";
  items.push(step(reportStyle[state], "Report", progress));
  const action = $("tracker-incident");
  action.hidden = !inc;
  if (inc) action.dataset.open = inc.incident_id;

  const markup = items.join("");
  const list = $("tracker");
  if (list.dataset.rendered !== markup) {
    list.innerHTML = markup;
    list.dataset.rendered = markup;
  }
  const announcement = progress || (inc ? "Incident available." : got >= n ? "Telemetry scored." : "Waiting for scored telemetry.");
  const status = $("tracker-announcement");
  if (status.textContent !== announcement) status.textContent = announcement;

  const result = $("run-result");
  if (!got) return;
  const rows = [...t.rows.values()];
  const counts = new Map();
  for (const row of rows) counts.set(row.predicted_class, (counts.get(row.predicted_class) || 0) + 1);
  const prediction = n === 1 ? rows[0].predicted_class : [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => count + " × " + name).join(" · ");
  const confidence = n === 1 ? rows[0].confidence.toFixed(3) : (rows.reduce((sum, row) => sum + row.confidence, 0) / got).toFixed(3);
  const summary = '<h3>Prediction and evidence</h3><dl class="result-facts">'
    + fact(n === 1 ? "Predicted class" : "Predictions so far", prediction)
    + fact(n === 1 ? "Model confidence" : "Mean model confidence", confidence)
    + fact("Source", "Injected test")
    + fact("Ground truth (dataset)", t.trueClass)
    + '</dl>';
  if (result.innerHTML !== summary) result.innerHTML = summary;
  result.hidden = false;
}

function reportProgress(incident) {
  const state = reportState(incident);
  if (state === "queued") return "Queued for a report.";
  if (state === "error") return "Report unavailable. Review the telemetry evidence.";
  if (incident.report_mode === "cached") {
    return state === "running" ? "Loading a cached example." : "Cached example available.";
  }
  if (incident.report_mode !== "live") return "Report source unavailable.";
  if (state === "running") return "Live analysis running.";
  return incident.report_status === "FLAGGED_FOR_REVIEW" ? "Awaiting review." : "Report ready.";
}

setupOverview();
$("show-simulation").disabled = true;
$("t-load").disabled = true;
$("retry-replay").addEventListener("click", boot);
boot();
