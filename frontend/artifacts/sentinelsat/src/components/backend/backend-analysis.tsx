import { useEffect, useState } from 'react';
import { BookOpen, Loader2, Pause, Play, RotateCcw, ScanSearch, Square, Upload } from 'lucide-react';
import { Btn, Empty, ErrorNote, Field, Panel, PanelHead, RawBlock } from '@/components/kit';
import { ReportProse } from '@/components/report-prose';
import { useBackend } from '@/lib/backend/context';
import type { ManualAction, ManualReplay, PacketResult, ReplaySettings, WindowResult } from '@/lib/backend/protocol';
import { fmtConf } from '@/lib/sentinel/format';
import { ConnectRequired, Label, errMsg, inputCls, selectCls, usePersisted } from './shared';
import { useOperation } from '@/lib/sentinel/operations';

const PACKET = ['MsgLength', 'CmdCode', 'TimeRadians', 'ApId', 'MsgId'] as const;

function ReplayWorkspace() {
  const { client } = useBackend();
  const [cfg, setCfg] = usePersisted('replay', { dataset: 'noised' as ReplaySettings['dataset'], speed: '10', order: 'sequential' as ReplaySettings['order'], loop: true, buffer: '100', interval: 1000, polling: true, metricA: '', metricB: '' });
  const [replay, setReplay] = useState<ManualReplay | null>(null);
  const [pollErr, setPollErr] = useState('');
  const [busy, setBusy] = useState<ManualAction | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const controlOperation = useOperation<{ action: ManualAction; replay: ManualReplay }>(`sentinelsat.backend.${client?.base ?? 'none'}.replay-control.v2`);
  const controlPending = controlOperation.status === 'pending';

  useEffect(() => {
    if (!client || controlPending) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await client.manualReplay(ctrl.signal);
        if (!ctrl.signal.aborted) { setReplay(r); setPollErr(''); }
      } catch (e) {
        if (!ctrl.signal.aborted) setPollErr(errMsg(e, 'Could not read replay state.'));
      } finally {
        if (!ctrl.signal.aborted && cfg.polling) timer = setTimeout(poll, cfg.interval);
      }
    };
    void poll();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [client, cfg.interval, cfg.polling, tick, controlPending]);

  if (!client) return null;
  const speed = Number(cfg.speed);
  const buffer = Number(cfg.buffer);
  const valid = Number.isInteger(speed) && speed >= 1 && speed <= 200 && Number.isInteger(buffer) && buffer >= 20 && buffer <= 500;
  const settings: ReplaySettings = { dataset: cfg.dataset, speed, order: cfg.order, loop: cfg.loop, buffer_size: buffer };

  const control = async (action: ManualAction) => {
    setBusy(action);
    setActionMsg(null);
    await controlOperation.run(async () => {
      await client.manualControl(action, settings);
      const r = await client.manualReplay();
      setReplay(r);
      setActionMsg({ ok: true, text: `${action} acknowledged. Backend now reports: ${r.state}, ${r.rows_emitted.toLocaleString()} rows emitted${action === 'stop' ? ' (stop does not necessarily reset counts)' : ''}.` });
      return { action, replay: r };
    });
    setBusy(null);
  };

  const rows = replay?.rows ?? [];
  const columns = Object.keys(rows[rows.length - 1] ?? {});
  const numericCols = columns.filter((c) => c !== 'Label');
  const metric = (m: string, i: number) => (m && numericCols.includes(m) ? m : numericCols[i] ?? '');
  const labels = new Map<number, number>();
  rows.forEach((r) => r.Label != null && labels.set(r.Label, (labels.get(r.Label) ?? 0) + 1));
  const st = replay?.state;
  const B = (a: ManualAction, label: string, Icon: typeof Play, disabled: boolean, variant: 'primary' | 'secondary' | 'ghost' = 'secondary') => (
    <Btn variant={variant} size="sm" disabled={controlPending || disabled} onClick={() => void control(a)} data-testid={`button-replay-${a}`}>
      {busy === a ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />} {label}
    </Btn>
  );

  return (
    <>
      <Panel>
        <PanelHead title="Manual CSV replay" meta={replay ? `Backend replay · ${replay.state}` : pollErr ? 'Replay state unavailable' : 'Loading replay state…'} />
        <div className="space-y-4 px-5 py-4">
          <p className="text-[12.5px] text-ink-3">Separate from the live stream and from the shell playback controls. Changes here only affect the backend's manual analysis replay.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor="r-ds">Dataset</Label><select id="r-ds" className={selectCls} value={cfg.dataset} onChange={(e) => setCfg((c) => ({ ...c, dataset: e.target.value === 'raw' ? 'raw' : 'noised' }))} data-testid="select-replay-dataset"><option value="noised">Noised telemetry</option><option value="raw">Raw simulated telemetry</option></select></div>
            <div><Label htmlFor="r-sp">Rows per second</Label><input id="r-sp" inputMode="numeric" className={inputCls(!(speed >= 1 && speed <= 200 && Number.isInteger(speed)))} value={cfg.speed} onChange={(e) => setCfg((c) => ({ ...c, speed: e.target.value }))} data-testid="input-replay-speed" /></div>
            <div><Label htmlFor="r-or">Order</Label><select id="r-or" className={selectCls} value={cfg.order} onChange={(e) => setCfg((c) => ({ ...c, order: e.target.value === 'shuffled' ? 'shuffled' : 'sequential' }))} data-testid="select-replay-order"><option value="sequential">Sequential</option><option value="shuffled">Shuffled</option></select></div>
            <div><Label htmlFor="r-bf">Buffer rows</Label><input id="r-bf" inputMode="numeric" className={inputCls(!(buffer >= 20 && buffer <= 500 && Number.isInteger(buffer)))} value={cfg.buffer} onChange={(e) => setCfg((c) => ({ ...c, buffer: e.target.value }))} data-testid="input-replay-buffer" /></div>
            <div><Label htmlFor="r-iv">Refresh interval (this browser)</Label><select id="r-iv" className={selectCls} value={cfg.interval} onChange={(e) => setCfg((c) => ({ ...c, interval: Number(e.target.value) }))} data-testid="select-replay-interval">{[500, 1000, 2000, 3000].map((v) => <option key={v} value={v}>{v / 1000} s</option>)}</select></div>
            <div className="flex flex-col justify-end gap-1.5 text-[12.5px] text-ink">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={cfg.loop} onChange={(e) => setCfg((c) => ({ ...c, loop: e.target.checked }))} data-testid="checkbox-replay-loop" /> Loop playback</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={cfg.polling} onChange={(e) => setCfg((c) => ({ ...c, polling: e.target.checked }))} data-testid="checkbox-replay-polling" /> Auto refresh</label>
            </div>
          </div>
          {!valid && <p className="text-[12px] text-rose">Enter 1 to 200 rows per second and a buffer of 20 to 500 rows.</p>}
          <div className="flex flex-wrap gap-2">
            {B('load', 'Load dataset', Upload, !valid)}
            {B('start', 'Start', Play, !valid || !replay || st === 'running' || st === 'paused', 'primary')}
            {B('pause', 'Pause', Pause, st !== 'running')}
            {B('resume', 'Resume', Play, st !== 'paused')}
            {B('stop', 'Stop', Square, !replay || st === 'stopped')}
            {B('configure', 'Apply settings', RotateCcw, !valid)}
            {!cfg.polling && <Btn size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} data-testid="button-replay-refresh">Refresh now</Btn>}
          </div>
          {actionMsg && (actionMsg.ok ? <p role="status" className="text-[12.5px] text-mint">{actionMsg.text}</p> : <ErrorNote>{actionMsg.text}</ErrorNote>)}
          {controlPending && <p role="status" className="text-[12px] text-ink-3">Waiting for the backend to confirm the replay action…</p>}
          {controlOperation.error && <ErrorNote>{controlOperation.error}</ErrorNote>}
          {pollErr && <ErrorNote>{pollErr}</ErrorNote>}
          {replay && (
            <dl data-testid="panel-replay-facts">
              <Field k="Active dataset">{replay.dataset === 'raw' ? 'Raw simulated telemetry' : 'Noised telemetry'}</Field>
              <Field k="Rows emitted">{replay.rows_emitted.toLocaleString()} of {replay.total_rows.toLocaleString()}</Field>
              <Field k="Playback">{replay.speed} rows/s · {replay.order} · {replay.loop ? 'looping' : 'single pass'} · {replay.elapsed.toFixed(1)} s elapsed</Field>
              <Field k="Monitor">{replay.monitor == null ? 'Waiting for replay rows' : replay.monitor ? 'Escalation criteria met' : 'Escalation criteria not met'}</Field>
            </dl>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Rolling replay evidence" meta={`${rows.length} rows in buffer`} />
        {!rows.length ? (
          <Empty icon={ScanSearch} title="No rows in the replay buffer" body="Load a dataset and start the replay to collect rows." />
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['metricA', 'metricB'] as const).map((k, i) => {
                const m = metric(cfg[k], i);
                const vals = rows.map((r) => r[m]).filter((v): v is number => typeof v === 'number');
                return (
                  <div key={k} className="rounded-[12px] border border-divider px-3 py-2">
                    <select aria-label={`Metric ${i + 1}`} className={selectCls} value={m} onChange={(e) => setCfg((c) => ({ ...c, [k]: e.target.value }))} data-testid={`select-replay-metric-${i}`}>
                      {numericCols.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <p className="mt-2 font-mono text-[12px] text-ink-2">{vals.length ? `Min ${Math.min(...vals).toPrecision(4)} · Max ${Math.max(...vals).toPrecision(4)} · Latest ${vals[vals.length - 1].toPrecision(4)}` : 'No numeric values'}</p>
                  </div>
                );
              })}
            </div>
            <div className="text-[12.5px] text-ink-2">
              Dataset label mix (descriptive ground truth): {labels.size ? [...labels].sort(([a], [b]) => a - b).map(([l, n]) => `Label ${l}: ${n}`).join(' · ') : 'no labels yet'}
            </div>
            <div className="max-h-[320px] overflow-auto rounded-[8px] border border-divider" role="region" aria-label="Recent replay rows" tabIndex={0}>
              <table className="w-full text-[11.5px]">
                <thead><tr className="border-b border-divider text-left text-ink-3">{columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">{c}</th>)}</tr></thead>
                <tbody>{rows.slice(-20).reverse().map((r, i) => <tr key={i} className="border-b border-divider/60 last:border-0">{columns.map((c) => <td key={c} className="px-2 py-1 text-right font-mono tnum">{r[c] ?? '—'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <WindowAnalysis replay={replay} />
    </>
  );
}

function WindowAnalysis({ replay }: { replay: ManualReplay | null }) {
  const { client } = useBackend();
  const operation = useOperation<WindowResult>(`sentinelsat.backend.${client?.base ?? 'none'}.window-operation.v2`);
  const busy = operation.status === 'pending';
  const err = operation.error;
  const result = operation.result;
  if (!client) return null;
  const run = async () => {
    await operation.run(() => client.analyzeWindow());
  };
  return (
    <Panel>
      <PanelHead title="Full agent analysis of the replay window" meta="POST /api/analysis/run · requires live agents" />
      <div className="space-y-4 px-5 py-4">
        <Btn variant="primary" disabled={busy || !replay?.rows.length || !replay.live_available} onClick={() => void run()} data-testid="button-analyze-window">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />} Run full agent analysis
        </Btn>
        {replay && !replay.live_available && <p className="text-[12.5px] text-amber">Unavailable: the backend reports live agent mode is not available. No result is shown rather than a substitute.</p>}
        {busy && result && <p role="status" className="text-[12px] text-ink-3">Analysis running. The result below is from the previous run.</p>}
        {err && <ErrorNote>{err}</ErrorNote>}
        {result && (
          <div data-testid="panel-window-result">
            <dl>
              <Field k="Replay row">{result.dataset} row {result.row} · message {result.message_id}</Field>
              <Field k="Ground truth">{result.label ?? 'Unavailable'}</Field>
              <Field k="Prediction">{result.prediction} · {fmtConf(result.confidence)}</Field>
              <Field k="Review status">{result.status}</Field>
              <Field k="Monitor">{result.monitor ? 'Escalation criteria met' : 'Manual override of a Monitor decline'}</Field>
              <Field k="Policy action">{result.action ?? 'Unavailable'}{result.guardrail ? ` · ${result.guardrail}` : ''}</Field>
            </dl>
            {[['SPARTA context', result.sparta], ['Policy explanation', result.mitigation], ['Incident narrative', result.report]].map(([t, b]) => (
              <div key={t} className="mt-4 border-t border-divider pt-3">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">{t}</h3>
                {b ? <ReportProse body={b} /> : <p className="text-[12.5px] text-ink-3">Unavailable in this response.</p>}
              </div>
            ))}
            <div className="mt-3"><RawBlock title="Raw window analysis" data={result} /></div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function PacketTest() {
  const { client } = useBackend();
  const [vals, setVals] = usePersisted('packet', { MsgLength: '128', CmdCode: '4', TimeRadians: '1.57', ApId: '102', MsgId: '50' } as Record<string, string>);
  const operation = useOperation<{ input: Record<string, number>; out: PacketResult }>(`sentinelsat.backend.${client?.base ?? 'none'}.packet-operation.v2`);
  const busy = operation.status === 'pending';
  const err = operation.error;
  const res = operation.result;
  if (!client) return null;
  const bad = PACKET.filter((k) => !String(vals[k] ?? '').trim() || !Number.isFinite(Number(vals[k])));
  const score = async () => {
    if (bad.length) return;
    const input = Object.fromEntries(PACKET.map((k) => [k, Number(vals[k])]));
    await operation.run(async () => ({ input, out: await client.scorePacket(input) }));
  };
  return (
    <Panel>
      <PanelHead title="Five-feature packet test" meta="Separate packet model · requires its scaler and model files" />
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-5">
          {PACKET.map((k) => (
            <div key={k}>
              <label htmlFor={`pk-${k}`} className="font-mono text-[11.5px] text-info-ink">{k}</label>
              <input id={`pk-${k}`} inputMode="decimal" className={inputCls(bad.includes(k))} value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} data-testid={`input-packet-${k}`} />
            </div>
          ))}
        </div>
        {bad.length > 0 && <p className="text-[12px] text-rose">Every packet field needs a number.</p>}
        <Btn variant="primary" disabled={busy || bad.length > 0} onClick={() => void score()} data-testid="button-score-packet">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />} Score packet
        </Btn>
        {err && <ErrorNote>{err}</ErrorNote>}
        {res && (
          <dl data-testid="panel-packet-result">
            {PACKET.some(key => Number(vals[key]) !== res.input[key]) && <p role="status" className="mb-3 text-[12px] text-amber">Previous result. Current inputs differ from the submitted packet below.</p>}
            <Field k="Status">{res.out.status}</Field>
            <Field k="Prediction class">{res.out.prediction_class} · {res.out.is_anomaly ? <span className="text-rose">anomaly</span> : 'not anomalous'}</Field>
            <Field k="Confidence">{fmtConf(res.out.confidence_score)}</Field>
            <Field k="Submitted" mono>{Object.entries(res.input).map(([k, v]) => `${k}=${v}`).join(' ')}</Field>
          </dl>
        )}
      </div>
    </Panel>
  );
}

function CachedExamples() {
  const { client } = useBackend();
  const [state, setState] = useState<{ busy: boolean; err: string; data: Awaited<ReturnType<NonNullable<typeof client>['examples']>> | null }>({ busy: false, err: '', data: null });
  if (!client) return null;
  const load = async () => {
    setState((s) => ({ ...s, busy: true, err: '' }));
    try { setState({ busy: false, err: '', data: await client.examples() }); } catch (e) { setState((s) => ({ ...s, busy: false, err: errMsg(e, 'Could not load examples.') })); }
  };
  return (
    <Panel>
      <PanelHead title="Cached agent examples" meta="Stored examples from other windows, not current outputs">
        <Btn size="sm" variant="secondary" disabled={state.busy} onClick={() => void load()} data-testid="button-load-examples">
          {state.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BookOpen className="size-3.5" aria-hidden />} {state.data ? 'Reload' : 'Load examples'}
        </Btn>
      </PanelHead>
      <div className="px-5 py-4">
        {state.err && <ErrorNote>{state.err}</ErrorNote>}
        {!state.data ? (
          <p className="text-[12.5px] text-ink-3">Load to view cached example outputs from the backend.</p>
        ) : !Object.keys(state.data).length ? (
          <p className="text-[12.5px] text-ink-3">The backend returned no cached examples.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(state.data).map(([name, ex]) => (
              <details key={name} className="rounded-[12px] border border-divider px-3 py-2" data-testid={`example-${name}`}>
                <summary className="cursor-pointer text-[13px] font-medium text-ink">
                  {name} <span className="font-normal text-ink-3">· cached example{ex.classification?.predicted_class ? ` · ${ex.classification.predicted_class}` : ''}{ex.status ? ` · ${ex.status}` : ''}</span>
                </summary>
                <div className="mt-2 space-y-3">
                  {[['SPARTA context', ex.sparta_context], ['Mitigation', ex.mitigation], ['Narrative', ex.report]].map(([t, b]) => (
                    <div key={t}><h4 className="mb-1 text-[12.5px] font-semibold text-ink">{t}</h4>{b ? <ReportProse body={b} /> : <p className="text-[12px] text-ink-3">Unavailable.</p>}</div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function BackendAnalysis() {
  const { client } = useBackend();
  if (client?.readOnlyGateway) return <Panel className="mt-5"><PanelHead title="Backend analysis workspace" meta="Read-only gateway" /><Empty title="Analysis controls are not authorized" body="The current gateway does not expose manual replay, packet scoring, window analysis, or cached examples. These controls remain unavailable; no replay or model requests are sent." /></Panel>;
  if (!client)
    return (
      <Panel className="mt-5">
        <PanelHead title="Backend analysis workspace" meta="Manual CSV replay, window analysis, packet scoring, cached examples" />
        <ConnectRequired what="Manual replay, full agent analysis, packet scoring and cached examples" />
      </Panel>
    );
  return (
    <div className="mt-5 space-y-5">
      <ReplayWorkspace />
      <PacketTest />
      <CachedExamples />
    </div>
  );
}
