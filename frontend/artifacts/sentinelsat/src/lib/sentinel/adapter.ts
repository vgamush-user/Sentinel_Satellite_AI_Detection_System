import { CONFIG, SAMPLE_INPUTS, SCENARIOS, SampleSource, classify, CLASS_INFO, cloneIncident, readingId, seqTs } from './sample-source';
import { CLASS_LABEL, fmtConf } from './format';
import { SAMPLE_STORAGE_KEY, LEGACY_SAMPLE_STORAGE_KEY, parseSamplePersistence } from './persistence';
import type {
  AdapterEvent,
  AnalysisRequest,
  AnalysisResponse,
  AttackAck,
  AttackRequest,
  Incident,
  Playback,
  Reading,
  ReplayAction,
  SampleInput,
  Scenario,
  StateSnapshot,
  Stats,
} from './types';

/**
 * The data interface every SentinelSat source implements. It mirrors the
 * backend contract (GET /api/state, /ws events, GET /api/incidents/:id,
 * GET /api/demo-scenarios, GET /api/sample, POST /api/attack,
 * /api/analysis/replay, POST /api/analysis/run). A connected adapter can be
 * dropped in without touching views.
 */
export interface SentinelAdapter {
  readonly mode: 'sample' | 'connected';
  readonly sourceLabel: string;
  getState(): Promise<StateSnapshot>;
  subscribe(cb: (e: AdapterEvent) => void): () => void;
  getIncident(id: string): Promise<Incident | null>;
  listScenarios(): Promise<Scenario[]>;
  getSamples(): Promise<SampleInput[]>;
  runAttack(req: AttackRequest): Promise<AttackAck>;
  replay(action: ReplayAction): Promise<Playback>;
  runAnalysis(req: AnalysisRequest): Promise<AnalysisResponse>;
  retryReport(id: string): Promise<void>;
  /** Demo control: simulate feed loss / recovery. */
  disconnect(): void;
  reconnect(): Promise<void>;
  reset(): void;
  getRuns(): AttackAck[];
  getEvidence?(): Reading[];
}

const START_SEQ = 278;

interface Persisted {
  cursor: number;
  playing: boolean;
  speed: 1 | 2 | 5;
  overrides: SampleSource['overrides'];
  retries: Record<string, number>;
  runs: AttackAck[];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SampleAdapter implements SentinelAdapter {
  readonly mode = 'sample' as const;
  readonly sourceLabel = 'Sample demo';
  private src = new SampleSource();
  private listeners = new Set<(e: AdapterEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = true;
  private speed: 1 | 2 | 5 = 1;
  private connected = true;
  private runs: AttackAck[] = [];
  private analysisCount = 0;
  private generation = 0;
  private sessionId: string = crypto.randomUUID();
  private recoveryNotice: string | undefined;

  constructor() {
    this.load();
  }

  private load(reset = false) {
    let p: Persisted | null = null;
    this.recoveryNotice = undefined;
    try {
      if (!reset) {
        const current = localStorage.getItem(SAMPLE_STORAGE_KEY);
        const raw = current ?? localStorage.getItem(LEGACY_SAMPLE_STORAGE_KEY);
        if (raw) {
          const saved = parseSamplePersistence(raw, current == null);
          p = saved.payload;
          this.sessionId = saved.sessionId;
        }
      } else this.sessionId = crypto.randomUUID();
    } catch {
      p = null;
      this.recoveryNotice = 'Saved sample data could not be restored safely. A fresh sample session was started; the legacy saved data was not deleted.';
    }
    this.src = new SampleSource();
    this.src.overrides = p?.overrides ?? {};
    this.runs = p?.runs ?? [];
    this.playing = p?.playing ?? true;
    this.speed = p?.speed ?? 1;
    const retries = p?.retries ?? {};
    // rebuild deterministically, applying retries at the recorded cursor
    const target = p?.cursor ?? START_SEQ;
    const retryAt = Object.entries(retries).sort((a, b) => a[1] - b[1]);
    for (const [id, at] of retryAt) {
      this.src.advanceTo(at);
      this.src.retryReport(id);
    }
    this.src.advanceTo(target);
    this.src.takeChanges();
    this.save();
  }

  private save() {
    const p: Persisted = {
      cursor: this.src.cursor,
      playing: this.playing,
      speed: this.speed,
      overrides: this.src.overrides,
      retries: this.src.retries,
      runs: this.runs,
    };
    try {
      localStorage.setItem(SAMPLE_STORAGE_KEY, JSON.stringify({ version: 2, sessionId: this.sessionId, payload: p }));
    } catch {
      /* storage unavailable: session-only demo */
    }
  }

  private emit(e: AdapterEvent) {
    if (!this.connected && e.type !== 'connection') return;
    this.listeners.forEach((l) => l(e));
  }

  private playback(): Playback {
    return { playing: this.playing, speed: this.speed, cursorSeq: this.src.cursor, cursorTs: seqTs(this.src.cursor) };
  }

  private stats(): Stats {
    const rs = this.src.readings;
    const last = rs[rs.length - 1];
    let ingest: number | null = null;
    if (last && rs.length > 10) {
      const from = last.ts - 60_000;
      let n = 0;
      for (let i = rs.length - 1; i >= 0 && rs[i].ts > from; i--) n++;
      ingest = n;
    }
    const lats: number[] = [];
    for (let i = rs.length - 1; i >= 0 && lats.length < 60; i--) {
      const l = rs[i].latencyMs;
      if (l != null) lats.push(l);
    }
    lats.sort((a, b) => a - b);
    const med = lats.length ? (lats.length % 2 ? lats[(lats.length - 1) / 2] : (lats[lats.length / 2 - 1] + lats[lats.length / 2]) / 2) : null;
    return { totalReceived: rs.length, ingestPerMin: ingest, medianLatencyMs: med, droppedSamples: this.src.dropped };
  }

  private snapshot(): StateSnapshot {
    const rs = this.src.readings.slice(-CONFIG.bufferSize);
    return {
      config: { ...CONFIG, sampleSessionId: this.sessionId, recoveryNotice: this.recoveryNotice },
      readings: rs.map((r) => ({ ...r, features: { ...r.features } })),
      incidents: this.src.incidents.map(cloneIncident),
      stats: this.stats(),
      playback: this.playback(),
    };
  }

  private flush() {
    const ch = this.src.takeChanges();
    if (ch.readings.length) this.emit({ type: 'readings', readings: ch.readings });
    if (ch.incidents.length) this.emit({ type: 'incidents', incidents: ch.incidents });
    this.emit({ type: 'stats', stats: this.stats() });
    this.emit({ type: 'playback', playback: this.playback() });
  }

  private tick = () => {
    this.src.advanceTo(this.src.cursor + 1);
    // server keeps producing while the client is disconnected; changes are
    // only delivered on resync
    if (this.connected) this.flush();
    this.save();
  };

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.playing) this.timer = setInterval(this.tick, 1000 / this.speed);
  }

  async getState() {
    await wait(350);
    return this.snapshot();
  }

  subscribe(cb: (e: AdapterEvent) => void) {
    this.listeners.add(cb);
    if (this.listeners.size === 1) this.schedule();
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async getIncident(id: string) {
    const i = this.src.incidents.find((x) => x.id === id);
    return i ? cloneIncident(i) : null;
  }

  async listScenarios() {
    await wait(200);
    return SCENARIOS;
  }

  async getSamples() {
    return SAMPLE_INPUTS;
  }

  getRuns() {
    return this.runs;
  }
  getEvidence() {
    const ids = new Set(this.runs.flatMap(run => run.readingIds));
    return this.src.readings.filter(row => ids.has(row.id)).slice(-1000);
  }

  async runAttack(req: AttackRequest): Promise<AttackAck> {
    const generation = this.generation;
    await wait(650);
    if (generation !== this.generation) throw new Error('The sample session was reset. This simulation was not submitted.');
    if (!this.connected) throw new Error('Feed disconnected. The simulation request was not submitted.');
    const sc = SCENARIOS.find((s) => s.id === req.scenarioId);
    if (!sc) throw new Error(`Unknown scenario ${req.scenarioId}.`);
    const count = Math.round(req.count);
    if (!(count >= sc.limits.count[0] && count <= sc.limits.count[1])) throw new Error('Reading count is outside the supported range.');
    if (!(req.intensity >= sc.limits.intensity[0] && req.intensity <= sc.limits.intensity[1])) throw new Error('Intensity is outside the supported range.');
    const runId = `SIM-${String(2041 + this.runs.length).padStart(4, '0')}`;
    let from = this.src.cursor + 3;
    // never overlap an existing injection
    while (this.src.overrides[from]) from++;
    const ids: string[] = [];
    for (let k = 0; k < count; k++) {
      this.src.overrides[from + k] = { runId, cls: sc.cls, intensity: req.intensity };
      ids.push(readingId(from + k));
    }
    const ack: AttackAck = {
      runId,
      scenarioId: sc.id,
      acceptedAt: seqTs(this.src.cursor),
      scheduledFromSeq: from,
      scheduledToSeq: from + count - 1,
      readingIds: ids,
      request: { ...req, count },
    };
    this.runs = [ack, ...this.runs];
    this.save();
    this.emit({ type: 'runs', runs: this.runs });
    return ack;
  }

  async replay(a: ReplayAction) {
    if (!this.connected) throw new Error('Feed disconnected');
    if (a.action === 'play') this.playing = true;
    if (a.action === 'pause') this.playing = false;
    if (a.action === 'speed') this.speed = a.speed;
    if (a.action === 'step') {
      this.src.advanceTo(this.src.cursor + a.count);
      this.flush();
    }
    this.schedule();
    this.save();
    const pb = this.playback();
    this.emit({ type: 'playback', playback: pb });
    return pb;
  }

  async retryReport(id: string) {
    await wait(300);
    if (!this.connected) throw new Error('Feed disconnected');
    this.src.retryReport(id);
    this.save();
    this.flush();
  }

  async runAnalysis(req: AnalysisRequest): Promise<AnalysisResponse> {
    const generation = this.generation;
    await wait(700);
    if (generation !== this.generation) throw new Error('The sample session was reset. Run analysis again to use the new session.');
    if (!this.connected) throw new Error('Analysis service unreachable: feed disconnected. Your inputs are unchanged.');
    for (const [k, v] of Object.entries(req.features)) {
      if (!Number.isFinite(v)) throw new Error(`Feature ${k} must be a finite number.`);
    }
    const c = classify(req.features);
    this.analysisCount++;
    const isAttack = c.predicted !== 'nominal';
    const would = isAttack && c.confidence >= CONFIG.threshold;
    const info = isAttack ? CLASS_INFO[c.predicted as keyof typeof CLASS_INFO] : null;
    return {
      analysisId: `AN-${Date.now().toString(36).slice(-5).toUpperCase()}${this.analysisCount}`,
      status: 'ok',
      completedAt: Date.now(),
      predicted: c.predicted,
      confidence: c.confidence,
      probabilities: c.probabilities,
      wouldEscalate: would,
      notes: [
        ...c.notes,
        would
          ? `Above the ${CONFIG.threshold.toFixed(2)} threshold; in the stream this reading would count toward the ${CONFIG.consecutive}-reading incident rule.`
          : isAttack
            ? `${CLASS_LABEL[c.predicted]} at ${fmtConf(c.confidence)} is below the ${CONFIG.threshold.toFixed(2)} threshold and would be logged only.`
            : 'No escalation: nominal classification.',
      ],
      sparta: info?.sparta ?? [],
      mitigations: info?.mitigations ?? [],
      report: isAttack
        ? `## Single-reading assessment\nThe submitted reading is most consistent with ${CLASS_LABEL[c.predicted].toLowerCase()} (${fmtConf(c.confidence)}). A single reading cannot open an incident; the stream detector requires ${CONFIG.consecutive} consecutive readings at or above ${CONFIG.threshold.toFixed(2)}.\n\n> Advisory: manual analysis does not write to the incident store.`
        : null,
    };
  }

  disconnect() {
    this.connected = false;
    this.listeners.forEach((l) => l({ type: 'connection', state: 'disconnected' }));
  }

  async reconnect() {
    const generation = this.generation;
    this.listeners.forEach((l) => l({ type: 'connection', state: 'reconnecting' }));
    await wait(900);
    if (generation !== this.generation) return;
    this.connected = true;
    this.src.takeChanges();
    this.emit({ type: 'resync', snapshot: this.snapshot() });
    this.emit({ type: 'connection', state: 'connected' });
    this.emit({ type: 'runs', runs: this.runs });
  }

  reset() {
    this.generation++;
    this.load(true);
    this.connected = true;
    this.schedule();
    this.emit({ type: 'reset', snapshot: this.snapshot() });
  }
}

/**
 * Source selection. VITE_SENTINEL_SOURCE=sample (default) starts the labeled
 * sample demo. A connected adapter is not bundled in this build; any other
 * value is rejected by the app instead of substituting sample data.
 */
export const SOURCE_SETTING = (import.meta.env?.VITE_SENTINEL_SOURCE as string | undefined) ?? 'sample';
export const SOURCE_FALLBACK = SOURCE_SETTING !== 'sample';

export function createAdapter(): SentinelAdapter {
  if (SOURCE_FALLBACK) throw new Error('Unsupported telemetry source: a connected adapter is not installed.');
  return new SampleAdapter();
}
