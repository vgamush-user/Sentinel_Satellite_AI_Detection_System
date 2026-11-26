import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Link } from 'wouter';
import { CLASS_LABEL, isNominal, fmtConf, fmtDateTime, fmtUnit, fmtValue } from '@/lib/sentinel/format';
import { useSentinel } from '@/lib/sentinel/store';
import type { ClassLabel, Reading } from '@/lib/sentinel/types';
import { Btn, ClassTag, Field, RawBlock } from './kit';

interface Props {
  reading: Reading | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNavigate?: (r: Reading) => void;
  showTelemetryLink?: boolean;
  navigationReadings?: Reading[];
}

export function ReadingInspector({ reading, open, onOpenChange, onNavigate, showTelemetryLink = true, navigationReadings }: Props) {
  const s = useSentinel();
  const features = s.config?.features ?? [];
  const threshold = s.config?.threshold ?? 0.7;
  const sequence = navigationReadings ?? s.readings;
  const idx = reading ? sequence.findIndex((r) => r.id === reading.id) : -1;
  const prev = idx > 0 ? sequence[idx - 1] : null;
  const next = idx >= 0 && idx < sequence.length - 1 ? sequence[idx + 1] : null;
  const evicted = reading && !s.readingIndex.has(reading.id);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(106_115_123/0.22)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-panel md:inset-y-3 md:left-auto md:right-3 md:w-[460px] md:rounded-[20px] md:border md:border-divider shadow-[0_24px_48px_-20px_rgb(138_121_103/0.45)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-6 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-6 duration-150"
          data-testid="dialog-reading-inspector"
        >
          {reading ? (
            <>
              <div className="flex items-start gap-3 border-b border-divider px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Reading</div>
                  <Dialog.Title className="mt-0.5 font-mono text-[17px] font-medium text-ink break-all" data-testid="text-inspector-id">
                    {reading.id}
                  </Dialog.Title>
                  <div className="mt-1 text-[12.5px] tnum text-ink-2" data-testid="text-inspector-ts">
                    {fmtDateTime(reading.ts)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Btn variant="ghost" size="sm" aria-label="Previous reading" disabled={!prev || !onNavigate} onClick={() => prev && onNavigate?.(prev)} data-testid="button-inspector-prev">
                    <ChevronLeft className="size-4" aria-hidden />
                  </Btn>
                  <Btn variant="ghost" size="sm" aria-label="Next reading" disabled={!next || !onNavigate} onClick={() => next && onNavigate?.(next)} data-testid="button-inspector-next">
                    <ChevronRight className="size-4" aria-hidden />
                  </Btn>
                  <Dialog.Close asChild>
                    <Btn variant="secondary" size="sm" aria-label="Close inspector" data-testid="button-inspector-close" className="ml-1 h-8 w-8 px-0">
                      <X className="size-4" aria-hidden />
                    </Btn>
                  </Dialog.Close>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {evicted && <p className="mb-3 rounded-[7px] border border-divider px-3 py-2 text-[12px] text-ink-3">This reading has left the bounded client window; values shown are from the last copy received.</p>}
                <dl>
                  <Field k="Source">
                    {reading.source === 'threat-lab' ? (
                      <span className="text-amber">
                        Threat Lab simulation <span className="font-mono text-[12px]">{reading.runId}</span>
                      </span>
                    ) : s.config?.mode === 'connected' ? (
                      <span>Backend replay</span>
                    ) : (
                      'Downlink (sample replay)'
                    )}
                  </Field>
                  {reading.originalSource && (
                    <Field k="Source (as reported)" mono>
                      {reading.originalSource}
                    </Field>
                  )}
                  <Field k="Predicted class">
                    <ClassTag cls={reading.predicted} />
                  </Field>
                  <Field k="Confidence">
                    <span className="tnum">{fmtConf(reading.confidence)}</span>
                    <span className="ml-2 text-[12px] text-ink-3">threshold {fmtConf(threshold, 0)}</span>
                  </Field>
                  {reading.groundTruth && (
                    <Field k="Ground truth (label)">
                      <ClassTag cls={reading.groundTruth} />
                      {reading.groundTruth !== reading.predicted && <span className="ml-2 text-[12px] text-amber">disagrees with prediction</span>}
                    </Field>
                  )}
                  {reading.originalSource && !reading.groundTruth && <Field k="Ground truth (label)">Unavailable</Field>}
                  {reading.threat != null && (
                    <Field k="Threat score">
                      <span className="tnum">{fmtConf(reading.threat)}</span>
                    </Field>
                  )}
                  {reading.latencyMs != null && (
                    <Field k="Processing latency">
                      <span className="tnum">{reading.latencyMs} ms</span>
                    </Field>
                  )}
                  <Field k="Sequence" mono>
                    {reading.seq}
                  </Field>
                </dl>

                <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Incident association</h3>
                <div className="rounded-[8px] border border-divider bg-panel px-3 py-2.5 text-[13px]">
                  {reading.incidentId ? (
                    <Link href={`/incidents/${encodeURIComponent(reading.incidentId)}?at=${reading.ts}&reading=${encodeURIComponent(reading.id)}`} className="inline-flex items-center gap-1 font-mono text-rose hover:underline" data-testid="link-inspector-incident">
                      {reading.incidentId} <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-ink-2">Not associated with an incident</span>
                  )}
                  {reading.decision ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{reading.decision}</p> : <p className="mt-1 text-[12.5px] text-ink-3">{isNominal(reading.predicted) ? 'No entry-decision event; nominal readings are not evaluated for escalation.' : 'No entry-decision event received for this reading.'}</p>}
                </div>

                <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Features</h3>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11.5px] text-ink-3">
                      <th className="pb-1.5 font-medium">Key</th>
                      <th className="pb-1.5 text-right font-medium">Value</th>
                      <th className="pb-1.5 pl-3 font-medium">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {features.map((f) => (
                      <tr key={f.key} className="border-t border-divider/70">
                        <td className="py-1.5 font-mono text-[12px] text-info-ink">{f.key}</td>
                        <td className="py-1.5 text-right tnum text-ink">{reading.features[f.key] == null ? <span className="text-amber">missing</span> : fmtValue(reading.features[f.key], f)}</td>
                        <td className="py-1.5 pl-3 text-ink-3">{fmtUnit(f)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {reading.raw !== undefined && (
                  <div className="mt-5">
                    <RawBlock title="Raw source row" data={reading.raw} />
                  </div>
                )}

                {reading.probabilities && (
                  <>
                    <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Class probabilities</h3>
                    <ul className="space-y-1.5">
                      {(Object.entries(reading.probabilities) as [ClassLabel, number][]).map(([k, v]) => (
                        <li key={k} className="grid grid-cols-[130px_1fr_56px] items-center gap-2 text-[12.5px]">
                          <span className="text-ink-2">{CLASS_LABEL[k]}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                            <span className="block h-full rounded-full" style={{ width: `${v * 100}%`, background: k === reading.predicted ? 'var(--color-info)' : 'var(--color-support)' }} />
                          </span>
                          <span className="text-right tnum text-ink">{fmtConf(v)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-5">
                  <RawBlock title="Reading payload" data={reading} />
                </div>
              </div>
              {showTelemetryLink && (
                <div className="border-t border-divider px-5 py-3">
                  <Link href={`/telemetry?reading=${encodeURIComponent(reading.id)}&at=${reading.ts}`} className="inline-flex items-center gap-1 text-[13px] text-lav hover:underline" data-testid="link-inspector-telemetry">
                    Open in Telemetry at {fmtDateTime(reading.ts).slice(11)} <ArrowUpRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="p-6">
              <Dialog.Title className="text-ink">Reading not found</Dialog.Title>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
