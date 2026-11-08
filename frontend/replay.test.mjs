import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
after(() => vite.close());
const { batch } = await vite.ssrLoadModule("/src/protocol.ts");
const { replayReducer } = await vite.ssrLoadModule("/src/useReplay.ts");

const row = entry_id => ({ entry_id, predicted_class: "Normal", confidence: 0.9, threat: 0.1, ts: 1 });
const stats = rows_total => ({ rows_total, kafka_ok: true, rows_per_sec: 2, counts: {}, pred_counts: {},
  accuracy: null, replay_dataset: null, latency_p50_ms: null, last_row_age_sec: null });
const config = { classes: ["Normal"], features: [], agent_mode: "cached",
  guards: { min_confidence: 0.7, min_rows: 5, window_rows: 20 } };

test("validates batch members before applying them", () => {
  assert.equal(batch({ telemetry: [row("a")], stats: stats(1) }), true);
  assert.equal(batch({ telemetry: [{ ...row("a"), confidence: "0.9" }] }), false);
  assert.equal(batch({ incidents: [{ event: "unknown", incident_id: "A" }] }), false);
  assert.equal(batch({ reports: [{ event: "finished", incident_id: "A", attack_class: "Data Injection", mode: "cached" }] }), false);
});

test("reconciles overlapping hydration frames without replaying older telemetry or reopening an incident", () => {
  const snapshot = { config, stats: stats(3), recent: ["a", "b", "c"].map(row), incidents: [
    { incident_id: "A", status: "closed", opened_ts: 1, closed_ts: 3, report_status: "AUTONOMOUS", report_finished_ts: 4 },
  ] };
  const buffered = [
    { stats: stats(2), telemetry: [row("b")], incidents: [{ event: "opened", incident_id: "A", opened_ts: 1 }],
      reports: [{ event: "started", incident_id: "A", attack_class: "Data Injection", mode: "cached", started_ts: 2 }] },
    { stats: stats(4), telemetry: [row("c"), row("d")] },
  ];
  const replay = replayReducer(null, { snapshot, buffered });
  assert.deepEqual(replay.recent.map(row => row.entry_id), ["a", "b", "c", "d"]);
  assert.equal(replay.stats.rows_total, 4);
  assert.equal(replay.incidents.get("A").status, "closed");
  assert.equal(replay.incidents.get("A").report_status, "AUTONOMOUS");
});

test("a detail response preserves report fields that arrived while the request was pending", () => {
  const baseline = { incident_id: "A", status: "open" };
  const replay = replayReducer(null, { snapshot: { config, stats: stats(0), recent: [], incidents: [baseline] }, buffered: [] });
  const withReport = replayReducer(replay, { batch: { reports: [{ event: "finished", mode: "cached", incident_id: "A",
    attack_class: "Data Injection", status: "AUTONOMOUS", report: "New report" }] } });
  const merged = replayReducer(withReport, { baseline, stored: { ...baseline, report: null, row_count: 7 } });
  assert.equal(merged.incidents.get("A").report, "New report");
  assert.equal(merged.incidents.get("A").row_count, 7);
});
