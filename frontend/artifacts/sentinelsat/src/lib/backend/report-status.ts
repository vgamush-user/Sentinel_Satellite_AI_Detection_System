import type { ReportStatus } from '../sentinel/types';

/** Job status and the presence of report text are independent facts. */
export function reportStatus(value: string | null | undefined, body?: string | null): ReportStatus {
  const status = value?.trim().toUpperCase();
  if (status === 'ERROR' || status === 'FAILED') return 'failed';
  if (['RUNNING', 'PENDING', 'QUEUED', 'STARTED'].includes(status ?? '')) return 'pending';
  if (['AUTONOMOUS', 'FLAGGED_FOR_REVIEW', 'OK', 'DONE', 'READY'].includes(status ?? '')) return 'ready';
  return status || body?.trim() ? 'unknown' : 'unavailable';
}
