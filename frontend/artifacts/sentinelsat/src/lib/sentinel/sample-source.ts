/**
 * Deterministic in-browser sample source for the SentinelSat demo.
 * Every reading is a pure function of its sequence number (plus any Threat Lab
 * injection scheduled at that sequence), so replays rebuild identical IDs,
 * timestamps, values, incidents and reports.
 */
import { CLASS_LABEL, fmtConf, fmtTime } from './format';
import type {
  AttackClass,
  ClassLabel,
  FeatureDef,
  Incident,
  Reading,
  SampleInput,
  Scenario,
  SourceConfig,
  SpartaRef,
} from './types';

export const SAMPLE_T0 = Date.UTC(2025, 2, 18, 14, 0, 0);
export const seqTs = (seq: number) => SAMPLE_T0 + seq * 1000;
export const readingId = (seq: number) => `rd-${String(seq).padStart(6, '0')}`;

export const FEATURES: FeatureDef[] = [
  { key: 'rf_snr', label: 'Downlink SNR', unit: 'dB', digits: 2 },
  { key: 'bus_voltage', label: 'Bus voltage', unit: 'V', digits: 3 },
  { key: 'battery_temp', label: 'Battery temperature', unit: '°C', digits: 2 },
  { key: 'gyro_rate', label: 'Gyro rate', unit: 'deg/s', digits: 4 },
  { key: 'cmd_rate', label: 'Command rate', unit: null, digits: 1 },
];

export const CONFIG: SourceConfig = {
  features: FEATURES,
  classes: ['nominal', 'jamming', 'spoofing', 'command_injection'],
  threshold: 0.7,
  consecutive: 3,
  closeAfter: 20,
  bufferSize: 900,
  sourceName: 'SENTINEL-3 bus downlink',
  datasetName: 'Labeled sample · sentinelsat-demo-v1',
};
const REPORT_DELAY = 15;

export const SCENARIOS: Scenario[] = [
  {
    id: 'spoof-burst',
    name: 'Attitude spoofing burst',
    cls: 'spoofing',
    demonstrates: 'Forged attitude telemetry pushes the gyro rate far outside its nominal band for several consecutive frames.',
    expected: 'At 3 or more readings above 0.70 confidence the detector opens a Spoofing incident.',
    defaults: { count: 5, intensity: 0.9 },
    limits: { count: [1, 12], intensity: [0.5, 0.99] },
  },
  {
    id: 'jam-probe',
    name: 'Low-power jamming probe',
    cls: 'jamming',
    demonstrates: 'A brief interference probe degrades downlink SNR for only two frames.',
    expected: 'Readings are classified as Jamming but the streak stays below the 3-reading rule, so no incident opens.',
    defaults: { count: 2, intensity: 0.76 },
    limits: { count: [1, 12], intensity: [0.5, 0.99] },
  },
  {
    id: 'cmd-replay',
    name: 'Command replay',
    cls: 'command_injection',
    demonstrates: 'A captured uplink sequence is replayed, spiking the command rate.',
    expected: 'A Command injection incident opens once the third consecutive reading arrives.',
    defaults: { count: 4, intensity: 0.92 },
    limits: { count: [1, 12], intensity: [0.5, 0.99] },
  },
];

export const CLASS_INFO: Record<AttackClass, { sparta: SpartaRef[]; mitigations: string[] }> = {
  jamming: {
    sparta: [
      { id: 'EX-0016', tactic: 'Execution', technique: 'Jamming', rationale: 'Sustained SNR collapse on the primary downlink with bus parameters otherwise nominal.' },
      { id: 'DE-0002', tactic: 'Defense Evasion', technique: 'Disrupt or Deceive Downlink', rationale: 'Loss of link margin can mask concurrent telemetry manipulation.' },
    ],
    mitigations: [
      'Compare ground-station SNR against a second station on the same pass to rule out local RF faults.',
      'Review whether the spacecraft switched to the redundant transponder during the window.',
      'Confirm that no commands were accepted while link margin was degraded.',
    ],
  },
  spoofing: {
    sparta: [
      { id: 'EX-0014', tactic: 'Execution', technique: 'Spoofing', rationale: 'Attitude rates inconsistent with reaction-wheel telemetry and the commanded profile.' },
      { id: 'DE-0003', tactic: 'Defense Evasion', technique: 'On-Board Values Obfuscation', rationale: 'Reported values diverge from physically plausible rates.' },
    ],
    mitigations: [
      'Cross-check gyro rate with star-tracker quaternions for the same frames.',
      'Review frame authentication counters for gaps or reuse.',
      'Hold attitude-dependent commanding until values are reconciled.',
    ],
  },
  command_injection: {
    sparta: [
      { id: 'EX-0001', tactic: 'Execution', technique: 'Replay', rationale: 'Command rate several times the scheduled plan with repeated opcode patterns.' },
      { id: 'IA-0008', tactic: 'Initial Access', technique: 'Rogue External Entity', rationale: 'Uplink activity outside any scheduled contact window.' },
    ],
    mitigations: [
      'Pull the command log for the window and diff it against the approved command plan.',
      'Verify anti-replay counters on the command receiver.',
      'Review whether any accepted command changed spacecraft configuration.',
    ],
  },
};

function hash(seq: number, salt: number) {
  let x = Math.imul(seq + 1, 374761393) ^ Math.imul(salt + 7, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const noise = (seq: number, salt: number) => hash(seq, salt) * 2 - 1;
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function classify(f: Record<string, number | null>) {
  const notes: string[] = [];
  const s = (key: string, fn: (v: number) => number) => {
    const v = f[key];
    if (v == null || !Number.isFinite(v)) {
      notes.push(`${key} missing; treated as uninformative.`);
      return 0;
    }
    return fn(v);
  };
  const sj = s('rf_snr', (v) => sig((10 - v) / 1.2));
  const ss = s('gyro_rate', (v) => sig((v - 0.18) / 0.04));
  const sc = s('cmd_rate', (v) => sig((v - 16) / 3));
  const sn = Math.max(0.01, (1 - sj) * (1 - ss) * (1 - sc));
  const sum = sj + ss + sc + sn;
  const probabilities: Record<ClassLabel, number> = {
    nominal: sn / sum,
    jamming: sj / sum,
    spoofing: ss / sum,
    command_injection: sc / sum,
  };
  let predicted: ClassLabel = 'nominal';
  for (const k of Object.keys(probabilities) as ClassLabel[]) {
    if (probabilities[k] > probabilities[predicted]) predicted = k;
  }
  return { predicted, confidence: probabilities[predicted], probabilities, notes };
}

interface Script {
  cls: AttackClass;
  s: number;
  truth?: ClassLabel;
}

function scripted(seq: number): Script | null {
  if (seq >= 70 && seq <= 81) return { cls: 'command_injection', s: 0.8 + 0.14 * hash(seq, 9) };
  if (seq === 205) return { cls: 'spoofing', s: 0.6, truth: 'nominal' };
  if (seq >= 240 && seq <= 262) return { cls: 'jamming', s: 0.86 + 0.12 * hash(seq, 9) };
  if (seq === 410) return { cls: 'spoofing', s: 0.67 };
  if (seq === 520 || seq === 521) return { cls: 'jamming', s: 0.77 };
  if (seq > 600 && seq % 173 === 0) return { cls: 'spoofing', s: 0.55 + 0.1 * hash(seq, 4) };
  return null;
}

function isDropped(seq: number) {
  return (seq >= 150 && seq <= 157) || (seq > 600 && seq % 409 <= 4);
}

export interface Override {
  runId: string;
  cls: AttackClass;
  intensity: number;
}

function applyAttack(f: Record<string, number | null>, cls: AttackClass, s: number, seq: number) {
  const j = 0.02 * noise(seq, 31);
  if (cls === 'jamming') {
    f.rf_snr = round(10 - 1.2 * logit(Math.min(0.995, s + j)), 2);
    f.bus_voltage = round((f.bus_voltage ?? 28) - 0.06, 3);
  } else if (cls === 'spoofing') {
    f.gyro_rate = round(0.18 + 0.04 * logit(Math.min(0.995, s + j)), 4);
  } else {
    f.cmd_rate = round(16 + 3 * logit(Math.min(0.995, s + j)), 1);
  }
}

export function baseFeatures(seq: number): Record<string, number | null> {
  return {
    rf_snr: round(14.2 + 0.4 * Math.sin(seq / 25) + 0.3 * noise(seq, 1), 2),
    bus_voltage: round(28.12 + 0.18 * Math.sin(seq / 40) + 0.04 * noise(seq, 2), 3),
    battery_temp: round(18.4 + 1.2 * Math.sin(seq / 300) + 0.08 * noise(seq, 3), 2),
    gyro_rate: round(0.021 + 0.006 * noise(seq, 5), 4),
    cmd_rate: round(4 + 1.5 * hash(seq, 6), 1),
  };
}

export function generateReading(seq: number, override?: Override): Reading | null {
  if (!override && isDropped(seq)) return null;
  const f = baseFeatures(seq);
  const script = override ? null : scripted(seq);
  if (override) applyAttack(f, override.cls, override.intensity, seq);
  else if (script) applyAttack(f, script.cls, script.s, seq);
  if (!override) {
    if (seq === 330) f.battery_temp = null;
    if (seq === 455 || seq === 456) f.rf_snr = null;
  }
  const c = classify(f);
  const r: Reading = {
    id: readingId(seq),
    seq,
    ts: seqTs(seq),
    source: override ? 'threat-lab' : 'downlink',
    features: f,
    predicted: c.predicted,
    confidence: round(c.confidence, 4),
    probabilities: c.probabilities,
  };
  if (override) {
    r.groundTruth = override.cls;
    r.runId = override.runId;
  } else if (seq < 600) {
    r.groundTruth = script ? script.truth ?? script.cls : 'nominal';
  }
  if (seq % 97 !== 0) r.latencyMs = Math.round(41 + 31 * hash(seq, 7) + (c.predicted !== 'nominal' ? 24 : 0));
  return r;
}

export const SAMPLE_INPUTS: SampleInput[] = [
  { seq: 30, label: 'Nominal pass frame' },
  { seq: 205, label: 'Suspicious, not escalated' },
  { seq: 245, label: 'Jamming burst frame' },
  { seq: 74, label: 'Command injection frame' },
].map(({ seq, label }) => {
  const r = generateReading(seq)!;
  return { id: `sample-${seq}`, label, readingId: r.id, features: r.features, groundTruth: r.groundTruth! };
});

function buildReport(inc: Incident, readings: Map<string, Reading>) {
  const rs = inc.readingIds.map((id) => readings.get(id)).filter(Boolean) as Reading[];
  const name = CLASS_LABEL[inc.cls];
  const dur = Math.round(((inc.closedAt ?? inc.lastSeen ?? 0) - (inc.firstSeen ?? 0)) / 1000);
  const trig = inc.triggerReadingIds.join(', ');
  const key = inc.cls === 'jamming' ? 'rf_snr' : inc.cls === 'spoofing' ? 'gyro_rate' : 'cmd_rate';
  const vals = rs.map((r) => r.features[key]).filter((v): v is number => v != null);
  const extreme = inc.cls === 'jamming' ? Math.min(...vals) : Math.max(...vals);
  return `## Summary
${inc.id} records a ${name.toLowerCase()} pattern on ${CONFIG.sourceName} between ${fmtTime(inc.firstSeen)} and ${fmtTime(inc.lastSeen)} UTC. The detector attached ${rs.length} readings with a peak confidence of ${fmtConf(inc.peakConfidence)}. The incident closed after ${CONFIG.closeAfter} consecutive nominal readings, ${dur} seconds after it opened.

## What triggered it
The incident opened when ${CONFIG.consecutive} consecutive readings were classified as ${name} at or above the ${CONFIG.threshold.toFixed(2)} threshold: ${trig}. The most extreme value of \`${key}\` in the window was ${extreme}.

## Assessment
- The anomaly is confined to \`${key}\`; the other channels stay within their nominal bands.
- ${inc.origin === 'threat-lab' ? `Readings originate from Threat Lab run ${inc.runId}; treat this as a simulation outcome, not an operational event.` : 'Readings originate from the sample downlink replay, not from a simulation.'}
- Ground-truth labels in the sample dataset agree with the predicted class for the trigger readings.

## Suggested review
${CLASS_INFO[inc.cls].mitigations.map((m) => `- ${m}`).join('\n')}

> Advisory: this report is generated from sample data. Validate every recommendation against operational procedures before acting.`;
}

/** Simulates the server: owns the full stream, the detector and report generation. */
export class SampleSource {
  cursor = -1;
  readings: Reading[] = [];
  readingMap = new Map<string, Reading>();
  incidents: Incident[] = [];
  overrides: Record<number, Override> = {};
  retries: Record<string, number> = {};
  dropped = 0;
  private streak: Reading[] = [];
  private active: Incident | null = null;
  private nominalRun = 0;
  private closedSeq = new Map<string, number>();

  changedReadings = new Set<string>();
  changedIncidents = new Set<string>();

  advanceTo(seq: number) {
    while (this.cursor < seq) {
      this.cursor++;
      this.ingest(this.cursor);
    }
  }

  takeChanges() {
    const readings = [...this.changedReadings].map((id) => this.readingMap.get(id)!).filter(Boolean);
    const incidents = [...this.changedIncidents].map((id) => this.incidents.find((i) => i.id === id)!).filter(Boolean);
    this.changedReadings.clear();
    this.changedIncidents.clear();
    return { readings: readings.map((r) => ({ ...r, features: { ...r.features } })), incidents: incidents.map(cloneIncident) };
  }

  retryReport(id: string) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc || inc.report.status !== 'failed') return false;
    this.retries[id] = this.cursor;
    inc.report = { ...inc.report, status: 'pending', error: undefined, requestedAt: seqTs(this.cursor) };
    inc.timeline.push({ ts: seqTs(this.cursor), kind: 'report_retry', label: 'Report generation retried by analyst' });
    this.changedIncidents.add(id);
    return true;
  }

  private ingest(seq: number) {
    this.progressReports(seq);
    const r = generateReading(seq, this.overrides[seq]);
    if (!r) {
      this.dropped++;
      return;
    }
    this.readings.push(r);
    this.readingMap.set(r.id, r);
    this.changedReadings.add(r.id);
    this.detect(r, seq);
  }

  private mark(r: Reading, decision: string, incidentId?: string) {
    r.decision = decision;
    if (incidentId) r.incidentId = incidentId;
    this.changedReadings.add(r.id);
  }

  private finalizeStreak() {
    const n = this.streak.length;
    for (const s of this.streak) this.mark(s, `Streak ended at ${n} of ${CONFIG.consecutive} required consecutive readings; classified but not escalated.`);
    this.streak = [];
  }

  private detect(r: Reading, seq: number) {
    const T = CONFIG.threshold;
    const anomalous = r.predicted !== 'nominal' && r.confidence >= T;
    const act = this.active;
    if (act) {
      if (anomalous && r.predicted === act.cls) {
        act.readingIds.push(r.id);
        act.lastSeen = r.ts;
        this.nominalRun = 0;
        if (act.peakConfidence == null || r.confidence > act.peakConfidence) {
          act.peakConfidence = r.confidence;
        }
        this.mark(r, `Attached to ${act.id}: ${CLASS_LABEL[r.predicted]} at ${fmtConf(r.confidence)} while the incident was open.`, act.id);
        this.changedIncidents.add(act.id);
        return;
      }
      if (anomalous) {
        this.mark(r, `${CLASS_LABEL[r.predicted]} prediction during open ${act.id} (${CLASS_LABEL[act.cls]}); class differs, not attached.`);
      } else if (r.predicted !== 'nominal') {
        this.mark(r, `Below incident threshold (${fmtConf(r.confidence)} < ${fmtConf(T, 0)}); logged, not attached to ${act.id}.`);
      }
      if (!anomalous) this.nominalRun++;
      if (this.nominalRun >= CONFIG.closeAfter) {
        act.lifecycle = 'closed';
        act.closedAt = r.ts;
        act.timeline.push({ ts: r.ts, kind: 'closed', label: `Closed after ${CONFIG.closeAfter} consecutive non-anomalous readings`, readingId: r.id });
        act.report = { status: 'pending', requestedAt: r.ts };
        act.timeline.push({ ts: r.ts, kind: 'report_pending', label: 'Report generation requested' });
        const peakR = act.readingIds.map((id) => this.readingMap.get(id)!).reduce((a, b) => (b.confidence > a.confidence ? b : a));
        act.timeline.push({ ts: peakR.ts, kind: 'peak', label: `Peak confidence ${fmtConf(peakR.confidence)}`, readingId: peakR.id });
        act.timeline.sort((a, b) => a.ts - b.ts);
        this.closedSeq.set(act.id, seq);
        this.changedIncidents.add(act.id);
        this.active = null;
        this.nominalRun = 0;
      }
      return;
    }
    if (anomalous) {
      if (this.streak.length && this.streak[0].predicted !== r.predicted) this.finalizeStreak();
      this.streak.push(r);
      if (this.streak.length >= CONFIG.consecutive) {
        const id = `INC-${String(416 + this.incidents.length).padStart(4, '0')}`;
        const cls = r.predicted as AttackClass;
        const trig = [...this.streak];
        const inc: Incident = {
          id,
          cls,
          lifecycle: 'open',
          firstSeen: trig[0].ts,
          lastSeen: r.ts,
          readingIds: trig.map((t) => t.id),
          triggerReadingIds: trig.map((t) => t.id),
          peakConfidence: Math.max(...trig.map((t) => t.confidence)),
          origin: r.source,
          runId: r.runId,
          timeline: [
            ...trig.map((t, i) => ({ ts: t.ts, kind: 'trigger' as const, label: `Trigger reading ${i + 1} of ${CONFIG.consecutive} · ${fmtConf(t.confidence)}`, readingId: t.id })),
            { ts: r.ts, kind: 'opened', label: `Incident opened · ${CONFIG.consecutive} consecutive ${CLASS_LABEL[cls]} readings ≥ ${T.toFixed(2)}`, readingId: r.id },
          ],
          report: { status: 'unavailable' },
          sparta: CLASS_INFO[cls].sparta,
          mitigations: CLASS_INFO[cls].mitigations,
        };
        trig.forEach((t, i) => this.mark(t, `Trigger ${i + 1} of ${CONFIG.consecutive} for ${id}: ${CLASS_LABEL[cls]} at ${fmtConf(t.confidence)} ≥ ${T.toFixed(2)}.`, id));
        this.incidents.push(inc);
        this.active = inc;
        this.streak = [];
        this.nominalRun = 0;
        this.changedIncidents.add(id);
      } else {
        this.mark(r, `Candidate ${this.streak.length} of ${CONFIG.consecutive}: ${CLASS_LABEL[r.predicted]} at ${fmtConf(r.confidence)}; waiting for consecutive readings.`);
      }
      return;
    }
    this.finalizeStreak();
    if (r.predicted !== 'nominal') {
      this.mark(r, `Below incident threshold (${fmtConf(r.confidence)} < ${fmtConf(T, 0)}); logged, not escalated.`);
    }
  }

  private progressReports(seq: number) {
    for (const inc of this.incidents) {
      if (inc.report.status !== 'pending') continue;
      const start = this.retries[inc.id] ?? this.closedSeq.get(inc.id);
      if (start == null || seq < start + REPORT_DELAY) continue;
      const ts = seqTs(seq);
      const shouldFail = inc.origin === 'threat-lab' && inc.cls === 'spoofing' && this.retries[inc.id] == null;
      if (shouldFail) {
        inc.report = { status: 'failed', requestedAt: inc.report.requestedAt, error: 'Report generator timed out after 15 s (sample failure path). Evidence and timeline are unaffected.' };
        inc.timeline.push({ ts, kind: 'report_failed', label: 'Report generation failed' });
      } else {
        inc.report = {
          status: 'ready',
          mode: inc.id === 'INC-0416' ? 'cached' : 'template',
          requestedAt: inc.report.requestedAt,
          generatedAt: ts,
          body: buildReport(inc, this.readingMap),
        };
        inc.timeline.push({ ts, kind: 'report_ready', label: 'Report ready' });
      }
      this.changedIncidents.add(inc.id);
    }
  }
}

export function cloneIncident(i: Incident): Incident {
  return {
    ...i,
    readingIds: [...i.readingIds],
    triggerReadingIds: [...i.triggerReadingIds],
    timeline: i.timeline.map((e) => ({ ...e })),
    report: { ...i.report },
  };
}
