import type { ClientState } from './store';
import type { BackendState } from '../backend/client';
import { normalizeData } from '../backend/normalize';

/** One resolution order for tables, inspectors, charts and incident details. */
export function resolveReading(id: string, state: ClientState, backend?: BackendState) {
  const current = state.readingIndex.get(id) ?? state.evidence.get(id);
  if (current) return current;
  const retained = backend?.evidence.get(id);
  if (!retained || !backend?.data) return undefined;
  return normalizeData({ ...backend.data, recent: [retained], decisions: new Map([...backend.evidenceDecisions, ...backend.data.decisions]) }).readings[0];
}
