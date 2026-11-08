import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowDown, ArrowUp, CircleCheck, Search, SearchX } from 'lucide-react';
import { Btn, ClassTag, Empty, LifecycleBadge, NativeSelect, PageHeader, Panel, PanelHead, ReportBadge, Skel } from '@/components/kit';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, isNominal, fmtConf, fmtTime } from '@/lib/sentinel/format';
import { useSentinel } from '@/lib/sentinel/store';
import type { Incident } from '@/lib/sentinel/types';

type SortKey = 'firstSeen' | 'lastSeen' | 'readings' | 'confidence';

export default function Incidents() {
  const s = useSentinel();
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [life, setLife] = useState('all');
  const [cls, setCls] = useState('all');
  const [report, setReport] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'firstSeen', dir: 'desc' });

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    const v = (i: Incident) => (sort.key === 'firstSeen' ? i.firstSeen : sort.key === 'lastSeen' ? i.lastSeen : sort.key === 'readings' ? i.rowCount ?? i.readingIds.length : i.peakConfidence);
    return s.incidents
      .filter((i) => (life === 'all' || i.lifecycle === life) && (cls === 'all' || i.cls === cls) && (report === 'all' || i.report.status === report) && (origin === 'all' || i.origin === origin))
      .filter((i) => !n || i.id.toLowerCase().includes(n) || i.cls.toLowerCase().includes(n) || i.readingIds.some((r) => r.includes(n)) || (i.runId ?? '').toLowerCase().includes(n))
      .sort((a, b) => (v(a) - v(b)) * (sort.dir === 'asc' ? 1 : -1) || a.id.localeCompare(b.id));
  }, [s.incidents, q, life, cls, report, origin, sort]);

  const active = q || life !== 'all' || cls !== 'all' || report !== 'all' || origin !== 'all';
  const reset = () => {
    setQ('');
    setLife('all');
    setCls('all');
    setReport('all');
    setOrigin('all');
  };
  const Head = ({ k, children }: { k: SortKey; children: string }) => (
    <th className={cn('px-3 py-2 font-medium', (k === 'readings' || k === 'confidence') && 'text-right')} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className={cn('inline-flex items-center gap-1 hover:text-ink', sort.key === k && 'text-ink')} onClick={() => setSort((p) => (p.key === k ? { key: k, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' }))} data-testid={`button-sort-${k}`}>
        {children}
        {sort.key === k && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="animate-in fade-in-0 duration-150">
      <PageHeader title="Incidents" subtitle="Triage list. Lifecycle (open, closed) and report generation are tracked separately." />
      <Panel className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-5">
        <label className="relative inline-flex items-center">
          <span className="sr-only">Search incidents</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 size-3.5 text-ink-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Incident, reading or run ID"
            className="h-8 w-[230px] rounded-[9px] border border-divider-strong bg-raised pl-8 pr-2.5 text-[12.5px] text-ink placeholder:text-ink-3 focus-visible:border-lav"
            data-testid="input-search-incidents"
          />
        </label>
        <NativeSelect label="Lifecycle" value={life} onChange={(e) => setLife(e.target.value)} data-testid="select-lifecycle">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </NativeSelect>
        <NativeSelect label="Class" value={cls} onChange={(e) => setCls(e.target.value)} data-testid="select-incident-class">
          <option value="all">All</option>
          {[...new Set([...(s.config?.classes ?? []), ...s.incidents.map((i) => i.cls)])].filter((c) => !isNominal(c)).map((c) => (
            <option key={c} value={c}>
              {CLASS_LABEL[c]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect label="Report" value={report} onChange={(e) => setReport(e.target.value)} data-testid="select-report">
          <option value="all">All</option>
          <option value="ready">Ready</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="unavailable">Not yet requested</option>
        </NativeSelect>
        <NativeSelect label="Origin" value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="select-origin">
          <option value="all">All</option>
          <option value="downlink">{s.config?.mode === 'connected' ? 'Backend replay' : 'Downlink'}</option>
          <option value="threat-lab">Threat Lab</option>
        </NativeSelect>
        <Btn size="sm" variant="ghost" disabled={!active} onClick={reset} data-testid="button-reset-incident-filters">
          Reset filters
        </Btn>
      </Panel>
      <Panel>
        <PanelHead title="Incident list" meta={<span className="tnum" data-testid="text-incident-count">{rows.length} of {s.incidents.length} incidents · sorted by {sort.key === 'firstSeen' ? 'first seen' : sort.key === 'lastSeen' ? 'last seen' : sort.key === 'readings' ? 'reading count' : 'peak confidence'}, ties by ID</span>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead>
              <tr className="border-b border-divider text-left text-[12px] text-ink-3">
                <th className="px-4 py-2 font-medium">Incident</th>
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Lifecycle</th>
                <Head k="firstSeen">First seen (UTC)</Head>
                <Head k="lastSeen">Last seen (UTC)</Head>
                <Head k="readings">Readings</Head>
                <Head k="confidence">Peak conf.</Head>
                <th className="px-4 py-2 font-medium">Report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b border-divider/60 last:border-0 hover:bg-hover" onClick={() => navigate(`/incidents/${i.id}`)} data-testid={`row-incident-${i.id}`}>
                  <td className="px-4 py-2.5">
                    <button className="font-mono text-[12.5px] text-ink hover:text-lav" onClick={(e) => (e.stopPropagation(), navigate(`/incidents/${i.id}`))} data-testid={`link-incident-${i.id}`}>
                      {i.id}
                    </button>
                    {i.origin === 'threat-lab' && <span className="ml-2 rounded-[4px] border border-amber/30 px-1 text-[10.5px] text-amber">Simulation</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <ClassTag cls={i.cls} />
                  </td>
                  <td className="px-3 py-2.5">
                    <LifecycleBadge lifecycle={i.lifecycle} />
                  </td>
                  <td className="px-3 py-2.5 tnum text-ink-2">{fmtTime(i.firstSeen)}</td>
                  <td className="px-3 py-2.5 tnum text-ink-2">{fmtTime(i.lastSeen)}</td>
                  <td className="px-3 py-2.5 text-right tnum" title={i.rowCount != null ? `${i.rowCount} rows recorded by source; ${i.readingIds.filter((r) => s.readingIndex.has(r)).length} in client buffer` : undefined}>{i.rowCount ?? i.readingIds.length}</td>
                  <td className="px-3 py-2.5 text-right tnum">{fmtConf(i.peakConfidence)}</td>
                  <td className="px-4 py-2.5">
                    <ReportBadge status={i.report.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.status === 'loading' && (
            <div className="space-y-2 p-5">
              <Skel className="h-8" />
              <Skel className="h-8" />
            </div>
          )}
          {s.status === 'ready' && s.incidents.length === 0 && <Empty icon={CircleCheck} title="No incidents" body="No detection has crossed the 3-reading rule in this session." />}
          {s.status === 'ready' && s.incidents.length > 0 && rows.length === 0 && (
            <Empty icon={SearchX} title="No incidents match these filters">
              <Btn size="sm" variant="secondary" onClick={reset}>
                Reset filters
              </Btn>
            </Empty>
          )}
        </div>
      </Panel>
    </div>
  );
}
