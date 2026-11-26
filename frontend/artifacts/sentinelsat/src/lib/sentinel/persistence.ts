import { z } from 'zod';

/** Rebuilding a sample session is synchronous; reject unbounded stored work. */
export const MAX_REBUILD_CURSOR = 50_000;
export const SAMPLE_STORAGE_KEY = 'sentinelsat.sample.v2';
export const LEGACY_SAMPLE_STORAGE_KEY = 'sentinelsat.sample.v1';
const sequence = z.number().int().min(0).max(MAX_REBUILD_CURSOR);
const id = z.string().min(1).max(128);
const attackClass = z.enum(['jamming', 'spoofing', 'command_injection']);
const request = z.object({ scenarioId: id, count: z.number().int().min(1).max(100), intensity: z.number().finite().min(0).max(1) });
export const samplePayloadSchema = z.object({
  cursor: sequence, playing: z.boolean(), speed: z.union([z.literal(1), z.literal(2), z.literal(5)]),
  overrides: z.record(z.string().regex(/^\d+$/), z.object({ runId: id, cls: attackClass, intensity: z.number().finite().min(0).max(1) }))
    .refine(value => Object.keys(value).length <= 10_000 && Object.keys(value).every(key => Number(key) <= MAX_REBUILD_CURSOR + 100)),
  retries: z.record(id, sequence).refine(value => Object.keys(value).length <= 1000),
  runs: z.array(z.object({ runId: id, scenarioId: id, acceptedAt: z.number().finite(),
    scheduledFromSeq: sequence, scheduledToSeq: z.number().int().min(0).max(MAX_REBUILD_CURSOR + 100),
    readingIds: z.array(id).min(1).max(100), request,
  }).refine(run => run.readingIds.length === run.request.count && run.scheduledToSeq - run.scheduledFromSeq + 1 === run.request.count)).max(1000),
}).refine(payload => Object.values(payload.retries).every(at => at <= payload.cursor));
const envelopeSchema = z.object({ version: z.literal(2), sessionId: z.string().uuid(), payload: samplePayloadSchema });
export function parseSamplePersistence(raw: string, legacy: boolean) {
  if (raw.length > 2_000_000) throw new Error('Saved sample data exceeds the supported storage limit.');
  const parsed: unknown = JSON.parse(raw);
  return legacy
    ? { version: 2 as const, sessionId: crypto.randomUUID(), payload: samplePayloadSchema.parse(parsed) }
    : envelopeSchema.parse(parsed);
}
