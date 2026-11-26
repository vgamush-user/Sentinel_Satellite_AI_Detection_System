import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chronological, extremaIndices, sequenceGaps } from './chart-model';
import type { Reading } from './types';
import { compareReadings } from './reading-order';

const row = (seq: number, value: number | null, ts = seq * 1000): Reading => ({ id: `r${seq}`, seq, ts, source: 'downlink', features: { v: value }, predicted: 'nominal', confidence: .9 });

test('chronological inspection sorts by timestamp with stable duplicate ties without changing input', () => {
  const rows = [row(3, 0, 1000), row(1, 0, 2000), row(2, 0, 1000)];
  assert.deepEqual(chronological(rows).map(r => r.id), ['r2', 'r3', 'r1']);
  assert.equal(rows[0].id, 'r3');
});

test('decimation retains ordinary extrema, selected and flagged readings and null boundaries', () => {
  const rows = Array.from({ length: 900 }, (_, i) => row(i + 1, 10));
  rows[197].features.v = 1000;
  rows[198].features.v = -1000;
  rows[221].features.v = null;
  rows[403].predicted = 'jamming';
  const kept = extremaIndices(rows, 'v', 200, rows[601].id);
  for (const index of [0, 197, 198, 220, 221, 222, 403, 601, 899]) assert.ok(kept.has(index), `retained index ${index}`);
  assert.ok(kept.size < rows.length);
});

test('sequence gap evidence is separate from timestamp sorting and excludes synthetic sequences', () => {
  assert.deepEqual(sequenceGaps([row(4, 0), row(1, 0)]), [{ from: 1000, to: 4000, kind: 'dropped' }]);
  const synthetic = [row(1000, 0), row(4000, 0)].map(r => ({ ...r, raw: { ts: r.ts } }));
  assert.deepEqual(sequenceGaps(synthetic), []);
  assert.deepEqual(sequenceGaps([row(1, 0, 4000), row(4, 0, 1000)]), []);
});

test('empty and single-value geometry retain truthful values', () => {
  assert.equal(extremaIndices([], 'v', 1).size, 0);
  assert.deepEqual([...extremaIndices([row(1, 0)], 'v', 1)], [0]);
});

test('Time sort follows displayed timestamp and missing latency stays last in both directions', () => {
  const rows = [row(1, 0, 3000), row(2, 0, 1000), row(3, 0, 2000)];
  assert.deepEqual([...rows].sort((a, b) => compareReadings(a, b, { key: 'ts', dir: 'asc' })).map(r => r.id), ['r2', 'r3', 'r1']);
  rows[0].latencyMs = 0;
  rows[1].latencyMs = 20;
  for (const dir of ['asc', 'desc'] as const) assert.equal([...rows].sort((a, b) => compareReadings(a, b, { key: 'latency', dir })).at(-1)?.id, 'r3');
});
