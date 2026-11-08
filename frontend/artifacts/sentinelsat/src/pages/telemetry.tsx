import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Crosshair, Search, SearchX } from 'lucide-react';
import { Btn, Empty, NativeSelect, PageHeader, Panel, PanelHead, PredictionCell, Segmented, Skel } from '@/components/kit';
import { ChartLegend, TelemetryChart } from '@/components/telemetry-chart';
import { ReadingInspector } from '@/components/reading-inspector';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, isNominal, fmtConf, fmtInt, fmtTime, fmtValue } from '@/lib/sentinel/format';
import { useSentinel } from '@/lib/sentinel/store';
import type { Reading } from '@/lib/sentinel/types';
import { useBackend } from '@/lib/backend/context';
import { normalizeData } from '@/lib/backend/normalize';

type SortKey = 'ts' | 'confidence' | 'latency';
const PAGE = 50;
const WINDOWS = ['2', '5', '10', '15'] as const;

export default function Telemetry() {
  const s = useSentinel();
  const { data: backendData, evidence, evidenceDecisions } = useBackend();
  const retainedRows = useMemo(() => backendData && evidence.size
    ? normalizeData({ ...backendData, recent: [...evidence.values()],
      decisions: new Map([...evidenceDecisions, ...backendData.decisions]) }).readings : [],
    [backendData, evidence, evidenceDecisions]);
  const [, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const paramReading = search.get('reading');

  const [featureKey, setFeatureKey] = useState('rf_snr');
  const [source, setSource] = useState('all');
  const [cls, setCls] = useState('all');
  const [q, setQ] = useState('');
  const [win, setWin] = useState('5');
  const [anchor, setAnchor] = useState<number | null>(null); // null = follow latest
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'ts', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const handledParam = useRef<string | null>(null);

  const features = s.config?.features ?? [];
  const classes = s.config?.classes ?? [];
  const origSources = useMemo(() => [...new Set(s.readings.map((r) => r.originalSource).filter((x): x is string => !!x))].sort(), [s.readings]);
  const feature = features.find((f) => f.key === featureKey) ?? features[0];
  const latest = s.readings[s.readings.length - 1];
  const winMs = Number(win) * 60_000;
  const end = anchor ?? latest?.ts ?? 0;
  const range: [number, number] = [end - winMs, end];

  // deep link: /telemetry?reading=rd-…&at=…
  useEffect(() => {
    if (!paramReading || handledParam.current === paramReading || s.status !== 'ready') return;
    const r = s.readingIndex.get(paramReading) ?? retainedRows.find(row => row.id === paramReading);
    handledParam.current = paramReading;
    if (!r) return;
    setSelectedId(r.id);
    setInspectorOpen(true);
    const lt = s.readings[s.readings.length - 1]?.ts ?? r.ts;
    setAnchor(Math.min(lt, r.ts + winMs / 2));
  }, [paramReading, s.status, s.readingIndex, s.readings, winMs, retainedRows]);

  const inWindow = useMemo(() => s.readings.filter((r) => r.ts >= range[0] && r.ts <= range[1]), [s.readings, range[0], range[1]]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inWindow.filter((r) => {
      if (source !== 'all' && (source.startsWith('orig:') ? (r.originalSource ?? '') !== source.slice(5) : r.source !== source)) return false;
      if (cls === 'flagged' && isNominal(r.predicted)) return false;
      if (cls === 'nominal' && !isNominal(r.predicted)) return false;
      if (cls !== 'all' && cls !== 'flagged' && cls !== 'nominal' && r.predicted !== cls) return false;
      if (needle && !(r.id.includes(needle) || (r.incidentId ?? '').toLowerCase().includes(needle) || (r.runId ?? '').toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [inWindow, source, cls, q]);
  const sorted = useMemo(() => {
    const v = (r: Reading) => (sort.key === 'ts' ? r.seq : sort.key === 'confidence' ? r.confidence : r.latencyMs ?? -1);
    return [...filtered].sort((a, b) => (v(a) - v(b)) * (sort.dir === 'asc' ? 1 : -1) || b.seq - a.seq);
  }, [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const rows = sorted.slice(pg * PAGE, pg * PAGE + PAGE);
  const newSinceHold = anchor != null ? s.readings.filter((r) => r.ts > anchor).length : 0;
  const filtersActive = source !== 'all' || cls !== 'all' || q !== '';

  const holdHere = () => {
    if (anchor == null && latest) setAnchor(latest.ts);
  };
  const select = (r: Reading, open = true) => {
    holdHere();
    setSelectedId(r.id);
    const idx = sorted.findIndex((x) => x.id === r.id);
    if (idx >= 0) setPage(Math.floor(idx / PAGE));
    if (open) setInspectorOpen(true);
  };
  const toggleSort = (key: SortKey) => {
    setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    setPage(0);
  };
  const resetFilters = () => {
    setSource('all');
    setCls('all');
    setQ('');
    setPage(0);
  };
  const pan = (dir: -1 | 1) => {
    const first = s.readings[0]?.ts ?? 0;
    const next = Math.max(first + winMs * 0.5, end + (dir * winMs) / 2);
    if (latest && next >= latest.ts) setAnchor(null);
    else setAnchor(next);
    setPage(0);
  };

  const liveSel = selectedId ? s.readingIndex.get(selectedId) ?? retainedRows.find(row => row.id === selectedId) ?? null : null;
  const snapRef = useRef<Reading | null>(null);
  if (liveSel) snapRef.current = liveSel;
  else if (snapRef.current?.id !== selectedId) snapRef.current = null;
  const selected = liveSel ?? snapRef.current;
  const selectedVisible = selectedId ? rows.some((r) => r.id === selectedId) : false;

  const SortHead = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <th className={cn('px-3 py-2 font-medium', right && 'text-right')} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => toggleSort(k)} className={cn('inline-flex items-center gap-1 hover:text-ink', sort.key === k && 'text-ink')} data-testid={`button-sort-${k}`}>
        {children}
        {sort.key === k && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="animate-in fade-in-0 duration-150">
      <PageHeader title="Telemetry" subtitle="Stream and replay workspace. Filters apply to the table; the plot always shows the full channel." />

      <Panel className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-5">
        {feature && (
          <NativeSelect label="Channel" value={feature.key} onChange={(e) => setFeatureKey(e.target.value)} data-testid="select-channel">
            {features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        )}
        <NativeSelect label="Source" value={source} onChange={(e) => (setSource(e.target.value), setPage(0))} data-testid="select-source">
          <option value="all">All sources</option>
          <option value="downlink">{origSources.length ? 'Replay (all)' : 'Downlink'}</option>
          <option value="threat-lab">Threat Lab</option>
          {origSources.map((o) => (
            <option key={o} value={`orig:${o}`}>
              {o}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect label="Prediction" value={cls} onChange={(e) => (setCls(e.target.value), setPage(0))} data-testid="select-class">
          <option value="all">All classes</option>
          <option value="flagged">Any non-nominal</option>
          <option value="nominal">{CLASS_LABEL[classes.find((c) => isNominal(c)) ?? 'nominal']}</option>
          {classes.filter((c) => !isNominal(c)).map((c) => (
            <option key={c} value={c}>
              {CLASS_LABEL[c]}
            </option>
          ))}
        </NativeSelect>
        <label className="relative inline-flex items-center">
          <span className="sr-only">Search entry, incident or run ID</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 size-3.5 text-ink-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => (setQ(e.target.value), setPage(0))}
            placeholder="rd-000245, INC-0417, SIM-…"
            className="h-8 w-[220px] rounded-[9px] border border-divider-strong bg-raised pl-8 pr-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus-visible:border-lav"
            data-testid="input-search-telemetry"
          />
        </label>
        <Segmented label="Visible range" value={win} onChange={(v) => (setWin(v), setPage(0))} options={WINDOWS.map((w) => ({ value: w, label: `${w}m` }))} />
        <Btn size="sm" variant="ghost" onClick={resetFilters} disabled={!filtersActive} data-testid="button-reset-filters">
          Reset filters
        </Btn>
      </Panel>

      <Panel className="mb-4" aria-labelledby="tchart-h">
        <PanelHead
          id="tchart-h"
          title={feature ? `${feature.label}` : 'Channel'}
          meta={
            latest ? (
              <span className="tnum">
                {fmtTime(range[0])} – {fmtTime(range[1])} UTC · {fmtInt(inWindow.length)} readings in range
              </span>
            ) : (
              'Waiting for telemetry'
            )
          }
        >
          <Btn size="sm" variant="ghost" aria-label="Pan earlier" onClick={() => pan(-1)} data-testid="button-pan-earlier">
            <ChevronLeft className="size-4" aria-hidden /> Earlier
          </Btn>
          <Btn size="sm" variant="ghost" aria-label="Pan later" onClick={() => pan(1)} disabled={anchor == null} data-testid="button-pan-later">
            Later <ChevronRight className="size-4" aria-hidden />
          </Btn>
          <span className="mx-1 h-5 w-px bg-divider" aria-hidden />
          <span className="text-[12px] text-ink-3" data-testid="status-follow">
            Chart: {anchor == null ? <span className="text-mint">following latest</span> : <span className="text-amber">holding position</span>}
          </span>
          {anchor == null ? (
            <Btn size="sm" variant="secondary" onClick={holdHere} data-testid="button-hold">
              Hold
            </Btn>
          ) : (
            <Btn size="sm" variant="primary" onClick={() => (setAnchor(null), setPage(0))} data-testid="button-return-latest">
              <Crosshair className="size-3.5" aria-hidden /> Return to latest{newSinceHold ? ` · ${newSinceHold} new` : ''}
            </Btn>
          )}
        </PanelHead>
        <div className="px-2 pt-3 pb-2 md:px-3">
          {!feature || s.status === 'loading' ? (
            <Skel className="mx-2 h-[320px]" />
          ) : (
            <TelemetryChart
              label={`${feature.label} plot, ${win}-minute range`}
              readings={s.readings}
              feature={feature}
              incidents={s.incidents}
              range={range}
              selectedId={selectedId}
              threshold={s.config!.threshold}
              height={320}
              onInspect={(r) => setHoverId(r?.id ?? null)}
              onSelectReading={(r) => select(r)}
              onSelectIncident={(inc) => navigate(`/incidents/${inc.id}?at=${inc.firstSeen}`)}
            />
          )}
        </div>
        <div className="border-t border-divider px-4 py-2.5 md:px-5">
          <ChartLegend downsampled={inWindow.length > 400} />
        </div>
      </Panel>

      <Panel aria-labelledby="ttable-h">
        <PanelHead
          id="ttable-h"
          title="Readings"
          meta={
            <span className="tnum" data-testid="text-row-count">
              {sorted.length ? `Showing ${pg * PAGE + 1}–${Math.min(sorted.length, (pg + 1) * PAGE)} of ${fmtInt(sorted.length)} matching` : '0 matching'} · {fmtInt(inWindow.length)} in range · {fmtInt(s.readings.length)} in {s.config?.bufferSize ?? 900}-reading client buffer · {fmtInt(s.stats?.totalReceived ?? 0)} received in stream
            </span>
          }
        >
          {selected && !selectedVisible && (
            <Btn size="sm" variant="ghost" onClick={() => select(selected, false)} data-testid="button-jump-selected">
              Jump to {selected.id}
            </Btn>
          )}
        </PanelHead>
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="sticky top-0 z-[1] bg-panel">
              <tr className="border-b border-divider text-left text-[12px] text-ink-3">
                <SortHead k="ts">Time (UTC)</SortHead>
                <th className="px-3 py-2 font-medium">Entry ID</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Predicted class</th>
                <SortHead k="confidence" right>
                  Confidence
                </SortHead>
                {feature && <th className="px-3 py-2 text-right font-medium">{feature.key}</th>}
                <SortHead k="latency" right>
                  Latency
                </SortHead>
                <th className="px-4 py-2 font-medium">Incident</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sel = r.id === selectedId;
                return (
                  <tr
                    key={r.id}
                    aria-selected={sel}
                    onClick={() => select(r)}
                    className={cn(
                      'cursor-pointer border-b border-divider/60 transition-colors duration-150',
                      sel ? 'bg-sky shadow-[inset_3px_0_0_var(--color-action)]' : r.id === hoverId ? 'bg-hover' : 'hover:bg-hover',
                    )}
                    data-testid={`row-reading-${r.id}`}
                  >
                    <td className="px-3 py-1.5 tnum text-ink-2">{fmtTime(r.ts)}</td>
                    <td className="px-3 py-1.5">
                      <button onClick={(e) => (e.stopPropagation(), select(r))} className="font-mono text-[12.5px] text-ink hover:text-lav" data-testid={`button-reading-${r.id}`}>
                        {r.id}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{r.source === 'threat-lab' ? <span className="text-amber">Threat Lab</span> : r.originalSource ?? 'Downlink'}</td>
                    <td className="px-3 py-1.5">
                      <PredictionCell cls={r.predicted} confidence={r.confidence} threshold={s.config?.threshold} />
                    </td>
                    <td className="px-3 py-1.5 text-right tnum">{fmtConf(r.confidence)}</td>
                    {feature && <td className="px-3 py-1.5 text-right tnum text-ink-2">{r.features[feature.key] == null ? <span className="text-amber">missing</span> : fmtValue(r.features[feature.key], feature)}</td>}
                    <td className="px-3 py-1.5 text-right tnum text-ink-2">{r.latencyMs != null ? `${r.latencyMs} ms` : '—'}</td>
                    <td className="px-4 py-1.5">
                      {r.incidentId ? (
                        <Link href={`/incidents/${r.incidentId}?at=${r.ts}&reading=${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12.5px] text-rose hover:underline">
                          {r.incidentId}
                        </Link>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {s.status === 'ready' && rows.length === 0 && (
            inWindow.length === 0 ? (
              <Empty title="Waiting for telemetry" body="No readings fall inside this visible range. Pan later or return to latest." />
            ) : (
              <Empty icon={SearchX} title="No readings match these filters" body={`${fmtInt(inWindow.length)} readings are in range but none match.`}>
                <Btn size="sm" variant="secondary" onClick={resetFilters}>
                  Reset filters
                </Btn>
              </Empty>
            )
          )}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-divider px-4 py-2 text-[12.5px] text-ink-3">
            <span className="tnum">
              Page {pg + 1} of {pages}
            </span>
            <Btn size="sm" variant="ghost" aria-label="Previous page" disabled={pg === 0} onClick={() => (holdHere(), setPage(pg - 1))} data-testid="button-page-prev">
              <ChevronLeft className="size-4" aria-hidden />
            </Btn>
            <Btn size="sm" variant="ghost" aria-label="Next page" disabled={pg >= pages - 1} onClick={() => (holdHere(), setPage(pg + 1))} data-testid="button-page-next">
              <ChevronRight className="size-4" aria-hidden />
            </Btn>
          </div>
        )}
      </Panel>

      <ReadingInspector
        reading={selected}
        open={inspectorOpen && !!selected}
        onOpenChange={setInspectorOpen}
        onNavigate={(r) => select(r)}
        showTelemetryLink={false}
      />
    </div>
  );
}
