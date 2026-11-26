/** Fallback until the backend publishes a source-specific expected cadence. */
export const BACKEND_STALE_AFTER_MS = 30_000;

export function isFeedStale({ connection, backend, kafkaOk, ageMs }: {
  connection: string;
  backend: boolean;
  kafkaOk?: boolean;
  ageMs: number | null;
}) {
  return connection === 'disconnected' || connection === 'reconnecting'
    || (backend && (kafkaOk === false || (ageMs != null && ageMs > BACKEND_STALE_AFTER_MS)));
}
