export type Row = {
  entry_id: string; ts: number; predicted_class: string; confidence: number; threat: number;
  true_class?: string | null; source?: string | null; latency_ms?: number | null;
  seq?: number | null; burst_id?: string | null; f?: Record<string, number | null>;
  probabilities?: Record<string, number> | null;
};
export type Incident = {
  incident_id: string; attack_class?: string | null; status?: string | null; opened_ts?: number | null; last_seen_ts?: number | null;
  closed_ts?: number | null; row_count?: number | null; peak_confidence?: number | null; mean_confidence?: number | null;
  duration_sec?: number | null; close_reason?: string | null; trigger_entry_ids?: string[] | null;
  sample_true_class?: string | null; report_status?: string | null; report_mode?: string | null;
  report_runtime_sec?: number | null; report_started_ts?: number | null; report_finished_ts?: number | null; report_predicted_class?: string | null;
  report_confidence?: number | null; report?: string | null; sparta_context?: string | null;
  mitigation?: string | null;
};
export type Decision = { event: "entry_decision"; entry_id: string; incident_id?: string | null; decision: string; detail: string };
type IncidentEvent = Decision | (Incident & { event: "opened" | "updated" | "closed" });
type ReportEvent = { incident_id: string; attack_class: string; mode: string; started_ts?: number } & (
  { event: "started" } | { event: "finished"; status: string; finished_ts?: number; runtime_sec?: number | null;
    predicted_class?: string | null; confidence?: number | null; report?: string | null;
    sparta_context?: string | null; mitigation?: string | null });
export type Stats = {
  kafka_ok: boolean; rows_total: number; rows_per_sec: number; accuracy: number | null;
  replay_dataset: string | null; latency_p50_ms: number | null; last_row_age_sec: number | null;
  counts: Record<string, number>; pred_counts: Record<string, number>;
};
export type Config = { classes: string[]; features: string[]; agent_mode: string;
  guards: { min_confidence: number; min_rows: number; window_rows: number; close_gap_rows?: number } };
export type Batch = { telemetry?: Row[]; incidents?: IncidentEvent[]; reports?: ReportEvent[]; stats?: Stats };
export type Initial = { config: Config; recent: Row[]; incidents: Incident[]; stats: Stats };
export type Sample = { features: Record<string, number>; true_class: string; quality: string; dataset: string };
export type Example = { classification?: { predicted_class?: string; confidence?: number | string } | null;
  status?: string; report?: string | null; mitigation?: string | null; sparta_context?: string | null };

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const string = (v: unknown): v is string => typeof v === "string";
const array = <T>(v: unknown, test: (item: unknown) => item is T): v is T[] => Array.isArray(v) && v.every(test);
const optional = (v: unknown, test: (item: unknown) => boolean) => v == null || test(v);
const numbers = (v: unknown): v is Record<string, number> => object(v) && Object.values(v).every(number);
const texts = (v: Record<string, unknown>, keys: string[]) => keys.every(key => optional(v[key], string));
const quantities = (v: Record<string, unknown>, keys: string[]) => keys.every(key => optional(v[key], number));
const row = (v: unknown): v is Row => object(v) && string(v.entry_id) && string(v.predicted_class)
  && [v.ts, v.confidence, v.threat].every(number) && texts(v, ["true_class", "source", "burst_id"]) && quantities(v, ["latency_ms", "seq"])
  && optional(v.f, features => object(features) && Object.values(features).every(value => value === null || number(value)))
  && optional(v.probabilities, numbers);
export const incident = (v: unknown): v is Incident => object(v) && string(v.incident_id)
  && texts(v, ["attack_class", "status", "close_reason", "sample_true_class", "report_status", "report_mode",
    "report_predicted_class", "report", "sparta_context", "mitigation"])
  && quantities(v, ["opened_ts", "last_seen_ts", "closed_ts", "report_started_ts", "report_finished_ts", "row_count", "peak_confidence", "mean_confidence", "duration_sec",
    "report_runtime_sec", "report_confidence"]) && optional(v.trigger_entry_ids, ids => array(ids, string));
const incidentEvent = (v: unknown): v is IncidentEvent => object(v) && (
  v.event === "entry_decision" ? string(v.entry_id) && string(v.decision) && string(v.detail) && optional(v.incident_id, string)
  : (v.event === "opened" || v.event === "updated" || v.event === "closed") && incident(v));
const reportEvent = (v: unknown): v is ReportEvent => object(v) && string(v.incident_id)
  && string(v.attack_class) && string(v.mode) && optional(v.started_ts, number) && (v.event === "started" || (v.event === "finished"
    && string(v.status) && texts(v, ["predicted_class", "report", "sparta_context", "mitigation"])
    && quantities(v, ["runtime_sec", "confidence", "finished_ts"])));
const stats = (v: unknown): v is Stats => object(v) && typeof v.kafka_ok === "boolean"
  && number(v.rows_total) && number(v.rows_per_sec) && numbers(v.counts) && numbers(v.pred_counts)
  && (v.replay_dataset === null || string(v.replay_dataset))
  && [v.accuracy, v.latency_p50_ms, v.last_row_age_sec].every(value => value === null || number(value));
const config = (v: unknown): v is Config => object(v) && array(v.classes, string) && array(v.features, string)
  && string(v.agent_mode) && object(v.guards) && [v.guards.min_confidence, v.guards.min_rows, v.guards.window_rows].every(number)
  && optional(v.guards.close_gap_rows, number);
export const initial = (v: unknown): v is Initial => object(v) && config(v.config) && stats(v.stats)
  && array(v.recent, row) && array(v.incidents, incident);
export const batch = (v: unknown): v is Batch => object(v)
  && (v.telemetry === undefined || array(v.telemetry, row)) && (v.incidents === undefined || array(v.incidents, incidentEvent))
  && (v.reports === undefined || array(v.reports, reportEvent)) && (v.stats === undefined || stats(v.stats));
export const sample = (v: unknown): v is Sample => object(v) && numbers(v.features) && string(v.true_class) && string(v.quality) && string(v.dataset);
export const submission = (v: unknown): v is { entry_ids: string[]; count: number } =>
  object(v) && array(v.entry_ids, string) && v.entry_ids.length > 0 && v.count === v.entry_ids.length;
const example = (v: unknown): v is Example => object(v) && texts(v, ["status", "report", "mitigation", "sparta_context"])
  && optional(v.classification, c => object(c) && optional(c.predicted_class, string)
    && optional(c.confidence, confidence => number(confidence) || string(confidence)));
export const examples = (v: unknown): v is Record<string, Example> => object(v) && Object.values(v).every(example);

export async function request<T>(url: string, validate: (v: unknown) => v is T, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(object(value) && string(value.detail) ? value.detail : response.statusText);
  if (!validate(value)) throw new Error("Unexpected server response");
  return value;
}
