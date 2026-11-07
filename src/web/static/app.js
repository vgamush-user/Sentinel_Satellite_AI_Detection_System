"use strict";
// Sentinel live monitor client: initial state from /api/state, then live
// batches over the /ws WebSocket (telemetry rows, incident and report events).

const COLORS = {
  "Normal": "#5fbf8f",
  "Storage Exhaustion": "#f5b84d",
  "Command Flooding": "#ff6b6b",
  "Data Injection": "#b48cff",
  "Defence Impairment": "#4da3ff",
};
const S = {
  config: null,
  recent: [],              // last 300 slim telemetry rows
  incidents: new Map(),    // incident_id -> merged incident + report fields
  tracker: null,           // the latest thing sent from this page
  decisions: new Map(),    // entry_id -> latest entry_decision (recent injected entries)
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (ts) => ts ? new Date(ts * 1000).toLocaleTimeString([], { hour12: false }) : "–";
const pct = (v) => v == null ? "–" : (v * 100).toFixed(1) + "%";
const cls = (name) => `<span class="cls"><i style="background:${COLORS[name] || "#888"}"></i>${esc(name || "–")}</span>`;

let lastFocusedElement = null;

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
  const st = await (await fetch("/api/state")).json();
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

function setupStatic() {
  const g = S.config.guards;
  document.querySelectorAll(".g-conf").forEach((e) => (e.textContent = g.min_confidence));
  document.querySelectorAll(".g-rows").forEach((e) => (e.textContent = g.min_rows));
  document.querySelectorAll(".g-win").forEach((e) => (e.textContent = g.window_rows));
  $("pc-guard").textContent = `${g.min_rows} of ${g.window_rows} rows ≥ ${g.min_confidence}`;
  $("st-mode").textContent = S.config.agent_mode;

  $("legend").innerHTML = S.config.classes.map((c) => `<span><i style="background:${COLORS[c]}"></i>${esc(c)}</span>`).join("");

  const btns = $("attack-buttons");
  S.config.classes.filter((c) => c !== "Normal").forEach((c) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.style.borderLeftColor = COLORS[c];
    b.textContent = c;
    b.addEventListener("click", () => launchAttack(c, b));
    btns.appendChild(b);
  });

  const sel = $("t-class");
  sel.innerHTML = S.config.classes.map((c) => `<option>${esc(c)}</option>`).join("") + `<option value="random">Random row</option>`;
  sel.value = "Command Flooding";

  $("t-features").innerHTML = S.config.features.map((f) =>
    `<label title="${esc(f)}">${esc(f)}<input type="number" step="any" data-f="${esc(f)}"></label>`).join("");
  $("t-features").addEventListener("input", (e) => {
    if (e.target.dataset.f) {
      e.target.classList.toggle("changed", e.target.value !== e.target.dataset.orig);
      e.target.classList.remove("invalid");
    }
  });
  $("t-load").addEventListener("click", loadSample);
  $("t-send").addEventListener("click", sendEntry);
  $("dr-close").addEventListener("click", closeDrawer);
  $("drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // Focus trap inside modal drawer
  $("drawer").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      $("drawer").querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  });

  // Interactive timeline scrubbing / inspection on telemetry canvas
  const chartEl = $("chart");
  const tipEl = $("chart-tip");
  if (chartEl && tipEl) {
    chartEl.addEventListener("pointermove", (e) => {
      if (!S.recent.length) return;
      const rect = chartEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const pad = { l: 34, r: 10, t: 10, b: 20 };
      const iw = rect.width - pad.l - pad.r;
      const n = 300;
      const rows = S.recent;
      const relX = mx - pad.l;
      if (relX < 0 || relX > iw) {
        tipEl.classList.remove("visible");
        return;
      }
      const idx = Math.round((relX / iw) * (n - 1) - (n - rows.length));
      if (idx >= 0 && idx < rows.length) {
        const r = rows[idx];
        const ih = (rect.height || 260) - pad.t - pad.b;
        const py = pad.t + ih * (1 - r.threat);
        const px = pad.l + iw * (idx + (n - rows.length)) / (n - 1);
        tipEl.innerHTML = `<b>${fmtTime(r.ts)}</b> · ${cls(r.predicted_class)}<br>threat: <b>${(r.threat * 100).toFixed(1)}%</b> · conf: <b>${r.confidence.toFixed(3)}</b>`;
        tipEl.style.left = px + "px";
        tipEl.style.top = py + "px";
        tipEl.classList.add("visible");
      } else {
        tipEl.classList.remove("visible");
      }
    });
    chartEl.addEventListener("pointerleave", () => {
      tipEl.classList.remove("visible");
    });
  }

  window.addEventListener("resize", drawChart);
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
    setTimeout(connect, 2000);
  };
}

let chartDirty = false;
function onBatch(b) {
  if (b.telemetry && b.telemetry.length) {
    S.recent.push(...b.telemetry);
    if (S.recent.length > 300) S.recent.splice(0, S.recent.length - 300);
    b.telemetry.forEach(trackRow);
    // Note: high-frequency flash("pc-rows") reflow removed to eliminate main-thread layout thrashing
    renderFeed();
    chartDirty = true;
  }
  (b.incidents || []).forEach(onIncidentEvent);
  (b.reports || []).forEach(onReportEvent);
  if ((b.incidents || []).some((e) => e.event !== "entry_decision") || (b.reports || []).length) renderIncidents();
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
    merged.fresh = true;
    flash("pc-inc");
    const t = S.tracker;
    if (t && (e.trigger_entry_ids || []).some((id) => t.ids.has(id))) t.incidentId = e.incident_id;
  } else if (e.event === "closed") {
    merged.status = "closed";
  }
  delete merged.event;
  S.incidents.set(e.incident_id, merged);
}

function onReportEvent(e) {
  const cur = S.incidents.get(e.incident_id) || { incident_id: e.incident_id, attack_class: e.attack_class };
  if (e.event === "started") {
    Object.assign(cur, { report_status: "RUNNING", report_mode: e.mode, report_started_ts: e.started_ts });
  } else if (e.event === "finished") {
    Object.assign(cur, {
      report_status: e.status, report_mode: e.mode, report_runtime_sec: e.runtime_sec,
      report_finished_ts: e.finished_ts, report_predicted_class: e.predicted_class,
      report_confidence: e.confidence, report: e.report, sparta_context: e.sparta_context, mitigation: e.mitigation,
    });
    flash("pc-rep");
  }
  S.incidents.set(e.incident_id, cur);
  if ($("drawer").classList.contains("open") && $("drawer").dataset.id === e.incident_id) openDrawer(e.incident_id, true);
}

function flash(id) {
  const el = $(id).parentElement;
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

// ------------------------------------------------------------------------- //
// Stats, feed, chart
// ------------------------------------------------------------------------- //
function renderStats(s) {
  $("pill-kafka").classList.toggle("ok", !!s.kafka_ok);
  $("st-rate").textContent = s.rows_per_sec;
  $("st-acc").textContent = pct(s.accuracy);
  $("st-lat").textContent = s.latency_p50_ms == null ? "–" : Math.round(s.latency_p50_ms) + " ms";
  $("pc-rows").textContent = s.rows_total.toLocaleString();
  $("pc-inc").textContent = (s.counts.incidents_opened || 0).toLocaleString();
  $("pc-rep").textContent = (s.counts.reports_finished || 0).toLocaleString();
}

function renderFeed() {
  const rows = S.recent.slice(-14).reverse();
  $("feed").innerHTML = rows.map((r) => {
    const inj = r.source !== "replay";
    return `<tr class="${inj ? "injected" : ""}"><td>${fmtTime(r.ts)}</td>
      <td><span class="src ${inj ? "inj" : ""}">${esc(r.source)}</span></td>
      <td>${r.true_class ? cls(r.true_class) : "–"}</td><td>${cls(r.predicted_class)}</td>
      <td>${r.confidence.toFixed(2)}</td></tr>`;
  }).join("");
}

function drawChart() {
  const c = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight || 260;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const pad = { l: 34, r: 10, t: 10, b: 20 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const y = (v) => pad.t + ih * (1 - v);

  g.font = "11px system-ui, sans-serif";
  g.fillStyle = "#8fa0bb"; g.strokeStyle = "#1c2a45"; g.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g.beginPath(); g.moveTo(pad.l, y(v)); g.lineTo(W - pad.r, y(v)); g.stroke();
    g.fillText(v.toFixed(2), 2, y(v) + 4);
  });
  const thr = S.config ? S.config.guards.min_confidence : 0.7;
  g.setLineDash([5, 4]); g.strokeStyle = "#f5b84d";
  g.beginPath(); g.moveTo(pad.l, y(thr)); g.lineTo(W - pad.r, y(thr)); g.stroke();
  g.setLineDash([]);
  g.fillStyle = "#f5b84d"; g.fillText("evidence ≥ " + thr, W - pad.r - 84, y(thr) - 4);

  const rows = S.recent, n = 300;
  const x = (i) => pad.l + iw * (i + (n - rows.length)) / (n - 1);
  g.strokeStyle = "rgba(143,160,187,.35)"; g.beginPath();
  rows.forEach((r, i) => (i ? g.lineTo(x(i), y(r.threat)) : g.moveTo(x(i), y(r.threat))));
  g.stroke();
  rows.forEach((r, i) => {
    const evidence = r.predicted_class !== "Normal" && r.confidence >= thr;
    const rad = evidence ? 4 : 2.2;
    g.fillStyle = COLORS[r.predicted_class] || "#888";
    g.beginPath(); g.arc(x(i), y(r.threat), rad, 0, Math.PI * 2); g.fill();
    if (r.source !== "replay") {
      g.strokeStyle = "#e6ecf5"; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x(i), y(r.threat), rad + 2.5, 0, Math.PI * 2); g.stroke();
    }
  });
  g.fillStyle = "#8fa0bb";
  g.fillText("older", pad.l, H - 5);
  g.fillText("now", W - pad.r - 22, H - 5);
}

// ------------------------------------------------------------------------- //
// Incidents + drawer
// ------------------------------------------------------------------------- //
function agentBadge(i) {
  const s = i.report_status;
  if (!s) return `<span class="badge">queued for AI</span>`;
  if (s === "RUNNING") return `<span class="badge run">AI analysing…</span>`;
  if (s === "ERROR") return `<span class="badge err">AI error</span>`;
  return `<span class="badge done">report ready</span>`;
}

function renderIncidents() {
  const list = [...S.incidents.values()].filter((i) => i.opened_ts).sort((a, b) => b.opened_ts - a.opened_ts);
  $("inc-count").textContent = list.length ? `${list.filter((i) => i.status === "open").length} open · ${list.length} total` : "";
  if (!list.length) return;
  $("incidents").innerHTML = list.map((i) => `
    <button class="inc ${i.fresh ? "fresh" : ""}" data-id="${esc(i.incident_id)}">
      <span class="bar" style="background:${COLORS[i.attack_class] || "#888"}"></span>
      <span><span class="t">${esc(i.attack_class)}</span> <span class="m">${esc(i.incident_id)}</span><br>
        <span class="m">${fmtTime(i.opened_ts)} · ${i.row_count} rows · peak ${(i.peak_confidence ?? 0).toFixed(3)}
        ${i.status === "closed" && i.duration_sec != null ? ` · lasted ${i.duration_sec}s` : ""}</span></span>
      <span>${i.status === "open" ? `<span class="badge open">open</span>` : `<span class="badge">closed</span>`} ${agentBadge(i)}</span>
    </button>`).join("");
  list.forEach((i) => delete i.fresh);
  $("incidents").querySelectorAll(".inc").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.id)));
}

// Tiny Markdown renderer for agent output (escapes first, then formats).
function md(text) {
  if (!text) return "<p class='empty'>–</p>";
  const lines = esc(text).split(/\r?\n/);
  let html = "", inList = false, table = [];
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  const flushTable = () => {
    if (!table.length) return;
    html += "<table>" + table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) =>
      "<tr>" + r.replace(/^\||\|$/g, "").split("|").map((c) => `<td>${inline(c.trim())}</td>`).join("") + "</tr>").join("") + "</table>";
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

async function openDrawer(id, quiet) {
  if (!quiet) {
    lastFocusedElement = document.activeElement;
  }
  let i = S.incidents.get(id) || {};
  if (!quiet) {
    try {
      const r = await fetch(`/api/incidents/${encodeURIComponent(id)}`);
      if (r.ok) { i = { ...i, ...(await r.json()) }; S.incidents.set(id, i); }
    } catch (_) { /* live data is enough */ }
  }
  const status = i.report_status;
  const reportBody = !status
    ? `<p class="empty">Queued: the agent worker analyses one incident at a time.</p>`
    : status === "RUNNING"
      ? `<p class="empty">The 4 agents are working on this incident (started ${fmtTime(i.report_started_ts)}). On the Groq free tier this takes about 1–2 minutes.</p>`
      : `${md(i.report)}`;
  $("dr-body").innerHTML = `
    <div class="dr-head">
      <h3 id="dr-title">${cls(i.attack_class)} <span class="m">${esc(id)}</span></h3>
      <span>${i.status === "open" ? `<span class="badge open">open</span>` : `<span class="badge">closed</span>`} ${agentBadge(i)}</span>
    </div>
    <div class="kv">
      <div><small>Opened</small><b>${fmtTime(i.opened_ts)}</b></div>
      <div><small>Rows</small><b>${i.row_count ?? "–"}</b></div>
      <div><small>Peak confidence</small><b>${(i.peak_confidence ?? 0).toFixed(4)}</b></div>
      <div><small>Mean confidence</small><b>${(i.mean_confidence ?? 0).toFixed(4)}</b></div>
      <div><small>Duration</small><b>${i.duration_sec != null ? i.duration_sec + " s" : "ongoing"}</b></div>
      <div><small>Sample row true class</small><b>${esc(i.sample_true_class || "unknown")}</b></div>
      ${status && status !== "RUNNING" ? `
      <div><small>Agent verdict</small><b>${esc(status)}</b></div>
      <div><small>Agent classification</small><b>${esc(i.report_predicted_class || "–")} ${i.report_confidence != null ? "(" + i.report_confidence + ")" : ""}</b></div>
      <div><small>Analysis time</small><b>${i.report_runtime_sec ?? "–"} s · ${esc(i.report_mode || "")}</b></div>` : ""}
    </div>
    ${i.close_reason ? `<p class="hint">Closed: ${esc(i.close_reason)}</p>` : ""}
    <div class="section"><h4>Incident report</h4><div class="md">${reportBody}</div></div>
    ${status && status !== "RUNNING" ? `
    <div class="section"><h4>SPARTA threat context</h4><div class="md">${md(i.sparta_context)}</div></div>
    <div class="section"><h4>Mitigation</h4><div class="md">${md(i.mitigation)}</div></div>` : ""}`;
  const d = $("drawer");
  d.dataset.id = id;
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("dr-close").focus(), 60);
}

function closeDrawer() {
  const d = $("drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

// ------------------------------------------------------------------------- //
// Entry points: test panel + attack buttons
// ------------------------------------------------------------------------- //
async function loadSample() {
  const c = $("t-class").value, q = $("t-quality").value;
  const r = await fetch(`/api/sample?cls=${encodeURIComponent(c)}&quality=${q}`);
  if (!r.ok) return;
  const s = await r.json();
  $("t-features").querySelectorAll("input").forEach((inp) => {
    const v = s.features[inp.dataset.f];
    inp.value = String(+v.toPrecision(8));
    inp.dataset.orig = inp.value;
    inp.classList.remove("changed", "invalid");
  });
  $("t-features").dataset.trueClass = s.true_class;
  $("t-origin").textContent = `Real ${q} row, true class: ${s.true_class}. Edit any value before sending.`;
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

// Clear the previous tracking the moment something new is sent, so stale
// results never show for the new entry.
function showSending(label) {
  S.tracker = null;
  $("tr-title").textContent = label;
  $("tracker").innerHTML = step("run", "Sent to Kafka", "sending…") + step("wait", "Detected", "") +
    step("wait", "Incident", "") + step("wait", "AI report", "");
}

function trackRow(r) {
  const t = S.tracker;
  if (t && t.ids.has(r.entry_id)) t.rows.set(r.entry_id, r);
}

async function sendEntry() {
  const feats = {};
  let bad = false;
  $("t-features").querySelectorAll("input").forEach((inp) => {
    const v = parseFloat(inp.value);
    if (!isFinite(v)) {
      bad = true;
      inp.classList.add("invalid");
    } else {
      inp.classList.remove("invalid");
    }
    feats[inp.dataset.f] = v;
  });
  if (bad) {
    toast("Every feature needs a number. Click “Load sample” to start from a real row.", "error");
    return;
  }
  const burst = document.querySelector("input[name=t-mode]:checked").value === "burst";
  const count = burst ? Math.max(2, Math.min(50, +$("t-burst").value || 10)) : 1;
  const edited = [...$("t-features").querySelectorAll("input.changed")].length;
  // Edited rows have no known ground truth, so don't count them toward accuracy.
  const trueClass = edited ? null : ($("t-features").dataset.trueClass || null);
  const btn = $("t-send");
  btn.disabled = true;
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
    toast("Send failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function launchAttack(c, btn) {
  const quality = $("atk-quality").value;
  const count = Math.max(1, Math.min(100, +$("atk-count").value || 15));
  btn.disabled = true;
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
    toast("Attack failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

function step(state, title, body) {
  return `<li class="${state}"><b>${title}</b><span>${body}</span></li>`;
}

function renderTracker() {
  const t = S.tracker;
  if (!t) return;
  $("tr-title").textContent = t.label;
  const n = t.ids.size, got = t.rows.size;
  const items = [step("done", "Sent to Kafka", `${n} entr${n > 1 ? "ies" : "y"} written to telemetry.raw`)];

  // 2. Detection
  if (!got) {
    items.push(step("run", "Detected", "waiting for the detector…"));
  } else if (n === 1) {
    const r = [...t.rows.values()][0];
    const verdict = r.true_class ? (r.true_class === r.predicted_class ? " (matches the true class)" : ` (true class: ${esc(r.true_class)})`) : "";
    items.push(step("done", "Detected", `${cls(r.predicted_class)} · confidence ${r.confidence.toFixed(3)} · ${Math.round(r.latency_ms)} ms after sending${verdict}`));
  } else {
    const counts = {};
    let conf = 0;
    t.rows.forEach((r) => { counts[r.predicted_class] = (counts[r.predicted_class] || 0) + 1; conf += r.confidence; });
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${cls(k)}`).join(", ");
    items.push(step(got < n ? "run" : "done", "Detected", `${got}/${n} scored: ${parts} · mean confidence ${(conf / got).toFixed(2)}`));
  }

  // 3. Incident
  const inc = t.incidentId ? S.incidents.get(t.incidentId) : null;
  const last = [...t.order].reverse().map((id) => t.decisions.get(id)).find(Boolean);
  if (inc) {
    items.push(step("done", "Incident", `<button class="linkish" data-open="${esc(inc.incident_id)}">${esc(inc.incident_id)}</button> ${cls(inc.attack_class)} · ${inc.status === "open" ? "open" : "closed"} · ${inc.row_count} rows`));
  } else if (last) {
    const finished = t.decisions.size >= n;
    const msg = finished
      ? ({ normal: "No incident: detected as Normal.", below_confidence: "No incident: below the confidence guard.", pending: "No incident: not enough attack rows in the window." }[last.decision] || "No incident.") + `<br><small>${esc(last.detail)}</small>`
      : esc(last.detail);
    items.push(step(finished ? "no" : "run", "Incident", msg));
  } else {
    items.push(step(got ? "run" : "wait", "Incident", got ? "waiting for the incident manager…" : ""));
  }

  // 4. AI report
  if (!inc) {
    const none = t.decisions.size >= n;
    items.push(step(none ? "no" : "wait", "AI report", none ? "Only incidents get an AI report." : ""));
  } else if (!inc.report_status) {
    items.push(step("run", "AI report", "queued for the agent worker…"));
  } else if (inc.report_status === "RUNNING") {
    const secs = Math.round(Date.now() / 1000 - (inc.report_started_ts || Date.now() / 1000));
    items.push(step("run", "AI report", `4 agents analysing… ${secs}s (usually 1–2 min on Groq's free tier)`));
  } else if (inc.report_status === "ERROR") {
    items.push(step("err", "AI report", `the agents failed. <button class="linkish" data-open="${esc(inc.incident_id)}">Details</button>`));
  } else {
    items.push(step("done", "AI report", `${esc(inc.report_status)} in ${inc.report_runtime_sec}s · <button class="linkish" data-open="${esc(inc.incident_id)}">View report</button>`));
  }

  $("tracker").innerHTML = items.join("");
  $("tracker").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.open)));
}
// Keep the "analysing… Ns" timer ticking.
setInterval(() => { const t = S.tracker; if (t && t.incidentId) renderTracker(); }, 1000);

boot();
