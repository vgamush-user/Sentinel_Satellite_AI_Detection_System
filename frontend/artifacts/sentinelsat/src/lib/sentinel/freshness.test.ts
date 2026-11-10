import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKEND_STALE_AFTER_MS, isFeedStale } from './freshness';

test('healthy transport does not make an old backend reading fresh', () => {
  const connected = { connection: 'connected', backend: true, kafkaOk: true };
  assert.equal(isFeedStale({ ...connected, ageMs: 60 * 60 * 1000 }), true);
  assert.equal(isFeedStale({ ...connected, ageMs: BACKEND_STALE_AFTER_MS - 1 }), false);
  assert.equal(isFeedStale({ ...connected, ageMs: null }), false);
});

test('sample wall-clock age alone does not raise a live freshness alarm', () => {
  const sample = { backend: false, ageMs: 60 * 60 * 1000 };
  assert.equal(isFeedStale({ ...sample, connection: 'connected' }), false);
  assert.equal(isFeedStale({ ...sample, connection: 'disconnected' }), true);
});
