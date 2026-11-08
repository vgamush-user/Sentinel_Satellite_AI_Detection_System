import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackendClient, gatewayBase, validateBackendUrl } from './client';
import { backendAddress, saveBackendAddress } from './settings';
import { applyBatch, appendRows, hydrate, mergeIncident, mergeStored } from './reducer';
import { customEntryCountSchema, initialSchema, submissionSchema, type BackendInitial, type BackendRow } from './protocol';
import { normalizeData, normalizeIncident } from './normalize';

const row = (id: number): BackendRow => ({
  entry_id: `entry-${id}`, seq: id, ts: 1700000000 + id / 10,
  predicted_class: id % 2 ? 'Storage Exhaustion' : 'Normal',
  confidence: .91, threat: .6, source: 'replay', f: { MemoryAnonMB: 120 },
});
const initial = (): BackendInitial => ({
  config: { classes: ['Normal', 'Storage Exhaustion', 'Future Class'], features: ['MemoryAnonMB'],
    agent_mode: 'live', guards: { min_confidence: .7, min_rows: 5, window_rows: 20 } },
  recent: [row(1), row(2)],
  incidents: [{ incident_id: 'incident-A', attack_class: 'Storage Exhaustion', opened_ts: 1700000000,
    last_seen_ts: 1700000001, status: 'open', row_count: 15, trigger_entry_ids: ['entry-1'] }],
  stats: { kafka_ok: false, rows_total: 2, rows_per_sec: 10, accuracy: .621, replay_dataset: 'noised',
    latency_p50_ms: 121, last_row_age_sec: .1, counts: { incidents_opened: 1 }, pred_counts: { Normal: 1, 'Storage Exhaustion': 1 } },
});

test('source contract accepts dynamic taxonomy and rejects malformed states or acknowledgements', () => {
  assert.equal(initialSchema.parse(initial()).config.classes[2], 'Future Class');
  assert.equal(initialSchema.safeParse({ ...initial(), stats: {} }).success, false);
  assert.equal(submissionSchema.safeParse({ entry_ids: ['entry-1'], count: 2 }).success, false);
  assert.equal(submissionSchema.safeParse({ entry_ids: [], count: 0 }).success, false);
});

test('normalization preserves IDs, seconds, backend metrics, evidence count, and absent ground truth', () => {
  const normalized = normalizeData(hydrate(null, initial(), []));
  assert.equal(normalized.readings[0].id, 'entry-1');
  assert.equal(normalized.readings[0].ts, row(1).ts * 1000);
  assert.equal(normalized.readings[0].predicted, 'Storage Exhaustion');
  assert.equal(normalized.readings[0].groundTruth, undefined);
  assert.equal(normalized.readings[0].features.threat_score, .6);
  assert.equal(normalized.readings[0].incidentId, 'incident-A');
  assert.equal(normalized.stats.totalReceived, 2);
  assert.equal(normalized.stats.kafkaOk, false);
  assert.equal(normalized.stats.ingestPerMin, 600);
  assert.equal(normalized.incidents[0].rowCount, 15);
  assert.equal(normalized.incidents[0].readingIds.length, 1);
  assert.equal(normalized.config.windowRows, 20);
  assert.equal(normalized.config.consecutive, 5);
  assert.equal(normalized.playback, null, 'live stream must not inherit demo playback controls');
});

test('report status and provenance do not invent a live analysis', () => {
  assert.equal(normalizeIncident({ incident_id: 'a' }, []).report.mode, undefined);
  assert.equal(normalizeIncident({ incident_id: 'a' }, []).report.status, 'unavailable');
  assert.equal(normalizeIncident({ incident_id: 'a', report_mode: 'cached', report_status: 'FLAGGED_FOR_REVIEW' }, []).report.mode, 'cached');
  assert.equal(normalizeIncident({ incident_id: 'a', report_status: 'FLAGGED_FOR_REVIEW' }, []).report.status, 'ready');
  assert.equal(normalizeIncident({ incident_id: 'a', report_status: 'ERROR', report: 'Failure details' }, []).report.status, 'failed');
  assert.equal(normalizeIncident({ incident_id: 'a', report_status: 'RUNNING', report: 'Old report' }, []).report.status, 'pending');
});

test('deduplication keeps latest values, order and the bounded evidence window', () => {
  const rows = appendRows(Array.from({ length: 320 }, (_, i) => row(i)), [{ ...row(319), confidence: .4 }]);
  assert.equal(rows.length, 300);
  assert.equal(rows[0].entry_id, 'entry-20');
  assert.equal(rows.at(-1)?.confidence, .4);
});

test('older incident updates cannot reopen closed incidents or overwrite newer reports', () => {
  const current = { incident_id: 'a', status: 'closed', closed_ts: 20, last_seen_ts: 19,
    report_finished_ts: 30, report_status: 'DONE', report: 'new' };
  const merged = mergeIncident(current, { incident_id: 'a', status: 'open', last_seen_ts: 18,
    report_started_ts: 21, report_status: 'RUNNING', report: 'old' });
  assert.equal(merged.status, 'closed');
  assert.equal(merged.report, 'new');
  assert.equal(merged.report_status, 'DONE');
});

test('incident-detail response cannot overwrite live fields changed during the request', () => {
  const baseline = { incident_id: 'a', row_count: 10, last_seen_ts: 20 };
  const current = { ...baseline, row_count: 12, report: 'live', report_finished_ts: 30 };
  const result = mergeStored(current, { ...baseline, row_count: 11, trigger_entry_ids: ['x'], report: 'stale' }, baseline);
  assert.equal(result.row_count, 12);
  assert.equal(result.report, 'live');
  assert.deepEqual(result.trigger_entry_ids, ['x']);
});

test('snapshot hydration handles a frame straddling the HTTP snapshot without duplicate rows', () => {
  const snapshot = initial();
  const data = hydrate(null, snapshot, [{
    telemetry: [row(1), row(2), row(3)],
    stats: { ...snapshot.stats, rows_total: 3 },
  }]);
  assert.deepEqual(data.recent.map(r => r.entry_id), ['entry-1', 'entry-2', 'entry-3']);
  assert.equal(data.stats.rows_total, 3);
});

test('decisions and reports are correlated separately from incident closure', () => {
  const data = applyBatch(hydrate(null, initial(), []), {
    incidents: [
      { event: 'entry_decision', entry_id: 'entry-2', incident_id: 'incident-A', decision: 'joined', detail: 'guard passed' },
      { event: 'closed', incident_id: 'incident-A', closed_ts: 1700000030, status: 'closed' },
    ],
    reports: [{ event: 'finished', incident_id: 'incident-A', attack_class: 'Storage Exhaustion', mode: 'cached',
      status: 'OK', finished_ts: 1700000040, report: 'Cached example' }],
  });
  const normalized = normalizeData(data);
  assert.equal(normalized.readings[1].incidentId, 'incident-A');
  assert.equal(normalized.readings[1].decision, 'joined: guard passed');
  assert.equal(normalized.incidents[0].lifecycle, 'closed');
  assert.equal(normalized.incidents[0].report.status, 'ready');
  assert.equal(normalized.incidents[0].report.mode, 'cached');
});

test('API base URL rejects unsupported schemes, credentials, queries, and fragments', () => {
  assert.equal(validateBackendUrl('https://example.test/backend/'), 'https://example.test/backend');
  for (const url of ['file:///a', 'https://user:pass@example.test', 'https://example.test?token=secret', 'https://example.test/#x'])
    assert.throws(() => validateBackendUrl(url));
});

test('browser clients use the same-origin gateway, ignore old targets, and reject unauthorized controls before fetching', async t => {
  const properties = ['window', 'location', 'localStorage', 'fetch'] as const;
  const descriptors = new Map(properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const key of properties) {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://dashboard.test', protocol: 'https:' } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: globalThis.location } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  assert.equal(gatewayBase('https://dashboard.test', '/sat/'), 'https://dashboard.test/sat');
  values.set('sentinelsat.backend.connection.v1', JSON.stringify({ url: 'https://previous-backend.test' }));
  assert.equal(backendAddress(), 'https://dashboard.test', 'legacy remote addresses must not bypass the proxy');
  assert.throws(() => new BackendClient('https://external.test'), /Direct browser connections are disabled/);
  const client = new BackendClient();
  assert.equal(client.readOnlyGateway, true);
  globalThis.fetch = (async () => { throw new Error('An unauthorized network call escaped the capability guard'); }) as typeof fetch;
  await assert.rejects(client.sample('Normal', 'clean'), /read-only/);
  await assert.rejects(client.send({ features: {}, count: 1, true_class: null, interval_sec: .1 }), /read-only/);
  await assert.rejects(client.manualReplay(), /read-only/);
  await assert.rejects(client.analyzeWindow(), /read-only/);
  await assert.rejects(client.scorePacket({ MsgLength: 12 }), /read-only/);
  await assert.rejects(client.examples(), /read-only/);
  saveBackendAddress(null);
  assert.equal(backendAddress(), null, 'sample mode is intentional rather than an error fallback');
  saveBackendAddress(client.base);
  assert.equal(backendAddress(), 'https://dashboard.test');
  assert.throws(() => saveBackendAddress('https://external.test'), /same-origin/);
});

test('HTTP client sends verified endpoint contracts and handles manual controls returning 204', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls: { url: string; body: unknown; method?: string }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method });
    if (String(url).includes('/api/analysis/replay/')) return new Response(null, { status: 204 });
    return Response.json({ entry_ids: ['id-1', 'id-2'], count: 2 });
  }) as typeof fetch;
  const client = new BackendClient('https://example.test');
  const submission = await client.send({ features: { MsgLength: 12 }, count: 2, true_class: null, interval_sec: .1 });
  assert.deepEqual(submission.entry_ids, ['id-1', 'id-2']);
  assert.deepEqual(calls[0], { url: 'https://example.test/api/panel/send', method: 'POST',
    body: { features: { MsgLength: 12 }, count: 2, true_class: null, interval_sec: .1 } });
  await client.attack({ cls: 'Storage Exhaustion', quality: 'noisy', count: 2 });
  assert.equal(calls[1].url, 'https://example.test/api/attack');
  const settings = { dataset: 'raw' as const, speed: 200, order: 'shuffled' as const, loop: true, buffer_size: 500 };
  for (const action of ['load', 'configure', 'start', 'pause', 'resume', 'stop'] as const) await client.manualControl(action, settings);
  assert.deepEqual(calls.slice(2).map(c => c.url.split('/').at(-1)), ['load', 'configure', 'start', 'pause', 'resume', 'stop']);
  assert(calls.slice(2).every(c => JSON.stringify(c.body) === JSON.stringify(settings)));
});

test('HTTP errors, malformed JSON, empty snapshots, and unavailable models never become successful results', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = new BackendClient('https://example.test');
  globalThis.fetch = (async () => Response.json({ detail: 'Packet model not loaded' }, { status: 503 })) as typeof fetch;
  await assert.rejects(client.scorePacket({ MsgLength: 12 }), /Packet model not loaded/);
  globalThis.fetch = (async () => new Response('<html>wrong address</html>')) as typeof fetch;
  await assert.rejects(client.probe(), /non-JSON/);
  globalThis.fetch = (async () => Response.json({ config: {} })) as typeof fetch;
  await assert.rejects(client.probe(), /contract does not match/);
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  await assert.rejects(client.probe(), /no data/);
});

test('stream bootstrap, malformed frames and reconnect retain explicit transport and Kafka status', async t => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    static instances: FakeSocket[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: URL) { FakeSocket.instances.push(this); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  globalThis.fetch = (async () => Response.json(initial())) as typeof fetch;
  const client = new BackendClient('https://example.test/backend');
  t.after(() => { client.stop(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket; });
  client.start();
  const socket = FakeSocket.instances[0];
  assert.equal(String(socket.url), 'wss://example.test/backend/ws');
  socket.open();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(client.get().transport, 'connected');
  assert.equal(client.get().data?.stats.kafka_ok, false, 'WebSocket health is not Kafka health');
  socket.emit({ telemetry: [row(3)] });
  assert.equal(client.get().data?.recent.at(-1)?.entry_id, 'entry-3');
  client.trackEntries(['entry-3']);
  socket.emit({ incidents: [{ event: 'entry_decision', entry_id: 'entry-3', decision: 'normal', detail: 'No incident' }] });
  socket.emit({ telemetry: Array.from({ length: 400 }, (_, i) => row(i + 4)) });
  assert.equal(client.get().data?.recent.some(r => r.entry_id === 'entry-3'), false);
  assert.equal(client.get().evidence.get('entry-3')?.entry_id, 'entry-3', 'submitted evidence survives ordinary rolling-buffer eviction');
  socket.emit({ incidents: Array.from({ length: 1100 }, (_, i) => ({
    event: 'entry_decision', entry_id: `other-${i}`, decision: 'normal', detail: 'No incident',
  })) });
  assert.equal(client.get().data?.decisions.has('entry-3'), false);
  assert.equal(client.get().evidenceDecisions.get('entry-3')?.decision, 'normal', 'submitted decisions survive ordinary decision eviction');
  socket.emit({ telemetry: [{ entry_id: 'malformed' }] });
  assert.match(client.get().error ?? '', /malformed/);
  client.reconnect();
  const newSocket = FakeSocket.instances.at(-1)!;
  assert.notEqual(socket, newSocket);
  assert.equal(socket.readyState, 3);
  newSocket.open();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(client.get().transport, 'connected');
  assert.equal(client.get().evidence.get('entry-3')?.entry_id, 'entry-3');
});


test('custom entry bursts respect the Python 50-row limit before sending', async t => {
  assert.equal(customEntryCountSchema.safeParse(50).success, true);
  for (const count of [0, 1.5, 51, 100, NaN])
    assert.equal(customEntryCountSchema.safeParse(count).success, false);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
  const client = new BackendClient('https://example.test');
  await assert.rejects(client.send({ features: {}, count: 51, true_class: null, interval_sec: .1 }));
  assert.equal(calls, 0);
});

test('initial HTTP failure reaches the shared connection state on every route', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => new Response('upstream unavailable', { status: 502 })) as typeof fetch;
  const client = new BackendClient('https://example.test');
  await assert.rejects(client.initial(), /non-JSON/);
  assert.equal(client.get().transport, 'disconnected');
  assert.match(client.get().error ?? '', /non-JSON/);
  assert.equal(client.get().data, null);
});
