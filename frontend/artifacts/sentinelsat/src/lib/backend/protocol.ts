import { z } from 'zod';

const num = z.number().finite();
const maybeNumber = num.nullish();
const maybeText = z.string().nullish();
const numericMap = z.record(z.string(), num);
export const rowSchema = z.object({
  entry_id: z.string(), ts: num, predicted_class: z.string(), confidence: num, threat: num,
  true_class: maybeText, source: maybeText, latency_ms: maybeNumber, seq: maybeNumber,
  burst_id: maybeText, f: z.record(z.string(), num.nullable()).nullish(),
  probabilities: numericMap.nullish(),
});
export const incidentSchema = z.object({
  incident_id: z.string(), attack_class: maybeText, status: maybeText, opened_ts: maybeNumber,
  last_seen_ts: maybeNumber, closed_ts: maybeNumber, row_count: maybeNumber, peak_confidence: maybeNumber,
  mean_confidence: maybeNumber, duration_sec: maybeNumber, close_reason: maybeText,
  trigger_entry_ids: z.array(z.string()).nullish(), sample_true_class: maybeText,
  report_status: maybeText, report_mode: maybeText, report_runtime_sec: maybeNumber,
  report_started_ts: maybeNumber, report_finished_ts: maybeNumber, report_predicted_class: maybeText,
  report_confidence: maybeNumber, report: maybeText, sparta_context: maybeText, mitigation: maybeText,
}).passthrough();
export const decisionSchema = z.object({
  event: z.literal('entry_decision'), entry_id: z.string(), incident_id: maybeText,
  decision: z.string(), detail: z.string(),
});
const incidentEvent = incidentSchema.extend({ event: z.enum(['opened', 'updated', 'closed']) });
const reportEvent = z.object({
  event: z.enum(['started', 'finished']), incident_id: z.string(), attack_class: z.string(),
  mode: z.string(), started_ts: maybeNumber, status: z.string().optional(), finished_ts: maybeNumber,
  runtime_sec: maybeNumber, predicted_class: maybeText, confidence: maybeNumber,
  report: maybeText, sparta_context: maybeText, mitigation: maybeText,
});
export const statsSchema = z.object({
  kafka_ok: z.boolean(), rows_total: num, rows_per_sec: num, accuracy: num.nullable(),
  replay_dataset: z.string().nullable(), latency_p50_ms: num.nullable(),
  last_row_age_sec: num.nullable(), counts: numericMap, pred_counts: numericMap,
});
export const configSchema = z.object({
  classes: z.array(z.string()), features: z.array(z.string()), agent_mode: z.string(),
  guards: z.object({ min_confidence: num, min_rows: num, window_rows: num, close_gap_rows: num.optional() }),
});
export const initialSchema = z.object({
  config: configSchema, recent: z.array(rowSchema), incidents: z.array(incidentSchema), stats: statsSchema,
});
export const batchSchema = z.object({
  telemetry: z.array(rowSchema).optional(),
  incidents: z.array(z.union([decisionSchema, incidentEvent])).optional(),
  reports: z.array(reportEvent).optional(), stats: statsSchema.optional(),
});
export const sampleSchema = z.object({
  features: numericMap, true_class: z.string(), quality: z.string(), dataset: z.string(),
});
// IngestRequest.count is capped at 50; AttackRequest.count separately allows 100.
export const customEntryCountSchema = z.number().int().min(1).max(50);
export const submissionSchema = z.object({ entry_ids: z.array(z.string()).min(1), count: num })
  .refine(v => Number.isInteger(v.count) && v.count === v.entry_ids.length, 'Submission count does not match entry IDs');
export const exampleSchema = z.object({
  classification: z.object({ predicted_class: z.string().optional(), confidence: z.union([num, z.string()]).optional() }).nullish(),
  status: z.string().optional(), report: maybeText, mitigation: maybeText, sparta_context: maybeText,
});
export const examplesSchema = z.record(z.string(), exampleSchema);
export const manualReplaySchema = z.object({
  dataset: z.enum(['noised', 'raw']), state: z.enum(['stopped', 'running', 'paused', 'finished']),
  total_rows: num, rows_emitted: num, elapsed: num, speed: num, order: z.string(), loop: z.boolean(),
  rows: z.array(z.record(z.string(), num.nullable())), monitor: z.boolean().nullable(), live_available: z.boolean(),
});
export const windowResultSchema = z.object({
  dataset: z.string(), row: num, message_id: num, monitor: z.boolean(), label: maybeText,
  prediction: z.string(), confidence: num, status: z.string(), action: z.string().optional(),
  guardrail: z.string().optional(), report: z.string().optional(), sparta: z.string().optional(), mitigation: z.string().optional(),
});
export const packetResultSchema = z.object({
  prediction_class: num, is_anomaly: z.boolean(), confidence_score: num, status: z.string(),
});
export type BackendRow = z.infer<typeof rowSchema>;
export type BackendIncident = z.infer<typeof incidentSchema>;
export type BackendDecision = z.infer<typeof decisionSchema>;
export type BackendInitial = z.infer<typeof initialSchema>;
export type BackendBatch = z.infer<typeof batchSchema>;
export type BackendSample = z.infer<typeof sampleSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export type ManualReplay = z.infer<typeof manualReplaySchema>;
export type WindowResult = z.infer<typeof windowResultSchema>;
export type PacketResult = z.infer<typeof packetResultSchema>;
export type ReplaySettings = {
  dataset: 'noised' | 'raw'; speed: number; order: 'sequential' | 'shuffled'; loop: boolean; buffer_size: number;
};
export type ManualAction = 'load' | 'configure' | 'start' | 'pause' | 'resume' | 'stop';
