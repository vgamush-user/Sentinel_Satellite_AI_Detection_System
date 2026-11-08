import type { Incident, Reading, StateSnapshot } from '@/lib/sentinel/types';
import type { BackendIncident } from './protocol';
import type { BackendData } from './reducer';

// The supplied Python API uses time.time() seconds; the existing UI uses epoch milliseconds.
const ms = (seconds: number | null | undefined) => seconds == null ? undefined : seconds * 1000;
export function normalizeIncident(raw: BackendIncident, rows: Reading[]): Incident {
  const related = rows.filter(row => row.incidentId === raw.incident_id);
  const first = ms(raw.opened_ts) ?? ms(raw.last_seen_ts) ?? 0;
  const state = (raw.report_status ?? '').toUpperCase();
  const status = ['FAILED', 'ERROR'].includes(state) ? 'failed'
    : ['PENDING', 'QUEUED', 'RUNNING', 'STARTED'].includes(state) ? 'pending' : 'unavailable';
  const reportStatus = status === 'unavailable' && (state || raw.report) ? 'ready' : status;
  return {
    id: raw.incident_id, cls: raw.attack_class ?? 'Unknown', lifecycle: raw.status === 'closed' ? 'closed' : 'open',
    firstSeen: first, lastSeen: ms(raw.last_seen_ts) ?? first, closedAt: ms(raw.closed_ts),
    readingIds: related.map(row => row.id), triggerReadingIds: raw.trigger_entry_ids ?? [],
    peakConfidence: raw.peak_confidence ?? 0, meanConfidence: raw.mean_confidence ?? undefined,
    rowCount: raw.row_count ?? undefined, groundTruth: raw.sample_true_class ?? undefined,
    closeReason: raw.close_reason ?? undefined, origin: related.some(row => row.source === 'threat-lab') ? 'threat-lab' : 'downlink',
    timeline: [
      ...(raw.opened_ts == null ? [] : [{ ts: raw.opened_ts * 1000, kind: 'opened' as const, label: 'Incident opened by the backend' }]),
      ...(raw.closed_ts == null ? [] : [{ ts: raw.closed_ts * 1000, kind: 'closed' as const, label: raw.close_reason ?? 'Incident closed by the backend' }]),
      ...(raw.report_started_ts == null ? [] : [{ ts: raw.report_started_ts * 1000, kind: 'report_pending' as const, label: 'Report generation started' }]),
      ...(raw.report_finished_ts == null ? [] : [{ ts: raw.report_finished_ts * 1000, kind: status === 'failed' ? 'report_failed' as const : 'report_ready' as const, label: 'Report generation finished' }]),
    ].sort((a, b) => a.ts - b.ts),
    report: { status: reportStatus, mode: raw.report_mode === 'cached' ? 'cached' : raw.report_mode === 'live' ? 'live' : undefined,
      requestedAt: ms(raw.report_started_ts), generatedAt: ms(raw.report_finished_ts),
      runtimeSec: raw.report_runtime_sec ?? undefined, body: raw.report ?? undefined,
      error: status === 'failed' ? raw.report ?? 'Backend reported a failed report.' : undefined },
    sparta: [], mitigations: [], spartaText: raw.sparta_context ?? undefined,
    mitigationText: raw.mitigation ?? undefined, raw,
  };
}
export function normalizeData(data: BackendData): StateSnapshot {
  const readingToIncident = new Map<string, string>();
  for (const incident of data.incidents)
    for (const id of incident.trigger_entry_ids ?? []) readingToIncident.set(id, incident.incident_id);
  const readings: Reading[] = data.recent.map((raw, index) => {
    const decision = data.decisions.get(raw.entry_id);
    return {
      id: raw.entry_id, seq: raw.seq ?? raw.ts * 1000 + index / 1000, ts: raw.ts * 1000,
      source: /panel|attack|inject/i.test(raw.source ?? '') ? 'threat-lab' : 'downlink',
      originalSource: raw.source ?? undefined, features: { ...raw.f, threat_score: raw.threat },
      predicted: raw.predicted_class, confidence: raw.confidence, threat: raw.threat,
      probabilities: raw.probabilities ?? undefined, groundTruth: raw.true_class ?? undefined,
      latencyMs: raw.latency_ms ?? undefined,
      incidentId: decision?.incident_id ?? readingToIncident.get(raw.entry_id),
      decision: decision ? `${decision.decision}: ${decision.detail}` : undefined,
      runId: raw.burst_id ?? undefined, raw,
    };
  });
  return {
    config: {
      features: [{ key: 'threat_score', label: 'Threat score', unit: '0–1', digits: 3 },
        ...data.config.features.map(key => ({ key, label: key, unit: null, digits: 3 }))],
      classes: data.config.classes, threshold: data.config.guards.min_confidence,
      consecutive: data.config.guards.min_rows, windowRows: data.config.guards.window_rows,
      closeAfter: data.config.guards.close_gap_rows ?? 0, bufferSize: 300,
      sourceName: 'SentinelSat backend', datasetName: data.stats.replay_dataset ?? 'Not supplied',
      mode: 'connected', agentMode: data.config.agent_mode,
    },
    readings, incidents: data.incidents.map(incident => normalizeIncident(incident, readings)), playback: null,
    stats: {
      totalReceived: data.stats.rows_total, ingestPerMin: data.stats.rows_per_sec * 60,
      rowsPerSec: data.stats.rows_per_sec, medianLatencyMs: data.stats.latency_p50_ms,
      droppedSamples: 0, accuracy: data.stats.accuracy, predictionCounts: data.stats.pred_counts,
      kafkaOk: data.stats.kafka_ok, lastRowAgeSec: data.stats.last_row_age_sec, eventCounts: data.stats.counts,
    },
  };
}
