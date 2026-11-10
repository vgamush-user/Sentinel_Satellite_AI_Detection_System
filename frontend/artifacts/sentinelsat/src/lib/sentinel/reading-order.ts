import type { Reading } from './types';
export type ReadingSort = { key: 'ts' | 'confidence' | 'latency'; dir: 'asc' | 'desc' };
export function compareReadings(a: Reading, b: Reading, sort: ReadingSort) {
  if (sort.key === 'latency' && (a.latencyMs == null || b.latencyMs == null))
    return a.latencyMs == null ? b.latencyMs == null ? a.id.localeCompare(b.id) : 1 : -1;
  const value = (r: Reading) => sort.key === 'ts' ? r.ts : sort.key === 'confidence' ? r.confidence : r.latencyMs!;
  return (value(a) - value(b)) * (sort.dir === 'asc' ? 1 : -1) || a.seq - b.seq || a.id.localeCompare(b.id);
}
