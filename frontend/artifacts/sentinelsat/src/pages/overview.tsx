import { useEffect, useMemo, useState } from 'react';
import { useQueryState } from '@/hooks/use-query-state';
import { chronological } from '@/lib/sentinel/chart-model';
import { Link, useLocation, useSearch } from 'wouter';
import { Activity, ArrowRight, CircleCheck, Crosshair, Database, Radio, ShieldAlert, Timer } from 'lucide-react';
import { Btn, ClassTag, Empty, ErrorNote, Field, LifecycleBadge, NativeSelect, PageHeader, Panel, PanelHead, PredictionCell, ReportBadge, Segmented, Skel } from '@/components/kit';
import { ChartLegend, TelemetryChart } from '@/components/telemetry-chart';
import { ReadingInspector } from '@/components/reading-inspector';
import { CLASS_LABEL, fmtConf, fmtInt, fmtTime } from '@/lib/sentinel/format';
import { useRetryInit, useSentinel } from '@/lib/sentinel/store';
import { useBackend } from '@/lib/backend/context';
import type { Reading } from '@/lib/sentinel/types';

const WINDOWS = [2, 5, 10, 15] as const;

const TONES = {
  blue: { card: 'bg-sky border-sky-strong', chip: 'bg-palette-blue text-on-action', bar: 'bg-palette-blue' },
  yellow: { card: 'bg-sun border-sun-strong', chip: 'bg-palette-yellow text-ink', bar: 'bg-palette-yellow' },
  orange: { card: 'bg-peach border-peach-strong', chip: 'bg-palette-orange text-ink', bar: 'bg-palette-orange' },
  lime: { card: 'bg-leaf border-leaf-strong', chip: 'bg-palette-lime text-ink', bar: 'bg-palette-lime' },
} as const;

function Metric({ label, value, unit, scope, note, testid, tone, icon: Icon }: { label: string; value: string | null; unit?: string; scope: 'Cumulative' | 'Current'; note: string; testid: string; tone: keyof typeof TONES; icon: typeof Activity }) {
  const t = TONES[tone];
  return (
    <div className={`relative min-w-0 overflow-hidden rounded-[18px] border px-4 py-4 md:px-5 ${t.card}`}>
      <span aria-hidden className={`absolute -right-6 -top-6 size-20 rounded-full opacity-40 ${t.bar}`} />
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <span className={`grid size-7 place-items-center rounded-[9px] ${t.chip}`}>
            <Icon aria-hidden className="size-3.5" />
          </span>
          {label}
        </span>
        <span className="rounded-full bg-panel/80 px-2 py-px text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-2">{scope}</span>
      </div>
      <div className="relative mt-3 flex items-baseline gap-1.5" data-testid={testid}>
        <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tnum text-ink">{value ?? '—'}</span>
        {value != null && unit && <span className="text-[12.5px] text-ink-2">{unit}</span>}
      </div>
      <p className="relative mt-2 truncate text-[11.5px] text-ink-2" title={note}>
        {note}
      </p>
    </div>
  );
}

export default function Overview() {
  const s = useSentinel();
  const backend = useBackend();
  const bstats = backend.client ? backend.data?.stats ?? null : null;
  const retry = useRetryInit();
  const [, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const parsedAt = Number(search.get('at'));
  const atParam = Number.isFinite(parsedAt) && parsedAt > 0 ? parsedAt : null;
  const [win, setWin] = useQueryState('window', 5, v => [2,5,10,15].includes(v));
  const [featureKey, setFeatureKey] = useQueryState('channel', 'rf_snr');
  const [hold, setHold] = useQueryState<number | null>('end', null, v => v === null || typeof v === 'number' && Number.isFinite(v) && v > 0);
  const [inspect, setInspect] = useState<Reading | null>(null);

  useEffect(() => { if (atParam && Number.isFinite(atParam) && !search.has('end')) setHold(atParam + win * 30_000); }, [atParam]);
  useEffect(() => { setInspect(null); }, [s.epoch]);
  const ordered = useMemo(() => chronological(s.readings), [s.readings]);
  const features = s.config?.features ?? [];
  const feature = features.find((f) => f.key === featureKey) ?? features[0];
  const latest = ordered[ordered.length - 1];
  const earliest = ordered[0];
  const historyMs = latest && earliest ? latest.ts - earliest.ts : 0;
  const end = hold ?? latest?.ts ?? 0;
  const range: [number, number] = [end - win * 60_000, end];

  const openCount = s.incidents.filter((i) => i.lifecycle === 'open').length;
  const queue = useMemo(
    () => [...s.incidents].sort((a, b) => (a.lifecycle === b.lifecycle ? (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity) || a.id.localeCompare(b.id) : a.lifecycle === 'open' ? -1 : 1)).slice(0, 6),
    [s.incidents],
  );
  const latestInc = useMemo(() => [...s.incidents].sort((a, b) => (b.firstSeen ?? -Infinity) - (a.firstSeen ?? -Infinity))[0], [s.incidents]);
  const recent = s.readings.slice(-8).reverse();
  const newerThanHold = hold != null && latest ? s.readings.filter((r) => r.ts > hold).length : 0;

  if (s.status === 'error')
    return (
      <div className="max-w-xl">
        <PageHeader title="Mission overview" />
        <ErrorNote>
          Could not load initial state: {s.error}{' '}
          <button className="underline" onClick={retry}>
            Retry
          </button>
        </ErrorNote>
      </div>
    );

  const loading = s.status === 'loading' || !feature;

  return (
    <div className="">
      <PageHeader
        title="Mission overview"
        subtitle={
          backend.client ? (
            <>Connected backend stream. Counts, rates and accuracy come from backend session statistics; the chart shows the bounded client buffer.</>
          ) : (
            <>
              Sample demo replay of {s.config?.sourceName ?? 'the bus downlink'}. Readings, incidents and reports are generated deterministically in this browser.
            </>
          )
        }
      >
        <Segmented
          label="Time window"
          value={String(win)}
          onChange={(v) => setWin(Number(v))}
          options={WINDOWS.map((w) => ({ value: String(w), label: `${w}m`, disabled: historyMs < (w - 1) * 60_000, title: historyMs < (w - 1) * 60_000 ? 'Not enough history in the client window' : undefined }))}
        />
      </PageHeader>

      <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-[18px] border border-divider bg-panel px-5 py-4">
              <Skel className="h-3 w-24" />
              <Skel className="mt-3 h-6 w-20" />
            </div>
          ))
        ) : (
          <>
            <Metric label="Readings received" scope="Cumulative" value={s.stats ? fmtInt(s.stats.totalReceived) : null} note={backend.client ? `Backend session total · ${fmtInt(s.readings.length)} held in client window` : `Since replay start · ${fmtInt(s.readings.length)} held in client window`} testid="metric-readings" tone="blue" icon={Database} />
            <Metric label="Ingest rate" scope="Current" value={backend.client ? s.stats?.rowsPerSec == null ? null : String(s.stats.rowsPerSec) : s.stats?.ingestPerMin != null ? String(s.stats.ingestPerMin) : null} unit={backend.client ? '/s' : '/min'} note={backend.client ? 'Current throughput reported by the backend' : s.stats?.ingestPerMin != null ? `Latest 60 s of sample time · ${s.stats.droppedSamples} samples dropped overall` : 'Unavailable until 10 readings arrive'} testid="metric-ingest" tone="lime" icon={Activity} />
            <Metric label="Open incidents" scope="Current" value={String(openCount)} note={`Derived from incident state · ${s.incidents.length} total`} testid="metric-open-incidents" tone="orange" icon={ShieldAlert} />
            <Metric label="Median processing latency" scope="Current" value={s.stats?.medianLatencyMs != null ? String(Math.round(s.stats.medianLatencyMs)) : null} unit="ms" note={backend.client ? 'Backend-reported p50 processing latency' : s.stats?.medianLatencyMs != null ? 'Latest 60 readings that report latency' : 'No reading reported latency yet'} testid="metric-latency" tone="yellow" icon={Timer} />
          </>
        )}
      </section>

      {bstats && (
        <Panel className="mb-5" aria-labelledby="pipeline-h">
          <PanelHead id="pipeline-h" title="Pipeline health" meta={`Backend session statistics · agent mode ${backend.data?.config.agent_mode ?? 'unknown'}`} />
          <dl className="grid gap-x-6 px-5 py-2 sm:grid-cols-2" data-testid="panel-pipeline-health">
            <Field k="Kafka">{bstats.kafka_ok ? <span className="text-mint">Connected</span> : <span className="text-rose">Unavailable</span>}</Field>
            <Field k="Rows scored (session)">{fmtInt(bstats.rows_total)} · {bstats.rows_per_sec.toFixed(1)} rows/s</Field>
            <Field k="Session accuracy">{bstats.accuracy == null ? 'Unavailable (no labeled rows)' : `${fmtConf(bstats.accuracy)} of labeled rows`}</Field>
            <Field k="Last row age">{bstats.last_row_age_sec == null ? 'No rows yet' : `${bstats.last_row_age_sec.toFixed(1)} s`}</Field>
            <Field k="Replay dataset">{bstats.replay_dataset ?? 'Not reported'}</Field>
            <Field k="Median latency (p50)">{bstats.latency_p50_ms == null ? 'Not reported' : `${Math.round(bstats.latency_p50_ms)} ms`}</Field>
            <Field k="Predictions by class">{Object.entries(bstats.pred_counts).map(([k, v]) => `${k} ${fmtInt(v)}`).join(' · ') || 'None yet'}</Field>
            <Field k="Event counts">{Object.entries(bstats.counts).map(([k, v]) => `${k} ${fmtInt(v)}`).join(' · ') || 'None yet'}</Field>
          </dl>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Panel aria-labelledby="chart-h">
          <PanelHead
            id="chart-h"
            title="Telemetry and detections"
            meta={
              latest ? (
                <span className="tnum">
                  {fmtTime(range[0])} – {fmtTime(range[1])} UTC · {win}-minute window{hold != null ? ' · view held' : ' · following latest'}
                </span>
              ) : (
                'Waiting for telemetry'
              )
            }
          >
            {feature && (
              <NativeSelect label="Channel" value={feature.key} onChange={(e) => setFeatureKey(e.target.value)} data-testid="select-overview-channel">
                {features.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </NativeSelect>
            )}
            {hold == null ? (
              <Btn size="sm" variant="ghost" onClick={() => setHold(latest?.ts ?? null)} disabled={!latest} data-testid="button-hold-view">
                Hold view
              </Btn>
            ) : (
              <Btn size="sm" variant="secondary" onClick={() => setHold(null)} data-testid="button-return-latest">
                <Crosshair className="size-3.5" aria-hidden /> Return to latest{newerThanHold ? ` (+${newerThanHold})` : ''}
              </Btn>
            )}
          </PanelHead>
          <div className="px-2 pt-3 pb-2 md:px-3">
            {loading ? (
              <Skel className="mx-2 h-[300px]" />
            ) : (
              <TelemetryChart
                label={`${feature.label} over the ${win}-minute window with incident markers`}
                readings={s.readings}
                feature={feature}
                incidents={s.incidents}
                range={range}
                contextTs={atParam}
                threshold={s.config!.threshold}
                height={300}
                selectedId={inspect?.id}
                onInspectionStart={() => { if (hold == null && latest) setHold(latest.ts); }}
              onSelectReading={setInspect}
                onSelectIncident={(inc) => navigate(`/incidents/${encodeURIComponent(inc.id)}?at=${inc.firstSeen}`)}
              />
            )}
          </div>
          <div className="rounded-b-[16px] border-t border-divider bg-hover/50 px-4 py-2.5 md:px-5">
            <ChartLegend />
          </div>
        </Panel>

        <Panel aria-labelledby="queue-h" className="flex flex-col">
          <PanelHead id="queue-h" title="Active incidents" meta={`${openCount} open · ${s.incidents.length - openCount} closed in this session`}>
            <Link href="/incidents" className="text-[12.5px] text-lav hover:underline" data-testid="link-all-incidents">
              All incidents
            </Link>
          </PanelHead>
          {latestInc && (
            <div className="border-b border-divider bg-peach/70 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2 md:px-5" data-testid="text-latest-trigger">
              <span className="text-ink-3">Latest trigger · </span>
              <Link href={`/incidents/${encodeURIComponent(latestInc.id)}?at=${latestInc.firstSeen}`} className="font-mono text-rose hover:underline">
                {latestInc.id}
              </Link>{' '}
              opened at <span className="tnum text-ink">{fmtTime(latestInc.firstSeen)} UTC</span>{backend.client ? ` · Backend guard: ${s.config?.consecutive} of ${s.config?.windowRows} rows at ≥ ${fmtConf(s.config?.threshold)} confidence. ` : ` after ${latestInc.triggerReadingIds.length} consecutive ${CLASS_LABEL[latestInc.cls]} readings. `}
              {latestInc.triggerReadingIds[0] && <>First trigger{' '}<Link href={`/telemetry?reading=${encodeURIComponent(latestInc.triggerReadingIds[0])}&at=${latestInc.firstSeen}`} className="font-mono text-ink hover:text-lav hover:underline">
                {latestInc.triggerReadingIds[0]}
              </Link></>}
              .
            </div>
          )}
          {loading ? (
            <div className="space-y-3 p-5">
              <Skel className="h-10" />
              <Skel className="h-10" />
            </div>
          ) : queue.length === 0 ? (
            <Empty icon={CircleCheck} title="No incidents" body={backend.client ? `No incidents have been reported. Backend guards require ${backend.data?.config.guards.min_rows ?? '—'} of ${backend.data?.config.guards.window_rows ?? '—'} rows; see Pipeline health for connectivity.` : 'The feed is healthy. Incidents appear here when 3 consecutive readings cross the detection threshold.'} />
          ) : (
            <ul className="flex-1 divide-y divide-divider">
              {queue.map((inc) => (
                <li key={inc.id}>
                  <Link
                    href={`/incidents/${encodeURIComponent(inc.id)}?at=${inc.firstSeen}`}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-sun/60 md:px-5"
                    data-testid={`row-queue-${inc.id}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] text-ink">{inc.id}</span>
                      <ClassTag cls={inc.cls} />
                    </span>
                    <LifecycleBadge lifecycle={inc.lifecycle} />
                    <span className="text-[12px] tnum text-ink-3">Last seen {fmtTime(inc.lastSeen)} UTC · {inc.readingIds.length} readings</span>
                    <ReportBadge status={inc.report.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-5" aria-labelledby="recent-h">
        <PanelHead id="recent-h" title="Recent activity" meta="Latest 8 readings received">
          <Link href="/telemetry" className="inline-flex items-center gap-1 text-[12.5px] text-lav hover:underline" data-testid="link-telemetry">
            Open telemetry <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </PanelHead>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-divider bg-hover/60 text-left text-[12px] text-ink-2">
                <th className="px-5 py-2 font-medium">Time (UTC)</th>
                <th className="px-3 py-2 font-medium">Entry</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Prediction</th>
                <th className="px-3 py-2 text-right font-medium">Confidence</th>
                <th className="px-5 py-2 font-medium">Incident</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-ink-3">
                    <Radio className="mx-auto mb-2 size-4" aria-hidden /> Waiting for telemetry
                  </td>
                </tr>
              )}
              {recent.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-divider/60 last:border-0 hover:bg-sky/60" onClick={() => setInspect(r)}>
                  <td className="px-5 py-2 tnum text-ink-2">{fmtTime(r.ts)}</td>
                  <td className="px-3 py-2">
                    <button className="font-mono text-[12.5px] text-ink hover:text-lav" onClick={(e) => (e.stopPropagation(), setInspect(r))} data-testid={`button-inspect-${r.id}`}>
                      {r.id}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{r.source === 'threat-lab' ? <span className="text-amber">Threat Lab</span> : backend.client ? (r as Reading & { originalSource?: string }).originalSource ?? 'Replay' : 'Downlink'}</td>
                  <td className="px-3 py-2">
                    <PredictionCell cls={r.predicted} confidence={r.confidence} threshold={s.config?.threshold} />
                  </td>
                  <td className="px-3 py-2 text-right tnum">{fmtConf(r.confidence)}</td>
                  <td className="px-5 py-2">
                    {r.incidentId ? (
                      <Link href={`/incidents/${encodeURIComponent(r.incidentId)}?at=${r.ts}&reading=${encodeURIComponent(r.id)}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] text-rose hover:underline">
                        {r.incidentId}
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <ReadingInspector reading={inspect ? s.readingIndex.get(inspect.id) ?? inspect : null} open={!!inspect} onOpenChange={(o) => !o && setInspect(null)} onNavigate={setInspect} />
    </div>
  );
}
