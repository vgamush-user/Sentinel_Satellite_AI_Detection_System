import { useEffect, useReducer, useState } from "react";
import { batch, initial, request, type Batch, type Decision, type Incident, type Initial, type Row } from "./protocol";

type Replay = Omit<Initial, "incidents"> & { incidents: Map<string, Incident>; decisions: Map<string, Decision> };
type Action = { snapshot: Initial; buffered: Batch[] }
  | { batch: Batch } | { stored: Incident; baseline: Incident | undefined };

export function mergeStored(current: Incident | undefined, stored: Incident, baseline: Incident | undefined): Incident {
  const updates = Object.entries(current ?? {}).filter(([key, value]) => value !== baseline?.[key as keyof Incident]);
  return { ...baseline, ...stored, ...Object.fromEntries(updates) };
}

function appendRows(previous: Row[], incoming: Row[]) {
  return [...new Map([...previous, ...incoming].map(row => [row.entry_id, row])).values()].slice(-300);
}

export function replayReducer(state: Replay | null, action: Action): Replay | null {
  if ("snapshot" in action) {
    const { snapshot, buffered } = action;
    const incidents = new Map(state?.incidents);
    for (const item of snapshot.incidents) {
      const live = incidents.get(item.incident_id);
      const details = live && (incidentVersion(live) > incidentVersion(item) || (live.status === "closed" && item.status !== "closed")) ? live : item;
      const report = live && reportVersion(live) > reportVersion(item) ? live : item;
      incidents.set(item.incident_id, { ...live, ...details,
        report_status: report.report_status, report_mode: report.report_mode, report: report.report,
        report_started_ts: report.report_started_ts, report_finished_ts: report.report_finished_ts,
        report_runtime_sec: report.report_runtime_sec, report_predicted_class: report.report_predicted_class,
        report_confidence: report.report_confidence, sparta_context: report.sparta_context, mitigation: report.mitigation });
    }
    let next: Replay = { ...snapshot, incidents, decisions: state?.decisions ?? new Map() };
    for (const update of buffered) {
      // The total is a session cursor. A frame can straddle the snapshot's last row.
      const count = update.stats && update.stats.rows_total - snapshot.stats.rows_total;
      const rows = update.telemetry;
      next = applyBatch(next, { ...update, telemetry: count === undefined ? rows : count > 0 ? rows?.slice(-count) : undefined,
        stats: count !== undefined && count >= 0 ? update.stats : undefined });
    }
    return next;
  }
  if (!state) return state;
  if ("batch" in action) return applyBatch(state, action.batch);
  const incidents = new Map(state.incidents);
  incidents.set(action.stored.incident_id, mergeStored(incidents.get(action.stored.incident_id), action.stored, action.baseline));
  return { ...state, incidents };
}

const incidentVersion = (item: Incident) => item.closed_ts ?? item.last_seen_ts ?? item.opened_ts ?? 0;
const reportVersion = (item: Incident) => Math.max(item.report_started_ts ?? 0, item.report_finished_ts ?? 0);

function applyBatch(state: Replay, update: Batch): Replay {
  const incidents = update.incidents?.length || update.reports?.length ? new Map(state.incidents) : state.incidents;
  const decisions = update.incidents?.some(event => event.event === "entry_decision") ? new Map(state.decisions) : state.decisions;
  for (const event of update.incidents ?? []) {
    if (event.event === "entry_decision") {
      decisions.set(event.entry_id, event);
      if (decisions.size > 1000) {
        const oldest = decisions.keys().next();
        if (!oldest.done) decisions.delete(oldest.value);
      }
    } else {
      const { event: kind, ...fields } = event;
      const previous = incidents.get(event.incident_id);
      if (previous && (incidentVersion(previous) > incidentVersion(fields) || (previous.status === "closed" && kind !== "closed"))) continue;
      incidents.set(event.incident_id, { ...previous, ...fields,
        status: kind === "closed" ? "closed" : kind === "opened" ? "open" : previous?.status });
    }
  }
  for (const event of update.reports ?? []) {
    const current = { incident_id: event.incident_id, attack_class: event.attack_class, ...incidents.get(event.incident_id) };
    const version = (event.event === "finished" ? event.finished_ts : event.started_ts) ?? 0;
    if (version && reportVersion(current) > version) continue;
    incidents.set(event.incident_id, event.event === "started"
      ? { ...current, report_status: "RUNNING", report_mode: event.mode, report_started_ts: event.started_ts }
      : { ...current, report_status: event.status, report_mode: event.mode, report_runtime_sec: event.runtime_sec,
          report_started_ts: event.started_ts, report_finished_ts: event.finished_ts,
          report_predicted_class: event.predicted_class, report_confidence: event.confidence, report: event.report,
          sparta_context: event.sparta_context, mitigation: event.mitigation });
  }
  return { ...state, incidents, decisions, stats: update.stats ?? state.stats,
    recent: update.telemetry?.length ? appendRows(state.recent, update.telemetry) : state.recent };
}

export function useReplay() {
  const [data, dispatch] = useReducer(replayReducer, null);
  const [attempt, retry] = useReducer(value => value + 1, 0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnect: number | undefined;
    let ping: number | undefined;
    let hydration: AbortController | undefined;
    let ready = false;
    let buffered: Batch[] | null = null;
    async function hydrate() {
      hydration?.abort();
      const controller = new AbortController();
      hydration = controller;
      buffered = [];
      try {
        const snapshot = await request("/api/state", initial, { signal: controller.signal });
        if (controller.signal.aborted) return;
        dispatch({ snapshot, buffered: buffered ?? [] });
        ready = true;
        setError(false);
      } catch {
        if (!controller.signal.aborted) {
          if (!ready) setError(true);
          else for (const update of buffered ?? []) dispatch({ batch: update });
        }
      } finally {
        if (!controller.signal.aborted) {
          buffered = null;
          setLoading(false);
        }
      }
    }
    function connect() {
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      const current = socket;
      current.onopen = () => {
        ping = window.setInterval(() => { if (current.readyState === WebSocket.OPEN) current.send("ping"); }, 20000);
        void hydrate();
      };
      current.onmessage = event => {
        try {
          const value: unknown = JSON.parse(event.data);
          if (!batch(value)) return;
          if (buffered) buffered.push(value);
          else if (ready) dispatch({ batch: value });
          setStale(false);
        } catch { /* Ignore malformed frames. */ }
      };
      current.onclose = () => {
        window.clearInterval(ping);
        if (disposed) return;
        setStale(true);
        reconnect = window.setTimeout(connect, 2000);
      };
    }
    setLoading(true);
    // Deferring the first connection lets Strict Mode clean up its trial effect before opening a socket.
    const start = window.setTimeout(() => { void hydrate(); connect(); }, 0);
    return () => {
      disposed = true;
      hydration?.abort();
      window.clearTimeout(start);
      window.clearTimeout(reconnect);
      window.clearInterval(ping);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  }, [attempt]);

  return { data, error, loading, stale, retry,
    store: (stored: Incident, baseline: Incident | undefined) => dispatch({ stored, baseline }) };
}
