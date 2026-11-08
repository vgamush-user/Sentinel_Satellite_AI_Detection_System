import { useEffect, useMemo, useState } from 'react';
import { useQueryState } from '@/hooks/use-query-state';
import { resolveReading } from '@/lib/sentinel/evidence';
import { chronological } from '@/lib/sentinel/chart-model';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowUpRight, CircleAlert, CircleDashed, FileText, Loader2, RotateCcw } from 'lucide-react';
import { Btn, ClassTag, Empty, ErrorNote, Field, LifecycleBadge, NativeSelect, PageHeader, Panel, PanelHead, RawBlock, ReportBadge, Skel } from '@/components/kit';
import { ChartLegend, TelemetryChart } from '@/components/telemetry-chart';
import { ReadingInspector } from '@/components/reading-inspector';
import { ReportProse } from '@/components/report-prose';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, fmtConf, fmtDateTime, fmtDuration, fmtTime, fmtValue } from '@/lib/sentinel/format';
import { useAdapter, useSentinel } from '@/lib/sentinel/store';
import { useBackend } from '@/lib/backend/context';
import type { Incident, IncidentEvent, Reading } from '@/lib/sentinel/types';

type Ext = Incident & { rowCount?: number; meanConfidence?: number; groundTruth?: string | null; closeReason?: string | null; spartaText?: string | null; mitigationText?: string | null; raw?: unknown };

const KEY_FEATURE: Record<string, string> = { jamming: 'rf_snr', spoofing: 'gyro_rate', command_injection: 'cmd_rate' };

const EVENT_TONE: Record<IncidentEvent['kind'], string> = {
  trigger: 'bg-amber',
  opened: 'bg-rose',
  peak: 'bg-rose',
  closed: 'bg-ink-2',
  report_pending: 'bg-amber',
  report_ready: 'bg-mint',
  report_failed: 'bg-rose',
  report_retry: 'bg-lav',
};

function ReportSection({ inc }: { inc: Incident }) {
  const adapter = useAdapter();
  const { client } = useBackend();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = inc.report;
  if (r.status === 'unavailable' || r.status === 'unknown')
    return <Empty icon={CircleDashed} title="Report unavailable" body={inc.lifecycle === 'open' ? 'This incident is open. The source has not supplied a report.' : 'The source has not supplied an available report for this incident.'} />;
  if (r.status === 'pending')
    return <Empty icon={Loader2} title="Report generation pending" body={`Requested at ${r.requestedAt ? fmtTime(r.requestedAt) : '—'} UTC. ${client ? 'Generation is managed by the backend; updates arrive with the connection.' : 'The report advances with sample replay playback.'}`} />;
  if (r.status === 'failed')
    return (
      <div className="space-y-3 p-5">
        <ErrorNote>{r.error ?? 'Report generation failed.'}</ErrorNote>
        {client ? (
          <p className="text-[12.5px] text-ink-3">The connected backend does not provide a report retry endpoint, so retry is unavailable here.</p>
        ) : (
        <Btn
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await adapter.retryReport(inc.id);
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Retry failed');
            } finally {
              setBusy(false);
            }
          }}
          data-testid="button-retry-report"
        >
          <RotateCcw className="size-3.5" aria-hidden /> {busy ? 'Requesting…' : 'Retry report generation'}
        </Btn>
        )}
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    );
  return (
    <div className="px-5 py-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3" data-testid="text-report-provenance">
        <span className="inline-flex items-center gap-1.5 text-mint">
          <FileText className="size-3.5" aria-hidden /> Report ready
        </span>
        <span>Generated {r.generatedAt ? fmtDateTime(r.generatedAt) : '—'}</span>
        <span>Mode: {r.mode === 'cached' ? 'served from report cache' : r.mode === 'live' ? 'live agent generation' : client ? 'not supplied by backend' : 'sample template generator'}</span>
        <span>Rendered as plain text with a safe Markdown subset</span>
      </div>
      <article>
        <ReportProse body={r.body ?? ''} />
      </article>
    </div>
  );
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const s = useSentinel();
  const [, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const parsedAt = Number(search.get('at'));
  const atParam = Number.isFinite(parsedAt) && parsedAt > 0 ? parsedAt : null;
  const fromReading = search.get('reading');
  const [tab, setTab] = useQueryState('tab', fromReading ? 'readings' : 'timeline', v => ['timeline','readings','sparta','report'].includes(v));
  const [inspect, setInspect] = useState<Reading | null>(null);
  const inc = s.incidents.find((i) => i.id === id) as Ext | undefined;
  const backend = useBackend();
  const { client } = backend;
  const [detail, setDetail] = useState<{ busy: boolean; err: string | null }>({ busy: false, err: null });
  useEffect(() => {
    if (!client || !id) return;
    let live = true;
    setDetail({ busy: true, err: null });
    client
      .incident(id)
      .then(() => live && setDetail({ busy: false, err: null }))
      .catch((e) => live && setDetail({ busy: false, err: e instanceof Error ? e.message : 'Could not load stored incident detail.' }));
    return () => {
      live = false;
    };
  }, [client, id]);
  const [featureKey, setFeatureKey] = useQueryState('channel', '');

  useEffect(() => { setInspect(null); }, [id, s.epoch]);
  const evidenceIds = useMemo(() => inc ? [...new Set([...inc.triggerReadingIds, ...inc.readingIds,
    ...[...s.evidence.values()].filter(r => r.incidentId === inc.id).map(r => r.id),
    ...[...backend.evidence.keys()].filter(rid => resolveReading(rid, s, backend)?.incidentId === inc.id),
  ])] : [], [inc, s.evidence, backend.evidence, backend.evidenceDecisions]);
  const readings = useMemo(() => chronological(evidenceIds.map(rid => resolveReading(rid, s, backend)).filter((r): r is Reading => !!r)), [evidenceIds, s.readingIndex, s.evidence, backend.evidence, backend.evidenceDecisions]);
  const missingIds = evidenceIds.filter(rid => !resolveReading(rid, s, backend));

  if (s.status === 'loading')
    return (
      <div>
        <Skel className="mb-3 h-8 w-64" />
        <Skel className="h-64" />
      </div>
    );
  if (!inc && detail.busy)
    return (
      <div>
        <Skel className="mb-3 h-8 w-64" />
        <Skel className="h-64" />
      </div>
    );
  if (!inc)
    return (
      <div className="max-w-xl">
        <PageHeader title="Incident not found" />
        <ErrorNote>
          No incident with ID <span className="font-mono">{id}</span> exists in this session. {client ? (detail.err ? `Backend lookup failed: ${detail.err}` : 'The backend did not return it.') : 'It may have been cleared by a sample reset.'}
        </ErrorNote>
        <Link href="/incidents" className="mt-4 inline-block text-lav hover:underline">
          Back to incidents
        </Link>
      </div>
    );

  const features = s.config?.features ?? [];
  const feature = features.find((f) => f.key === (featureKey || KEY_FEATURE[inc.cls])) ?? features[0];
  const keyFeature = features.find((f) => f.key === KEY_FEATURE[inc.cls]) ?? features[0];
  const sparta = inc.sparta ?? [];
  const mitigations = inc.mitigations ?? [];
  const startTs = inc.firstSeen ?? readings[0]?.ts;
  const endTs = inc.closedAt ?? inc.lastSeen ?? readings[readings.length - 1]?.ts;
  const hasTime = startTs != null && endTs != null;
  const range: [number, number] = [(startTs ?? 0) - 45_000, (endTs ?? 0) + 30_000];
  const ctx = atParam ?? inc.firstSeen;
  const missing = missingIds.length;
  const chartReadings = chronological([...new Map([...s.readings, ...readings].map(r => [r.id, r])).values()]);

  return (
    <div className="">
      <Link href="/incidents" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink" data-testid="link-back-incidents">
        <ArrowLeft className="size-3.5" aria-hidden /> Incidents
      </Link>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-all font-mono text-[26px] font-medium tracking-[-0.01em] text-ink md:text-[30px]" data-testid="text-incident-id">
              {inc.id}
            </h1>
            <LifecycleBadge lifecycle={inc.lifecycle} />
            {inc.origin === 'threat-lab' && <span className="rounded-[5px] border border-amber/40 px-1.5 py-0.5 text-[12px] text-amber">Simulation · {inc.runId}</span>}
          </div>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            <ClassTag cls={inc.cls} /> <span className="text-ink-3">·</span> opened <span className="tnum text-ink">{fmtDateTime(inc.firstSeen)}</span>
            {inc.closedAt ? (
              <>
                {' '}
                · closed <span className="tnum text-ink">{fmtTime(inc.closedAt)} UTC</span> {inc.firstSeen != null && <>after {fmtDuration(inc.closedAt - inc.firstSeen)}</>}
              </>
            ) : (
              <> · still open, last seen {fmtTime(inc.lastSeen)} UTC</>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border border-divider bg-divider text-[12px]">
          <div className="bg-panel px-4 py-2">
            <dt className="text-ink-3">Readings</dt>
            <dd className="mt-0.5 text-[18px] font-medium tnum text-ink" title={inc.rowCount != null ? `${inc.rowCount} rows recorded by backend; ${readings.length} available in client buffer` : undefined} data-testid="text-incident-rows">
              {inc.rowCount ?? inc.readingIds.length}
              {inc.rowCount != null && <span className="ml-1 text-[11.5px] font-normal text-ink-3">{readings.length} in buffer</span>}
            </dd>
          </div>
          <div className="bg-panel px-4 py-2">
            <dt className="text-ink-3">Peak confidence</dt>
            <dd className="mt-0.5 text-[18px] font-medium tnum text-ink">{fmtConf(inc.peakConfidence)}</dd>
          </div>
          <div className="bg-panel px-4 py-2">
            <dt className="text-ink-3">Report</dt>
            <dd className="mt-1.5">
              <ReportBadge status={inc.report.status} />
            </dd>
          </div>
        </dl>
      </header>

      {atParam && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[8px] border border-lav/25 bg-lav/[0.06] px-3 py-2 text-[12.5px] text-ink-2" data-testid="text-time-context">
          <span className="size-1.5 rounded-full bg-lav" aria-hidden />
          Opened from time context <span className="tnum text-ink">{fmtDateTime(atParam)}</span>
          {fromReading && (
            <>
              {' '}
              via <span className="font-mono text-ink">{fromReading}</span>
            </>
          )}
          <Link href={`/?at=${atParam}`} className="ml-auto text-lav hover:underline">
            Overview at this time
          </Link>
        </div>
      )}

      {detail.err && (
        <div className="mb-4">
          <ErrorNote>Stored detail could not be merged: {detail.err}. Showing streamed state.</ErrorNote>
        </div>
      )}
      {feature && hasTime ? (
      <Panel className="mb-5">
        <PanelHead title="Evidence window" meta={<span className="tnum">{fmtTime(range[0])} – {fmtTime(range[1])} UTC · dashed line marks the selected time context</span>}>
          <NativeSelect label="Channel" value={feature.key} onChange={(e) => setFeatureKey(e.target.value)} data-testid="select-incident-channel">
            {features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </PanelHead>
        <div className="px-2 pt-3 pb-2 md:px-3">
          <TelemetryChart
            label={`${feature.label} around ${inc.id}`}
            readings={chartReadings}
            feature={feature}
            incidents={s.incidents}
            range={range}
            contextTs={ctx}
            selectedId={inspect?.id ?? fromReading}
            threshold={s.config!.threshold}
            height={220}
            onSelectReading={setInspect}
            onSelectIncident={(i) => i.id !== inc.id && navigate(`/incidents/${encodeURIComponent(i.id)}?at=${i.firstSeen}`)}
          />
        </div>
        <div className="border-t border-divider px-4 py-2.5 md:px-5">
          <ChartLegend />
        </div>
      </Panel>
      ) : (
        <Panel className="mb-5">
          <Empty icon={CircleDashed} title="Evidence chart unavailable" body="The source has not supplied a channel and valid time bounds for this evidence window." />
        </Panel>
      )}

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label="Incident detail sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-divider">
          {[
            ['timeline', 'Timeline'],
            ['readings', `Trigger readings`],
            ['sparta', 'SPARTA context'],
            ['report', 'Report & mitigation'],
          ].map(([v, l]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="relative -mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink data-[state=active]:border-action data-[state=active]:text-ink"
              data-testid={`tab-${v}`}
            >
              {l}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="timeline" className="focus-visible:outline-none">
          <Panel>
            <PanelHead title="Timeline" meta={client ? 'Backend lifecycle and report events (UTC)' : 'Classification, lifecycle and report events in sample time (UTC)'} />
            <ol className="px-5 py-4">
              {inc.timeline.map((e, i) => (
                <li key={i} className="relative grid grid-cols-[76px_16px_1fr] gap-x-3 pb-4 last:pb-0">
                  <span className="pt-px text-right text-[12.5px] tnum text-ink-3">{fmtTime(e.ts)}</span>
                  <span className="relative flex justify-center">
                    <span className={cn('relative z-[1] mt-1.5 size-2 rounded-full', EVENT_TONE[e.kind])} aria-hidden />
                    {i < inc.timeline.length - 1 && <span className="absolute top-3 bottom-[-8px] w-px bg-divider" aria-hidden />}
                  </span>
                  <span className="text-[13px] text-ink">
                    {e.label}
                    {e.readingId && (
                      <button
                        disabled={!resolveReading(e.readingId!, s, backend)}
                         title={!resolveReading(e.readingId!, s, backend) ? 'Unavailable in client history' : undefined}
                         className="ml-2 font-mono text-[12px] text-lav hover:underline disabled:text-ink-3"
                        onClick={() => {
                          const r = resolveReading(e.readingId!, s, backend);
                          if (r) setInspect(r);
                        }}
                        data-testid={`button-timeline-reading-${i}`}
                      >
                        {e.readingId}{!resolveReading(e.readingId!, s, backend) && ' (unavailable in client history)'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="readings" className="focus-visible:outline-none">
          <Panel>
            <PanelHead title="Trigger and attached readings" meta={`${inc.triggerReadingIds.length} trigger readings opened the incident; ${Math.max(0, evidenceIds.length - inc.triggerReadingIds.length)} additional known reading IDs.${missing ? ` ${missing} are unavailable in client history.` : ''}`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-divider text-left text-[12px] text-ink-3">
                    <th className="px-5 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Entry ID</th>
                    <th className="px-3 py-2 font-medium">Time (UTC)</th>
                    <th className="px-3 py-2 font-medium">Predicted</th>
                    <th className="px-3 py-2 text-right font-medium">Confidence</th>
                    <th className="px-3 py-2 text-right font-medium font-mono">{keyFeature?.key ?? 'Feature'}</th>
                    <th className="px-5 py-2 font-medium">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {missingIds.map(rid => <tr key={rid}><td className="px-5 py-2" colSpan={7}><span className="font-mono">{rid}</span> � unavailable in client history</td></tr>)}
                  {readings.map((r) => {
                    const trig = inc.triggerReadingIds.includes(r.id);
                    return (
                      <tr key={r.id} className={cn('border-b border-divider/60 last:border-0', r.id === fromReading && 'bg-lav/[0.1]')} data-testid={`row-trigger-${r.id}`}>
                        <td className="px-5 py-2">{trig ? <span className="text-amber">Trigger</span> : <span className="text-ink-3">Attached</span>}</td>
                        <td className="px-3 py-2">
                          <button className="font-mono text-[12.5px] text-ink hover:text-lav" onClick={() => setInspect(r)} data-testid={`button-inspect-${r.id}`}>
                            {r.id}
                          </button>
                        </td>
                        <td className="px-3 py-2 tnum text-ink-2">{fmtTime(r.ts)}</td>
                        <td className="px-3 py-2">
                          <ClassTag cls={r.predicted} />
                        </td>
                        <td className="px-3 py-2 text-right tnum">{fmtConf(r.confidence)}</td>
                        <td className="px-3 py-2 text-right tnum">{keyFeature ? fmtValue(r.features[keyFeature.key], keyFeature) : '—'}</td>
                        <td className="px-5 py-2">
                          <Link href={`/telemetry?reading=${encodeURIComponent(r.id)}&at=${r.ts}`} className="inline-flex items-center gap-1 text-[12.5px] text-lav hover:underline">
                            Telemetry <ArrowUpRight className="size-3" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="sparta" className="focus-visible:outline-none">
          <Panel>
            <PanelHead title="SPARTA context" meta="Technique references attached by the detector for this class. Context for review, not attribution." />
            {inc.spartaText && (
              <div className="px-5 py-4">
                <ReportProse body={inc.spartaText} />
              </div>
            )}
            {!inc.spartaText && sparta.length === 0 && <Empty icon={CircleDashed} title="SPARTA mapping unavailable" body="The source did not supply SPARTA context for this incident. None is inferred." />}
            <ol className="divide-y divide-divider">
              {sparta.map((t) => (
                <li key={t.id} className="grid gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-[180px_1fr]">
                  <div>
                    <div className="font-mono text-[13px] text-lav">{t.id}</div>
                    <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{t.tactic}</div>
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-ink">{t.technique}</div>
                    <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">{t.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </Tabs.Content>

        <Tabs.Content value="report" className="focus-visible:outline-none">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel>
              <PanelHead title="Incident report" meta={<ReportBadge status={inc.report.status} />} />
              <ReportSection inc={inc} />
            </Panel>
            <div className="space-y-5">
              <Panel>
                <PanelHead title="Mitigation guidance" meta="Guidance to review. SentinelSat does not execute mitigations." />
                {inc.mitigationText && (
                  <div className="px-5 py-4">
                    <ReportProse body={inc.mitigationText} />
                  </div>
                )}
                {!inc.mitigationText && mitigations.length === 0 && <p className="px-5 py-4 text-[12.5px] text-ink-3">Policy outcome unavailable from the source. Nothing is fabricated.</p>}
                <ol className="space-y-3 px-5 py-4 empty:hidden">
                  {mitigations.map((m, i) => (
                    <li key={i} className="grid grid-cols-[22px_1fr] gap-2 text-[13px] leading-relaxed text-ink-2">
                      <span className="grid size-5 place-items-center rounded-full border border-divider text-[11px] tnum text-ink-3">{i + 1}</span>
                      {m}
                    </li>
                  ))}
                </ol>
              </Panel>
              <Panel>
                <PanelHead title="Record" />
                <dl className="px-5 py-2">
                  <Field k="Incident ID" mono>
                    {inc.id}
                  </Field>
                  <Field k="Class">{CLASS_LABEL[inc.cls] ?? inc.cls}</Field>
                  {inc.rowCount != null && <Field k="Rows (backend / buffer)">{inc.rowCount} / {readings.length}</Field>}
                  {inc.meanConfidence != null && <Field k="Mean confidence">{fmtConf(inc.meanConfidence)}</Field>}
                  {inc.groundTruth !== undefined && <Field k="Sample ground truth">{inc.groundTruth ?? 'Unavailable'}</Field>}
                  {inc.closeReason && <Field k="Close reason">{inc.closeReason}</Field>}
                  {client && <Field k="Feature attribution">Not supplied by source</Field>}
                  <Field k="Origin">{inc.origin === 'threat-lab' ? `Threat Lab${inc.runId ? ` ${inc.runId}` : ''}` : client ? 'Backend replay' : 'Downlink'}</Field>
                  <Field k="First seen">{fmtDateTime(inc.firstSeen)}</Field>
                  <Field k="Last seen">{fmtDateTime(inc.lastSeen)}</Field>
                </dl>
                <div className="px-5 pb-4">
                  <RawBlock title="Incident record" data={inc} />
                  {inc.raw !== undefined && (
                    <div className="mt-2">
                      <RawBlock title="Raw backend provenance" data={inc.raw} />
                    </div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
          {inc.report.status === 'failed' && (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
              <CircleAlert className="size-3.5" aria-hidden /> Failed reports do not change incident lifecycle.
            </p>
          )}
        </Tabs.Content>
      </Tabs.Root>

      <ReadingInspector navigationReadings={readings} reading={inspect ? resolveReading(inspect.id, s, backend) ?? inspect : null} open={!!inspect} onOpenChange={(o) => !o && setInspect(null)} onNavigate={setInspect} />
    </div>
  );
}
