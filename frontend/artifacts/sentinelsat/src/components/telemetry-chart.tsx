import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chronological, extremaIndices, sequenceGaps } from '@/lib/sentinel/chart-model';
import { CLASS_LABEL, isNominal, fmtConf, fmtTime, fmtUnit, fmtValue } from '@/lib/sentinel/format';
import type { FeatureDef, Incident, Reading } from '@/lib/sentinel/types';

interface Props {
  readings: Reading[];
  feature: FeatureDef;
  incidents: Incident[];
  range: [number, number];
  selectedId?: string | null;
  contextTs?: number | null;
  threshold: number;
  height?: number;
  onSelectReading?: (r: Reading) => void;
  onSelectIncident?: (inc: Incident) => void;
  onInspect?: (r: Reading | null) => void;
  onInspectionStart?: () => void;
  label: string;
}

const M = { l: 52, r: 14, t: 30, b: 26 };
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 1800].map((s) => s * 1000);

export function TelemetryChart({ readings, feature, incidents, range, selectedId, contextTs, threshold, height = 300, onSelectReading, onSelectIncident, onInspect, onInspectionStart, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<string | null>(null);
  const onInspectRef = useRef(onInspect);
  onInspectRef.current = onInspect;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(1, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [t0, t1] = range;
  const iw = Math.max(1, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const x = (ts: number) => M.l + ((ts - t0) / Math.max(1, t1 - t0)) * iw;

  const visible = useMemo(() => chronological(readings).filter((r) => r.ts >= t0 && r.ts <= t1), [readings, t0, t1]);

  const model = useMemo(() => {
    const vals = visible.map((r) => r.features[feature.key]).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    const scale = Math.max(1, ...vals.map(Math.abs));
    let lo = Math.min(...vals.map(v => v / scale));
    let hi = Math.max(...vals.map(v => v / scale));
    if (hi - lo < 1e-9) {
      lo -= 0.01;
      hi += 0.01;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
    // segments: break on missing value or dropped sequence
    const seg: number[] = [];
    const gaps = sequenceGaps(visible);
    let sid = 0;
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      const prev = visible[i - 1];
      if (prev && gaps.some(g => g.kind === 'dropped' && prev.ts <= g.from && r.ts >= g.to)) sid++;
      if (r.features[feature.key] == null || !Number.isFinite(r.features[feature.key])) {
        sid++;
        gaps.push({ from: (prev ?? r).ts, to: (visible[i + 1] ?? r).ts, kind: 'null' });
      }
      seg.push(sid);
    }
    return { lo, hi, scale, seg, gaps };
  }, [visible, feature.key, iw]);

  const y = (v: number) => (model ? M.t + (1 - (v / model.scale - model.lo) / (model.hi - model.lo)) * ih : 0);

  const kept = useMemo(() => extremaIndices(visible, feature.key, iw, selectedId), [visible, feature.key, iw, selectedId]);
  const path = useMemo(() => {
    if (!model) return '';
    let d = '';
    let prevSeg = -1;
    visible.forEach((r, i) => {
      const v = r.features[feature.key];
      const keep = kept.has(i) || !isNominal(r.predicted) || r.id === selectedId || i === visible.length - 1 || model.seg[i] !== model.seg[i - 1] || model.seg[i] !== model.seg[i + 1];
      if (v == null || !Number.isFinite(v) || !keep) return;
      const cmd = model.seg[i] === prevSeg ? 'L' : 'M';
      d += `${cmd}${x(r.ts).toFixed(1)},${y(v).toFixed(1)}`;
      prevSeg = model.seg[i];
    });
    return d;
    // x/y derive from these deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, model, kept, feature.key, selectedId, width, t0, t1, height]);

  const ticks = useMemo(() => {
    const span = t1 - t0;
    const st = TICK_STEPS.find((s) => span / s <= Math.max(3, Math.floor(iw / 110))) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const out: number[] = [];
    for (let t = Math.ceil(t0 / st) * st; t <= t1; t += st) out.push(t);
    return out;
  }, [t0, t1, iw]);

  const yTicks = model ? [0, 1, 2, 3].map((i) => Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, (model.lo + ((model.hi - model.lo) * (i + 0.5)) / 4) * model.scale))) : [];

  const shownIncidents = incidents.filter((i): i is Incident & { firstSeen: number; lastSeen: number } => i.firstSeen != null && i.lastSeen != null && i.firstSeen <= t1 && (i.closedAt ?? i.lastSeen) >= t0);

  const nearest = (ts: number) => {
    if (!visible.length) return null;
    let lo = 0;
    let hi = visible.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (visible[mid].ts < ts) lo = mid;
      else hi = mid;
    }
    return Math.abs(visible[lo].ts - ts) <= Math.abs(visible[hi].ts - ts) ? lo : hi;
  };

  const hovered = hover != null ? visible.find(r => r.id === hover) ?? null : null;
  useEffect(() => {
    onInspectRef.current?.(hovered ?? null);
  }, [hovered]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < M.l || px > width - M.r) return setHover(null);
    const index = nearest(t0 + ((px - M.l) / iw) * (t1 - t0));
    setHover(index == null ? null : visible[index].id);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !visible.length) return;
    const selIdx = selectedId ? visible.findIndex((r) => r.id === selectedId) : -1;
    const hoverIdx = hover == null ? -1 : visible.findIndex(r => r.id === hover);
    const cur = hoverIdx >= 0 ? hoverIdx : selIdx >= 0 ? selIdx : visible.length - 1;
    let next = cur;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - (e.shiftKey ? 10 : 1));
    else if (e.key === 'ArrowRight') next = Math.min(visible.length - 1, cur + (e.shiftKey ? 10 : 1));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visible.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (visible[cur]) onSelectReading?.(visible[cur]);
      return;
    } else if (e.key === 'Escape') {
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    onInspectionStart?.();
    setHover(visible[next].id);
  };

  const selected = selectedId ? visible.find((r) => r.id === selectedId) : null;
  const tipLeft = hovered ? x(hovered.ts) : 0;
  const hv = hovered?.features[feature.key];
  const hInc = hovered?.incidentId;

  return (
    <div ref={wrap} className="relative w-full select-none">
      <div
        tabIndex={0}
        role="application"
        aria-roledescription="telemetry chart"
        aria-label={`${label}. Use left and right arrow keys to inspect readings, Enter to open the reading, Escape to clear.`}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        className="rounded-[6px] focus-visible:outline-offset-4"
        data-testid="chart-telemetry"
      >
        <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); const px = e.clientX - rect.left; if (px < M.l || px > width - M.r) return; const index = nearest(t0 + ((px - M.l) / iw) * (t1 - t0)); if (index != null) onSelectReading?.(visible[index]); }} className="block cursor-crosshair">
          <defs>
            <pattern id="gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-support)" strokeWidth="2" />
            </pattern>
          </defs>
          {/* grid */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="var(--color-divider)" strokeOpacity={1} />
              <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 tnum" fontSize={11}>
                {fmtValue(v, { ...feature, digits: Math.min(feature.digits, 2) })}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t} y2={height - M.b} stroke="var(--color-divider)" strokeOpacity={0.7} />
              <text x={x(t)} y={height - 8} textAnchor="middle" className="fill-ink-3 tnum" fontSize={11}>
                {fmtTime(t)}
              </text>
            </g>
          ))}
          <text x={M.l} y={14} className="fill-ink-3" fontSize={11}>
            {feature.label} ({fmtUnit(feature)})
          </text>
          {/* incident spans */}
          {shownIncidents.map((inc) => {
            const a = Math.max(x(inc.firstSeen), M.l);
            const b = Math.min(x(inc.closedAt ?? inc.lastSeen), width - M.r);
            return <rect key={inc.id} x={a} y={M.t} width={Math.max(2, b - a)} height={ih} fill="var(--color-danger)" fillOpacity={inc.lifecycle === 'open' ? 0.09 : 0.05} />;
          })}
          {/* gaps */}
          {model?.gaps.map((g, i) => {
            const a = Math.max(x(g.from), M.l);
            const b = Math.min(x(g.to), width - M.r);
            if (b - a < 1) return null;
            return (
              <g key={i}>
                <rect x={a} y={M.t} width={b - a} height={ih} fill="url(#gap-hatch)" opacity={0.9} />
                {b - a > 54 && (
                  <text x={(a + b) / 2} y={M.t + ih / 2} textAnchor="middle" className="fill-ink-3" fontSize={10.5}>
                    {g.kind === 'dropped' ? 'no samples' : 'value missing'}
                  </text>
                )}
              </g>
            );
          })}
          {/* threshold-free series */}
          <path d={path} fill="none" stroke="var(--color-info-ink)" strokeWidth={1.8} strokeLinejoin="round" />
          {/* predictions + incident readings */}
          {visible.map((r) => {
            if (isNominal(r.predicted)) return null;
            const v = r.features[feature.key];
            const cy = v == null ? M.t + 6 : y(v);
            const inInc = !!r.incidentId;
            return inInc ? (
              <circle key={r.id} cx={x(r.ts)} cy={cy} r={2.6} fill="var(--color-danger)" stroke="var(--color-danger-ink)" strokeWidth={0.6} />
            ) : (
              <circle key={r.id} cx={x(r.ts)} cy={cy} r={3.6} fill="var(--color-sun)" stroke={r.confidence >= threshold ? 'var(--color-amber)' : 'var(--color-highlight)'} strokeWidth={1.5} strokeDasharray={r.confidence >= threshold ? undefined : '2 1.5'} />
            );
          })}
          {/* context line */}
          {contextTs != null && contextTs >= t0 && contextTs <= t1 && (
            <g>
              <line x1={x(contextTs)} x2={x(contextTs)} y1={M.t} y2={height - M.b} stroke="var(--color-highlight)" strokeDasharray="3 3" strokeOpacity={0.7} />
            </g>
          )}
          {/* selected */}
          {selected && (
            <g>
              <line x1={x(selected.ts)} x2={x(selected.ts)} y1={M.t} y2={height - M.b} stroke="var(--color-action)" strokeWidth={1.2} />
              {selected.features[feature.key] != null && <circle cx={x(selected.ts)} cy={y(selected.features[feature.key]!)} r={5} fill="none" stroke="var(--color-action)" strokeWidth={2} />}
            </g>
          )}
          {/* hover */}
          {hovered && (
            <g pointerEvents="none">
              <line x1={tipLeft} x2={tipLeft} y1={M.t} y2={height - M.b} stroke="var(--color-support)" strokeOpacity={0.8} />
              {hv != null && <circle cx={tipLeft} cy={y(hv)} r={3.5} fill="var(--color-ink)" />}
            </g>
          )}
        </svg>
        {/* incident markers as real buttons above the plot */}
        {shownIncidents.map((inc) => {
          const left = Math.max(M.l, Math.min(x(inc.firstSeen), width - M.r - 120));
          return (
            <button
              key={inc.id}
              type="button"
              onClick={() => onSelectIncident?.(inc)}
              aria-label={`Open ${inc.id}, ${CLASS_LABEL[inc.cls]}, ${inc.lifecycle}, opened ${fmtTime(inc.firstSeen)} UTC`}
              data-testid={`marker-incident-${inc.id}`}
              className="absolute top-[14px] inline-flex h-[18px] items-center gap-1 rounded-[4px] border border-rose/50 bg-danger-surface px-1.5 font-mono text-[10.5px] text-rose transition-colors duration-150 hover:bg-danger-hover focus-visible:outline-action"
              style={{ left }}
            >
              <span aria-hidden className={'size-1.5 rounded-full bg-rose'} />
              {inc.id}
            </button>
          );
        })}
      </div>

      {model && kept.size < visible.length && <span className="block px-3 text-[11px] text-ink-3">Line simplified for width; extrema and flagged readings retained.</span>}
      {!model && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12.5px] text-ink-3">{visible.length ? `No ${feature.label.toLowerCase()} values in this window` : 'Waiting for telemetry in this window'}</div>
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-[230px] max-w-full rounded-[12px] border border-divider bg-panel/95 p-2.5 text-[12px] shadow-[0_12px_28px_-14px_rgb(138_121_103/0.5)]"
          style={{ left: Math.max(0, Math.min(tipLeft + 12, width - Math.min(230, width))), top: M.t + 4 }}
        >
          <div className="flex items-center justify-between font-mono text-[11px] text-ink-3">
            <span>{hovered.id}</span>
            <span>{fmtTime(hovered.ts)} UTC</span>
          </div>
          <div className="mt-1.5 text-[15px] font-semibold tnum text-ink">
            {fmtValue(hv, feature)} <span className="text-[11.5px] font-normal text-ink-3">{fmtUnit(feature)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-ink-3">Prediction</span>
            <span className={isNominal(hovered.predicted) ? 'text-ink-2' : 'text-amber'}>
              {CLASS_LABEL[hovered.predicted]} · {fmtConf(hovered.confidence)}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] leading-snug">
            {hInc ? (
              <span className="text-rose">Confirmed: part of incident {hInc}</span>
            ) : !isNominal(hovered.predicted) ? (
              <span className="text-amber">Prediction only, no incident</span>
            ) : (
              <span className="text-ink-3">Nominal reading</span>
            )}
          </div>
          <div className="mt-1.5 text-[10.5px] text-ink-3">Click or press Enter to inspect</div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {hovered ? `${fmtTime(hovered.ts)} UTC, ${feature.label} ${fmtValue(hv, feature)}, ${CLASS_LABEL[hovered.predicted]} ${fmtConf(hovered.confidence)}${hInc ? `, incident ${hInc}` : ''}` : ''}
      </span>
    </div>
  );
}

export function ChartLegend({ downsampled }: { downsampled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-[2px] w-4 rounded bg-info-ink" /> Reading value
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-amber" /> Prediction, no incident
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full border border-rose bg-danger" /> Confirmed incident reading
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-[2px] bg-danger/20" /> Incident span
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-[2px] bg-[repeating-linear-gradient(45deg,var(--color-support)_0_2px,transparent_2px_5px)]" /> Missing samples
      </span>
      {downsampled && <span>Line downsampled for width; flagged readings always drawn</span>}
    </div>
  );
}
