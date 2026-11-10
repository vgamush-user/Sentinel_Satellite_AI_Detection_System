import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CircleCheck, CircleDashed, CircleX, Download, Loader2, Send, ShieldAlert, Zap } from 'lucide-react';
import { Btn, Empty, ErrorNote, Field, Panel, PanelHead, RawBlock } from '@/components/kit';
import { useBackend } from '@/lib/backend/context';
import type { BackendClient } from '@/lib/backend/client';
import type { BackendDecision, BackendIncident, BackendRow, BackendSample } from '@/lib/backend/protocol';
import { customEntryCountSchema } from '@/lib/backend/protocol';
import { fmtConf } from '@/lib/sentinel/format';
import { reportStatus } from '@/lib/backend/report-status';
import { useOperation } from '@/lib/sentinel/operations';
import { ConnectRequired, Label, errMsg, inputCls, isNormal, selectCls, usePersisted } from './shared';

type Quality = 'clean' | 'noisy';
interface Run {
  key: string;
  label: string;
  kind: 'entry' | 'simulation';
  trueClass: string | null;
  input?: unknown;
  error?: string;
  outcomeUnknown?: boolean;
  ids?: string[];
  rows: Record<string, BackendRow>;
  decisions: Record<string, BackendDecision>;
}

const GROUPS = ['Message fields', 'Window statistics', 'Memory readings'] as const;
const groupOf = (f: string) => (/^Memory/.test(f) ? GROUPS[2] : /Window|Sliding/.test(f) ? GROUPS[1] : GROUPS[0]);
const DECISION: Record<string, string> = {
  normal: 'No incident: detected as Normal.',
  below_confidence: 'No incident: below the confidence guard.',
  pending: 'No incident: not enough attack rows in the window.',
};

function runIncident(run: Run, incidents: BackendIncident[]) {
  for (const d of Object.values(run.decisions)) if (d.incident_id) return incidents.find((i) => i.incident_id === d.incident_id) ?? null;
  return incidents.find((i) => i.trigger_entry_ids?.some((id) => run.ids?.includes(id))) ?? null;
}

function Step({ state, title, children }: { state: 'done' | 'run' | 'wait' | 'no' | 'err'; title: string; children?: React.ReactNode }) {
  const Icon = state === 'run' ? Loader2 : state === 'done' ? CircleCheck : state === 'err' ? CircleX : CircleDashed;
  const tone = state === 'run' ? 'animate-spin text-amber [animation-duration:2s]' : state === 'done' ? 'text-mint' : state === 'err' ? 'text-rose' : 'text-ink-3';
  return (
    <li className="grid grid-cols-[20px_1fr] gap-3" data-testid={`step-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <Icon className={`mt-0.5 size-4 ${tone}`} aria-hidden />
      <div>
        <div className="text-[13px] font-medium text-ink">
          {title} <span className="ml-1 text-[11.5px] font-normal text-ink-3">{{ done: 'Complete', run: 'In progress', wait: 'Waiting', no: 'Skipped', err: 'Failed' }[state]}</span>
        </div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </li>
  );
}

function RunTrace({ run, incidents }: { run: Run; incidents: BackendIncident[] }) {
  const n = run.ids?.length ?? 0;
  const rows = Object.values(run.rows);
  const scored = rows.length;
  const decided = n > 0 && Object.keys(run.decisions).length >= n;
  const lastId = run.ids?.slice().reverse().find((id) => run.decisions[id]);
  const decision = lastId ? run.decisions[lastId] : undefined;
  const inc = runIncident(run, incidents);
  const rs = inc?.report_status ?? null;
  const normalizedReport = reportStatus(rs, inc?.report);
  const reportState = !inc ? (decided ? 'no' : 'wait') : normalizedReport === 'ready' ? 'done' : normalizedReport === 'failed' ? 'err' : normalizedReport === 'pending' ? 'run' : 'wait';
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.predicted_class, (counts.get(r.predicted_class) ?? 0) + 1));
  const mean = scored ? rows.reduce((a, r) => a + r.confidence, 0) / scored : null;
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        <Step state={run.outcomeUnknown ? 'wait' : run.error ? 'err' : run.ids ? 'done' : 'run'} title={run.outcomeUnknown ? 'Submission outcome unknown' : run.error ? 'Submission failed' : 'Submitted'}>
          {run.error ? run.error : run.ids ? `${n} ${n === 1 ? 'entry' : 'entries'} accepted by the backend. Acceptance is not detection.` : 'Sending to backend…'}
        </Step>
        <Step state={!run.ids ? 'wait' : scored < n ? 'run' : 'done'} title="Scored">
          {!run.ids ? '' : `${scored} of ${n} entries scored by the detector`}
          {n === 1 && rows[0]?.latency_ms != null && ` · ${Math.round(rows[0].latency_ms)} ms latency`}
        </Step>
        <Step state={inc ? 'done' : decided ? 'no' : scored ? 'run' : 'wait'} title="Incident decision">
          {inc ? (
            <>
              <Link href={`/incidents/${inc.incident_id}`} className="font-mono text-rose hover:underline" data-testid="link-run-incident">
                {inc.incident_id}
              </Link>{' '}
              · {inc.attack_class ?? 'Unknown class'} · {inc.status ?? 'status unknown'} · {inc.row_count ?? '—'} rows
            </>
          ) : decision ? (
            <>
              {decided ? DECISION[decision.decision] ?? `No incident (${decision.decision}).` : 'Partial decisions received.'}
              <span className="block text-ink-3">{decision.detail}</span>
            </>
          ) : scored ? (
            'Waiting for the incident manager…'
          ) : (
            ''
          )}
        </Step>
        <Step state={reportState as 'done'} title="Report">
          {inc ? (normalizedReport === 'unknown' ? `Completion status unknown${rs ? ` (${rs})` : ''}. ${inc.report ? 'Supplied report text is available on the incident.' : ''}` : rs ? `Report ${rs}${inc.report_mode ? ` · ${inc.report_mode}` : ''}` : 'No report activity yet') : decided ? 'No incident, so no report for this run.' : ''}
        </Step>
      </ol>
      {scored > 0 && (
        <dl>
          <Field k={n === 1 ? 'Predicted class' : 'Predictions so far'}>{[...counts].sort((a, b) => b[1] - a[1]).map(([c, k]) => `${k} x ${c}`).join(' · ')}</Field>
          <Field k={n === 1 ? 'Model confidence' : 'Mean model confidence'}>{fmtConf(mean)}</Field>
          <Field k="Ground truth (dataset)">{run.trueClass ?? 'Unavailable (edited or unlabeled)'}</Field>
        </dl>
      )}
      {run.ids && (
        <div className="overflow-x-auto rounded-[8px] border border-divider">
          <table className="w-full min-w-[480px] text-[12.5px]">
            <thead>
              <tr className="border-b border-divider text-left text-[11.5px] text-ink-3">
                <th className="px-3 py-1.5 font-medium">Entry ID</th>
                <th className="px-3 py-1.5 font-medium">Prediction</th>
                <th className="px-3 py-1.5 text-right font-medium">Confidence</th>
                <th className="px-3 py-1.5 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {run.ids.slice(0, 100).map((id) => {
                const r = run.rows[id];
                const d = run.decisions[id];
                return (
                  <tr key={id} className="border-b border-divider/60 last:border-0">
                    <td className="px-3 py-1.5">
                      <Link href={`/telemetry?reading=${encodeURIComponent(id)}`} className="font-mono text-ink hover:text-lav hover:underline">
                        {id}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">{r ? <span className={isNormal(r.predicted_class) ? 'text-ink-2' : 'text-rose'}>{r.predicted_class}</span> : <span className="text-ink-3">Not yet scored</span>}</td>
                    <td className="px-3 py-1.5 text-right tnum">{r ? fmtConf(r.confidence) : '—'}</td>
                    <td className="px-3 py-1.5 text-ink-2">{d ? d.decision : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <RawBlock title="Submission record" data={{ label: run.label, submitted_input: run.input ?? 'Not retained for this older run', entry_ids: run.ids ?? null, true_class: run.trueClass, error: run.error ?? null }} />
    </div>
  );
}

export function BackendLab() {
  const { client, data, evidence, evidenceDecisions } = useBackend();
  const config = data?.config;
  const classes = config?.classes ?? [];
  const features = config?.features ?? [];
  const [form, setForm] = usePersisted('lab', {
    cls: '', quality: 'clean' as Quality, burst: false, count: '10',
    atkCls: '', atkQuality: 'clean' as Quality, atkCount: '15',
  });
  const [editor, setEditor] = usePersisted('lab-editor', { loaded: null as { sample: BackendSample; cls: string; quality: Quality } | null, values: {} as Record<string, string> });
  const loaded = editor.loaded;
  const values = editor.values;
  const setLoaded = (l: typeof loaded) => setEditor((e) => ({ ...e, loaded: l }));
  const setValues = (fn: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) =>
    setEditor((e) => ({ ...e, values: typeof fn === 'function' ? fn(e.values) : fn }));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<{ busy: boolean; msg: string; error?: boolean }>({ busy: false, msg: '' });
  const submission = useOperation<void>(`sentinelsat.backend.${client?.base ?? 'none'}.submission.v2`);
  const pending = submission.status === 'pending';
  const [runStore, setRunStore] = usePersisted('lab-runs', { runs: [] as Run[], shown: null as string | null }, saved => ({ ...saved,
    runs: Array.isArray(saved.runs) ? saved.runs.slice(0, 8).map(run => !run.ids && !run.error ? { ...run, outcomeUnknown: true, error: 'Submission outcome unknown after reload. No request was retried.' } : run) : [] }));
  const runs = runStore.runs;
  const shown = runStore.shown;
  const setRuns = (fn: (r: Run[]) => Run[]) => setRunStore((s) => { const next = fn(s.runs); return next === s.runs ? s : { ...s, runs: next }; });
  const setShown = (k: string | null) => setRunStore((s) => ({ ...s, shown: k }));
  const sampleReq = useRef<AbortController | null>(null);

  const cls = form.cls || classes.find((c) => !isNormal(c)) || classes[0] || '';
  const atkClasses = classes.filter((c) => !isNormal(c));
  const atkCls = form.atkCls && atkClasses.includes(form.atkCls) ? form.atkCls : atkClasses[0] ?? '';
  const matches = !!loaded && loaded.cls === cls && loaded.quality === form.quality;
  const edited = loaded ? features.filter((f) => values[f] === '' || Number(values[f]) !== loaded.sample.features[f]) : [];

  useEffect(() => () => { sampleReq.current?.abort(); }, []);

  // Track runs by returned entry IDs; retain rows/decisions even after buffer eviction.
  const recent = data?.recent;
  const decisions = data?.decisions;
  const trackedIds = runs.flatMap(run => run.ids ?? []).join('\n');
  useEffect(() => {
    if (client && trackedIds) client.trackEntries(trackedIds.split('\n'));
  }, [client, trackedIds]);
  useEffect(() => {
    if (!recent || !decisions) return;
    setRuns((cur) => {
      let changed = false;
      const next = cur.map((run) => {
        if (!run.ids) return run;
        const ids = new Set(run.ids);
        let rows = run.rows;
        let decs = run.decisions;
        for (const r of [...evidence.values(), ...recent]) if (ids.has(r.entry_id) && rows[r.entry_id] !== r) { rows = rows === run.rows ? { ...rows } : rows; rows[r.entry_id] = r; }
        for (const id of run.ids) {
          const d = decisions.get(id) ?? evidenceDecisions.get(id);
          if (d && decs[id] !== d) { decs = decs === run.decisions ? { ...decs } : decs; decs[id] = d; }
        }
        if (rows === run.rows && decs === run.decisions) return run;
        changed = true;
        return { ...run, rows, decisions: decs };
      });
      return changed ? next : cur;
    });
  }, [recent, decisions, evidence, evidenceDecisions, trackedIds]);

  if (!client) return <Panel className="mt-5"><PanelHead title="Backend Threat Lab" meta="Custom entries and labeled attack simulations" /><ConnectRequired what="Custom entry submission and labeled attack simulation" /></Panel>;
  if (client.readOnlyGateway) return <Panel className="mt-5"><PanelHead title="Backend Threat Lab" meta="Read-only gateway" /><Empty title="Simulations are not authorized" body="This gateway allows telemetry, incident reads, and the live stream only. Sample loading, custom submissions, and attack simulations are unavailable through its current allowlist. No telemetry is submitted." /></Panel>;

  const load = async () => {
    sampleReq.current?.abort();
    const ctrl = new AbortController();
    sampleReq.current = ctrl;
    const want = { cls, quality: form.quality };
    setLoadState({ busy: true, msg: 'Loading selected sample…' });
    try {
      const s = await client.sample(want.cls, want.quality, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const missing = features.filter((f) => !Number.isFinite(s.features[f]));
      if (missing.length) throw new Error(`Sample is missing ${missing.length} configured feature(s): ${missing.slice(0, 3).join(', ')}`);
      setLoaded({ sample: s, ...want });
      setValues(Object.fromEntries(features.map((f) => [f, String(s.features[f])])));
      setInvalid([]);
      setLoadState({ busy: false, msg: `Sample loaded from ${s.dataset}.` });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setLoadState({ busy: false, error: true, msg: `${errMsg(e, 'Could not load sample.')}${loaded ? ' Previously loaded values are still shown.' : ''}` });
    }
  };
  const choose = (patch: Partial<typeof form>) => {
    sampleReq.current?.abort();
    setLoadState({ busy: false, msg: '' });
    setForm((f) => ({ ...f, ...patch }));
  };

  const submit = (label: string, kind: Run['kind'], trueClass: string | null, call: () => ReturnType<BackendClient["send"]>, input: unknown) => submission.run(async () => {
    const key = `run-${crypto.randomUUID()}`;
    setRuns((r) => [{ key, label, kind, trueClass, input, rows: {}, decisions: {} }, ...r].slice(0, 8));
    setShown(key);
    try {
      const res = await call();
      const fn = (r: Run[]) => r.map((x) => (x.key === key ? { ...x, ids: res.entry_ids } : x));
      setRuns(fn);
    } catch (e) {
      const unknown = e instanceof TypeError || e instanceof DOMException && ['AbortError', 'TimeoutError'].includes(e.name);
      const fn = (r: Run[]) => r.map((x) => (x.key === key ? { ...x, outcomeUnknown: unknown, error: unknown ? 'Completion could not be confirmed. Check telemetry before resubmitting; no request was retried.' : errMsg(e, 'Submission failed.') } : x));
      setRuns(fn);
    }
  });

  const count = Number(form.count);
  const countErr = form.burst && !customEntryCountSchema.safeParse(count).success ? 'Burst count must be a whole number from 1 to 50.' : '';
  const atkCount = Number(form.atkCount);
  const atkErr = !Number.isInteger(atkCount) || atkCount < 1 || atkCount > 100 ? 'Row count must be a whole number from 1 to 100.' : '';

  const send = () => {
    if (!loaded || !matches) return;
    const bad = features.filter((f) => !values[f]?.trim() || !Number.isFinite(Number(values[f])));
    setInvalid(bad);
    if (bad.length) return document.getElementById(`bfeat-${bad[0]}`)?.focus();
    if (countErr) return;
    const n = form.burst ? count : 1;
    const truth = edited.length ? null : loaded.sample.true_class;
    const label = `${form.burst ? `${n}x ` : ''}test entry${edited.length ? ` (${edited.length} edited)` : ''}`;
    const input = { features: Object.fromEntries(features.map((f) => [f, Number(values[f])])), count: n, true_class: truth, interval_sec: 0.1 };
    void submit(label, 'entry', truth, () => client.send(input), input);
  };
  const simulate = () => {
    if (atkErr || !atkCls) return;
    const input = { cls: atkCls, count: atkCount, quality: form.atkQuality };
    void submit(`${atkCls} attack (${atkCount} ${form.atkQuality} rows)`, 'simulation', atkCls, () => client.attack(input), input);
  };

  const run = runs.find((r) => r.key === shown) ?? runs[0];
  const guards = config?.guards;

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <Panel>
          <PanelHead title="Labeled attack simulation" meta="Backend · POST /api/attack" />
          {!config ? (
            <div className="p-5 text-[12.5px] text-ink-3">Waiting for backend configuration…</div>
          ) : (
            <div className="space-y-4 px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="atk-cls">Attack class</Label>
                  <select id="atk-cls" className={selectCls} value={atkCls} onChange={(e) => setForm((f) => ({ ...f, atkCls: e.target.value }))} data-testid="select-attack-class">
                    {atkClasses.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="atk-q">Telemetry quality</Label>
                  <select id="atk-q" className={selectCls} value={form.atkQuality} onChange={(e) => setForm((f) => ({ ...f, atkQuality: e.target.value as Quality }))} data-testid="select-attack-quality">
                    <option value="clean">Clean</option>
                    <option value="noisy">Noisy</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="atk-n">Rows</Label>
                  <input id="atk-n" inputMode="numeric" className={inputCls(!!atkErr)} value={form.atkCount} onChange={(e) => setForm((f) => ({ ...f, atkCount: e.target.value }))} aria-invalid={!!atkErr} data-testid="input-attack-count" />
                </div>
              </div>
              {atkErr && <p className="text-[12px] text-rose">{atkErr}</p>}
              <Btn variant="primary" disabled={pending || !!atkErr || !atkCls} onClick={simulate} data-testid="button-backend-simulate">
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Zap className="size-3.5" aria-hidden />} Run simulation
              </Btn>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Custom entry editor" meta={loaded ? `Source sample: ${loaded.sample.true_class} · ${loaded.quality} · ${loaded.sample.dataset}` : 'No sample loaded'} />
          {!config ? (
            <div className="p-5 text-[12.5px] text-ink-3">Waiting for backend configuration…</div>
          ) : (
            <div className="space-y-4 px-5 py-4">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <Label htmlFor="t-cls">Start from</Label>
                  <select id="t-cls" className={selectCls} value={cls} onChange={(e) => choose({ cls: e.target.value })} data-testid="select-sample-class">
                    {classes.map((c) => <option key={c}>{c}</option>)}
                    <option value="random">Random row</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="t-q">Quality</Label>
                  <select id="t-q" className={selectCls} value={form.quality} onChange={(e) => choose({ quality: e.target.value as Quality })} data-testid="select-sample-quality">
                    <option value="clean">Clean</option>
                    <option value="noisy">Noisy</option>
                  </select>
                </div>
                <Btn variant="secondary" onClick={() => void load()} disabled={loadState.busy} data-testid="button-load-sample">
                  {loadState.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />} Load sample
                </Btn>
              </div>
              <p role="status" className={`text-[12px] ${loadState.error ? 'text-rose' : 'text-ink-3'}`}>
                {loadState.msg || (loaded && !matches ? 'Selection changed. Load the selected sample or return to the loaded one.' : '')}
                {loaded && !matches && (
                  <button className="ml-2 text-lav underline" onClick={() => choose({ cls: loaded.cls, quality: loaded.quality })} data-testid="button-use-loaded">
                    Use loaded sample
                  </button>
                )}
              </p>
              {loaded && (
                <div className="rounded-[12px] border border-leaf-strong bg-leaf px-3 py-2 text-[12.5px] text-ink-2" data-testid="text-backend-ground-truth">
                  {edited.length ? `${edited.length} edited field(s): dataset ground truth unavailable and sent as null.` : `Submitted entry ground truth: ${loaded.sample.true_class}`}
                </div>
              )}
              {loaded &&
                GROUPS.map((g) => {
                  const fs = features.filter((f) => groupOf(f) === g);
                  if (!fs.length) return null;
                  return (
                    <fieldset key={g}>
                      <legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{g}</legend>
                      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                        {fs.map((f) => (
                          <div key={f}>
                            <label htmlFor={`bfeat-${f}`} className="block truncate font-mono text-[11.5px] text-info-ink" title={f}>{f}</label>
                            <input
                              id={`bfeat-${f}`}
                              inputMode="decimal"
                              value={values[f] ?? ''}
                              onChange={(e) => { const v = e.target.value; setValues((p) => ({ ...p, [f]: v })); setInvalid((p) => p.filter((x) => x !== f)); }}
                              aria-invalid={invalid.includes(f)}
                              className={`${inputCls(invalid.includes(f))} !mt-1 text-right font-mono ${edited.includes(f) && !invalid.includes(f) ? 'text-amber' : ''}`}
                              data-testid={`input-backend-feature-${f}`}
                            />
                            {invalid.includes(f) && <p className="mt-1 text-[12px] text-rose">Enter a number.</p>}
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              <div className="flex flex-wrap items-end gap-4 border-t border-divider pt-4">
                <div role="radiogroup" aria-label="Send mode" className="flex gap-3 text-[12.5px] text-ink">
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={!form.burst} onChange={() => setForm((f) => ({ ...f, burst: false }))} data-testid="radio-send-once" /> Send once</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={form.burst} onChange={() => setForm((f) => ({ ...f, burst: true }))} data-testid="radio-send-burst" /> Burst</label>
                </div>
                {form.burst && (
                  <div className="w-28">
                    <Label htmlFor="t-burst">Burst rows</Label>
                    <input id="t-burst" inputMode="numeric" className={inputCls(!!countErr)} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} data-testid="input-burst-count" />
                  </div>
                )}
                <Btn variant="primary" disabled={!matches || loadState.busy || pending || !!countErr} onClick={send} data-testid="button-send-entry">
                  {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />} Send entry
                </Btn>
              </div>
              {countErr && <p className="text-[12px] text-rose">{countErr}</p>}
              <p className="text-[12px] text-ink-3">
                An incident needs {guards?.min_rows ?? '—'} attack rows within the last {guards?.window_rows ?? '—'} at confidence {guards ? fmtConf(guards.min_confidence) : '—'} or higher, per backend configuration.
              </p>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="self-start">
        <PanelHead title="Backend run progress" meta={run ? run.label : 'No backend runs yet'}>
          {runs.length > 1 && (
            <select value={run?.key} onChange={(e) => setShown(e.target.value)} className="h-8 rounded-[9px] border border-divider-strong bg-raised px-2 text-[12px] text-ink" aria-label="Backend run" data-testid="select-backend-run">
              {runs.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          )}
        </PanelHead>
        <div className="px-5 py-4">
          {run ? <RunTrace run={run} incidents={data?.incidents ?? []} /> : <Empty icon={ShieldAlert} title="No backend runs yet" body="Send a custom entry or run a simulation. Progress follows the returned entry IDs through scoring, incident decision and report." />}
          {runs.some((r) => r.error) && run?.error && <div className="mt-3"><ErrorNote>{run.error}</ErrorNote></div>}
        </div>
      </Panel>
    </div>
  );
}
