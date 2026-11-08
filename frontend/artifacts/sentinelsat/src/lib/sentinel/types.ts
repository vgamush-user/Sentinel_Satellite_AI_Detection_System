export type AttackClass = 'jamming' | 'spoofing' | 'command_injection' | (string & {});
export type ClassLabel = 'nominal' | AttackClass;
export type ReadingSource = 'downlink' | 'threat-lab';

export interface FeatureDef {
  key: string;
  label: string;
  /** null = the source does not supply a unit */
  unit: string | null;
  digits: number;
}

export interface Reading {
  id: string;
  seq: number;
  /** epoch milliseconds, UTC */
  ts: number;
  source: ReadingSource;
  features: Record<string, number | null>;
  predicted: ClassLabel;
  /** 0..1 */
  confidence: number;
  probabilities?: Record<ClassLabel, number>;
  groundTruth?: ClassLabel;
  latencyMs?: number;
  incidentId?: string;
  /** entry-decision event: why the reading was / was not associated */
  decision?: string;
  runId?: string;
  threat?: number;
  originalSource?: string;
  raw?: unknown;
}

export type Lifecycle = 'open' | 'closed';
export type ReportStatus = 'unavailable' | 'pending' | 'ready' | 'failed';

export interface IncidentEvent {
  ts: number;
  kind: 'opened' | 'trigger' | 'peak' | 'closed' | 'report_pending' | 'report_ready' | 'report_failed' | 'report_retry';
  label: string;
  readingId?: string;
}

export interface IncidentReport {
  status: ReportStatus;
  mode?: 'template' | 'cached' | 'live';
  requestedAt?: number;
  generatedAt?: number;
  error?: string;
  body?: string;
  runtimeSec?: number;
}

export interface SpartaRef {
  id: string;
  tactic: string;
  technique: string;
  rationale: string;
}

export interface Incident {
  id: string;
  cls: AttackClass;
  lifecycle: Lifecycle;
  firstSeen: number;
  lastSeen: number;
  closedAt?: number;
  readingIds: string[];
  triggerReadingIds: string[];
  peakConfidence: number;
  origin: ReadingSource;
  runId?: string;
  timeline: IncidentEvent[];
  report: IncidentReport;
  sparta: SpartaRef[];
  mitigations: string[];
  rowCount?: number;
  meanConfidence?: number;
  groundTruth?: string;
  closeReason?: string;
  spartaText?: string;
  mitigationText?: string;
  raw?: unknown;
}

export interface Playback {
  playing: boolean;
  speed: 1 | 2 | 5;
  cursorSeq: number;
  cursorTs: number;
}

export interface Stats {
  /** cumulative, whole stream since replay start */
  totalReceived: number;
  /** current, readings per minute over the latest 60 s of sample time; null when < 10 s of data */
  ingestPerMin: number | null;
  /** current, over the latest 60 readings that carry latency */
  medianLatencyMs: number | null;
  droppedSamples: number;
  rowsPerSec?: number;
  accuracy?: number | null;
  predictionCounts?: Record<string, number>;
  kafkaOk?: boolean;
  lastRowAgeSec?: number | null;
  eventCounts?: Record<string, number>;
}

export interface SourceConfig {
  features: FeatureDef[];
  classes: ClassLabel[];
  threshold: number;
  consecutive: number;
  closeAfter: number;
  bufferSize: number;
  sourceName: string;
  datasetName: string;
  mode?: 'sample' | 'connected';
  agentMode?: string;
  windowRows?: number;
}

export interface StateSnapshot {
  config: SourceConfig;
  readings: Reading[];
  incidents: Incident[];
  stats: Stats;
  playback: Playback | null;
}

export interface Scenario {
  id: string;
  name: string;
  cls: AttackClass;
  demonstrates: string;
  expected: string;
  defaults: { count: number; intensity: number };
  limits: { count: [number, number]; intensity: [number, number] };
}

export interface AttackRequest {
  scenarioId: string;
  count: number;
  intensity: number;
}

export interface AttackAck {
  runId: string;
  scenarioId: string;
  acceptedAt: number;
  /** sample timestamp of the first scheduled injection */
  scheduledFromSeq: number;
  scheduledToSeq: number;
  readingIds: string[];
  request: AttackRequest;
}

export interface SampleInput {
  id: string;
  label: string;
  readingId: string;
  features: Record<string, number | null>;
  groundTruth: ClassLabel;
}

export interface AnalysisRequest {
  features: Record<string, number>;
  sampleId?: string;
}

export interface AnalysisResponse {
  analysisId: string;
  status: 'ok';
  completedAt: number;
  predicted: ClassLabel;
  confidence: number;
  probabilities: Record<ClassLabel, number>;
  wouldEscalate: boolean;
  notes: string[];
  sparta: SpartaRef[];
  mitigations: string[];
  report: string | null;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export type AdapterEvent =
  | { type: 'readings'; readings: Reading[] }
  | { type: 'incidents'; incidents: Incident[] }
  | { type: 'stats'; stats: Stats }
  | { type: 'playback'; playback: Playback }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'resync'; snapshot: StateSnapshot }
  | { type: 'runs'; runs: AttackAck[] };

export type ReplayAction = { action: 'play' } | { action: 'pause' } | { action: 'step'; count: number } | { action: 'speed'; speed: 1 | 2 | 5 };
