import type { BackendBatch, BackendDecision, BackendIncident, BackendInitial, BackendRow } from './protocol';

export interface BackendData extends Omit<BackendInitial, 'incidents'> {
  incidents: BackendIncident[];
  decisions: Map<string, BackendDecision>;
}
export const incidentVersion = (v: BackendIncident) => v.closed_ts ?? v.last_seen_ts ?? v.opened_ts ?? 0;
export const reportVersion = (v: BackendIncident) => Math.max(v.report_started_ts ?? 0, v.report_finished_ts ?? 0);
const REPORT_FIELDS = ['report_status', 'report_mode', 'report', 'report_started_ts', 'report_finished_ts',
  'report_runtime_sec', 'report_predicted_class', 'report_confidence', 'sparta_context', 'mitigation'] as const;

export function mergeIncident(current: BackendIncident | undefined, incoming: BackendIncident): BackendIncident {
  if (!current) return incoming;
  const keepCurrent = incidentVersion(current) > incidentVersion(incoming) ||
    (current.status === 'closed' && incoming.status === 'open');
  const merged = keepCurrent ? { ...incoming, ...current } : { ...current, ...incoming };
  const report = reportVersion(current) > reportVersion(incoming) ? current : incoming;
  for (const key of REPORT_FIELDS) {
    if (key in report) Object.assign(merged, { [key]: report[key] });
  }
  return merged;
}

export function mergeStored(current: BackendIncident | undefined, stored: BackendIncident, baseline: BackendIncident | undefined) {
  const changedDuringFetch = Object.fromEntries(
    Object.entries(current ?? {}).filter(([key, value]) => value !== baseline?.[key]),
  );
  return mergeIncident(current, { ...baseline, ...stored, ...changedDuringFetch });
}

export function appendRows(previous: BackendRow[], incoming: BackendRow[]) {
  return [...new Map([...previous, ...incoming].map(row => [row.entry_id, row])).values()]
    .sort((a, b) => (a.seq ?? a.ts) - (b.seq ?? b.ts)).slice(-300);
}

export function applyBatch(state: BackendData, update: BackendBatch): BackendData {
  const incidents = new Map(state.incidents.map(i => [i.incident_id, i]));
  const decisions = new Map(state.decisions);
  for (const event of update.incidents ?? []) {
    if (event.event === 'entry_decision') {
      decisions.set(event.entry_id, event);
    } else {
      const { event: kind, ...fields } = event;
      const prev = incidents.get(fields.incident_id);
      const next = { ...fields, status: kind === 'closed' ? 'closed' : kind === 'opened' ? 'open' : fields.status ?? prev?.status };
      incidents.set(fields.incident_id, mergeIncident(prev, next));
    }
  }
  while (decisions.size > 1000) decisions.delete(decisions.keys().next().value!);
  for (const event of update.reports ?? []) {
    const prev = incidents.get(event.incident_id) ?? { incident_id: event.incident_id };
    const version = (event.event === 'finished' ? event.finished_ts : event.started_ts) ?? 0;
    if (version && reportVersion(prev) > version) continue;
    const next: BackendIncident = event.event === 'started'
      ? { ...prev, report_status: 'RUNNING', report_mode: event.mode, report_started_ts: event.started_ts }
      : { ...prev, report_status: event.status, report_mode: event.mode, report_started_ts: event.started_ts,
          report_finished_ts: event.finished_ts, report_runtime_sec: event.runtime_sec,
          report_predicted_class: event.predicted_class, report_confidence: event.confidence,
          report: event.report, sparta_context: event.sparta_context, mitigation: event.mitigation };
    incidents.set(event.incident_id, next);
  }
  return { ...state,
    incidents: update.incidents?.some(event => event.event !== 'entry_decision') || update.reports?.length ? [...incidents.values()] : state.incidents,
    decisions: update.incidents?.some(event => event.event === 'entry_decision') ? decisions : state.decisions,
    recent: update.telemetry?.length ? appendRows(state.recent, update.telemetry) : state.recent,
    stats: update.stats && update.stats.rows_total >= state.stats.rows_total ? update.stats : state.stats };
}

export function hydrate(current: BackendData | null, snapshot: BackendInitial, buffered: BackendBatch[]): BackendData {
  const incidents = new Map(current?.incidents.map(i => [i.incident_id, i]));
  for (const next of snapshot.incidents) incidents.set(next.incident_id, mergeIncident(incidents.get(next.incident_id), next));
  let state: BackendData = { ...snapshot, incidents: [...incidents.values()], decisions: current?.decisions ?? new Map(),
    recent: appendRows(current?.recent ?? [], snapshot.recent) };
  for (const frame of buffered) {
    const delta = frame.stats ? frame.stats.rows_total - snapshot.stats.rows_total : undefined;
    state = applyBatch(state, { ...frame, telemetry: delta === undefined ? frame.telemetry : delta > 0 ? frame.telemetry?.slice(-delta) : undefined });
  }
  return state;
}
