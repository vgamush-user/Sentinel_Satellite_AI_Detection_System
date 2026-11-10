import type { Reading } from './types';

export const chronological = (rows: Reading[]) => [...rows].filter(r => Number.isFinite(r.ts) && r.ts > 0)
  .sort((a, b) => a.ts - b.ts || a.seq - b.seq || a.id.localeCompare(b.id));

/** Decimate drawing geometry only. Exact values and keyboard navigation retain every row. */
export function extremaIndices(rows: Reading[], key: string, width: number, selectedId?: string | null) {
  const keep = new Set<number>();
  const bucketSize = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(width / 2))));
  for (let start = 0; start < rows.length; start += bucketSize) {
    const end = Math.min(rows.length, start + bucketSize);
    let min = -1, max = -1;
    for (let i = start; i < end; i++) {
      const v = rows[i].features[key];
      if (v == null || !Number.isFinite(v)) { keep.add(i); if (i) keep.add(i - 1); if (i + 1 < rows.length) keep.add(i + 1); continue; }
      if (min < 0 || v < rows[min].features[key]!) min = i;
      if (max < 0 || v > rows[max].features[key]!) max = i;
      if (!['normal', 'nominal'].includes(rows[i].predicted.toLowerCase()) || rows[i].id === selectedId) keep.add(i);
    }
    if (min >= 0) keep.add(min);
    if (max >= 0) keep.add(max);
  }
  if (rows.length) { keep.add(0); keep.add(rows.length - 1); }
  return keep;
}

/** Only source sequences can demonstrate loss; timestamp-derived fallback sequences cannot. */
export function sequenceGaps(rows: Reading[]) {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const gaps: { from: number; to: number; kind: 'dropped' | 'null' }[] = [];
  const authoritative = (r: Reading) => r.raw === undefined || (typeof r.raw === 'object' && r.raw !== null && typeof (r.raw as { seq?: unknown }).seq === 'number');
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (authoritative(a) && authoritative(b) && b.seq - a.seq > 1 && b.ts > a.ts) gaps.push({ from: a.ts, to: b.ts, kind: 'dropped' });
  }
  return gaps;
}
