import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SampleAdapter } from './adapter';
import { Store } from './store';
import { DurableCell, executeOperation, recoverOperation, type Operation } from './operations';
import { reportStatus } from '../backend/report-status';
import { normalizeIncident } from '../backend/normalize';
import { MAX_REBUILD_CURSOR, parseSamplePersistence } from './persistence';

test('sample reset replaces every collection and ignores pending old-session submissions', async () => {
  const adapter = new SampleAdapter();
  const store = new Store(adapter);
  const unsubscribe = adapter.subscribe(store.onEvent);
  try {
    await store.init();
    await adapter.replay({ action: 'pause' });
    const baseline = store.get().playback!.cursorSeq;
    await adapter.replay({ action: 'step', count: 100 });
    const pending = adapter.runAttack({ scenarioId: 'jam-probe', count: 3, intensity: .95 });
    adapter.reset();
    await adapter.replay({ action: 'pause' });
    assert.equal(store.get().epoch, 1);
    assert.equal(store.get().playback!.cursorSeq, baseline);
    assert(store.get().readings.every(row => row.seq <= baseline));
    assert.equal(store.get().runs.length, 0);
    assert.equal(store.get().evidence.size, 0);
    await assert.rejects(pending, /session was reset/);
    assert.equal(store.get().runs.length, 0);
  } finally { unsubscribe(); }
});

test('durable operation survives subscribers leaving, rejects duplicate work and snapshots its result', async () => {
  const cell = new DurableCell<Operation<{ submitted: number; answer: number }>>('test-operation', { status: 'idle' });
  let finish!: (v: number) => void;
  let calls = 0;
  const response = new Promise<number>(resolve => { finish = resolve; });
  const stop = cell.subscribe(() => {});
  const pending = executeOperation(cell, async () => { calls++; return { submitted: 4, answer: await response }; });
  stop();
  await executeOperation(cell, async () => { calls++; return { submitted: 9, answer: 9 }; });
  assert.equal(calls, 1);
  finish(8);
  await pending;
  assert.equal(cell.get().status, 'succeeded');
  assert.deepEqual(cell.get().result, { submitted: 4, answer: 8 });
  assert.equal(recoverOperation({ status: 'pending' }).status, 'unknown');
});

test('submitted sample evidence survives rolling buffer eviction', async () => {
  const adapter = new SampleAdapter();
  const store = new Store(adapter);
  const unsubscribe = adapter.subscribe(store.onEvent);
  try {
    await store.init();
    await adapter.replay({ action: 'pause' });
    const run = await adapter.runAttack({ scenarioId: 'jam-probe', count: 3, intensity: .95 });
    await adapter.replay({ action: 'step', count: 10 });
    const id = run.readingIds[0];
    assert(store.get().evidence.has(id));
    await adapter.replay({ action: 'step', count: 1000 });
    assert.equal(store.get().readingIndex.has(id), false);
    assert.equal(store.get().evidence.get(id)?.runId, run.runId);
    assert(adapter.getEvidence().some(row => row.id === id));
  } finally { unsubscribe(); }
});

test('transport failure leaves completion unknown and never automatically retries', async () => {
  const cell = new DurableCell<Operation<void>>('test-failure', { status: 'idle' });
  let calls = 0;
  await executeOperation(cell, async () => { calls++; throw new TypeError('Network failure'); });
  assert.equal(calls, 1);
  assert.equal(cell.get().status, 'unknown');
});

test('report status is explicit and missing incident metadata stays missing', () => {
  for (const status of ['AUTONOMOUS', 'FLAGGED_FOR_REVIEW', 'OK', 'DONE']) assert.equal(reportStatus(status), 'ready');
  assert.equal(reportStatus('ERROR', 'Failure details'), 'failed');
  assert.equal(reportStatus('RUNNING', 'Previous report'), 'pending');
  assert.equal(reportStatus('new-server-status', 'Text'), 'unknown');
  assert.equal(reportStatus(null, 'Text'), 'unknown');
  const incident = normalizeIncident({ incident_id: 'partial' }, []);
  assert.equal(incident.firstSeen, null);
  assert.equal(incident.lastSeen, null);
  assert.equal(incident.peakConfidence, null);
  assert.equal(incident.lifecycle, 'unknown');
  assert.equal(normalizeIncident({ incident_id: 'zero', peak_confidence: 0 }, []).peakConfidence, 0);
});

test('sample persistence migrates valid legacy state and rejects unbounded or malformed rebuilds', () => {
  const payload = { cursor: 278, playing: false, speed: 2, overrides: {}, retries: {}, runs: [] };
  const envelope = parseSamplePersistence(JSON.stringify(payload), true);
  assert.equal(envelope.version, 2);
  assert.deepEqual(envelope.payload, payload);
  assert.deepEqual(parseSamplePersistence(JSON.stringify(envelope), false), envelope);
  for (const patch of [{ cursor: MAX_REBUILD_CURSOR + 1 }, { cursor: -1 }, { cursor: '278' },
    { speed: 1000 }, { retries: { 'INC-1': 1000 } }, { overrides: { '-1': { runId: 'x', cls: 'jamming', intensity: .8 } } }]) {
    assert.throws(() => parseSamplePersistence(JSON.stringify({ ...payload, ...patch }), true));
  }
  assert.throws(() => parseSamplePersistence(JSON.stringify({ ...envelope, version: 999 }), false));
});

test('adapter migration preserves the legacy key and persists a stable session identity', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const legacy = JSON.stringify({ cursor: 300, playing: false, speed: 2, overrides: {}, retries: {}, runs: [] });
  const values = new Map([['sentinelsat.sample.v1', legacy]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : Reflect.deleteProperty(globalThis, 'localStorage'));
  const first = await new SampleAdapter().getState();
  const second = await new SampleAdapter().getState();
  assert.equal(first.playback?.cursorSeq, 300);
  assert.equal(first.playback?.speed, 2);
  assert.equal(first.config.sampleSessionId, second.config.sampleSessionId);
  assert.equal(values.get('sentinelsat.sample.v1'), legacy);
  assert.equal(JSON.parse(values.get('sentinelsat.sample.v2')!).version, 2);
});
