import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useForm } from 'react-hook-form';
import { CircleCheck, CircleDashed, FlaskConical, Loader2, Play, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Btn, ClassTag, Empty, ErrorNote, PageHeader, Panel, PanelHead, RawBlock, ReportBadge, Skel } from '@/components/kit';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, fmtConf, fmtTime, isNominal } from '@/lib/sentinel/format';
import { useAdapter, useSentinel } from '@/lib/sentinel/store';
import { useBackend } from '@/lib/backend/context';
import { BackendLab } from '@/components/backend/backend-lab';
import type { AttackAck, Scenario } from '@/lib/sentinel/types';

interface FormVals {
  count: string;
  intensity: string;
}

function RunOutcome({ run }: { run: AttackAck }) {
  const s = useSentinel();
  const reading = (id: string) => s.readingIndex.get(id) ?? s.evidence.get(id);
  const arrived = run.readingIds.map(reading).filter(Boolean);
  const incidents = s.incidents.filter((i) => i.runId === run.runId);
  const done = arrived.length === run.readingIds.length;
  const expired = !done && !!s.playback && s.playback.cursorSeq > run.scheduledToSeq && s.connection === 'connected';
  const flagged = arrived.filter((r) => !isNominal(r!.predicted)).length;
  const steps = [
    { ok: true, title: 'Request accepted', body: <>Accepted at <span className="tnum">{fmtTime(run.acceptedAt)} UTC</span>. Acceptance means readings were scheduled, not that anything was detected.</> },
    {
      ok: done,
      pending: !done && !expired,
      title: done ? 'Readings classified' : expired ? 'Some evidence is no longer retained' : 'Waiting for readings',
      body: (
        <>
          {arrived.length} of {run.readingIds.length} scheduled readings received
          {arrived.length > 0 && <>, {flagged} classified non-nominal</>}.
          {!done && s.playback && !s.playback.playing && <span className="text-amber"> Replay is paused; injected readings arrive when playback resumes.</span>}
          {expired && <span> The run is in the past. Missing evidence is unavailable, not waiting to arrive. The latest 1,000 submitted readings are retained.</span>}
        </>
      ),
    },
    incidents.length
      ? { ok: true, title: 'Incident opened', tone: 'rose', body: <>Detection crossed the 3-reading rule: {incidents.map((i) => <Link key={i.id} href={`/incidents/${i.id}?at=${i.firstSeen}`} className="font-mono text-rose hover:underline">{i.id}</Link>)}</> }
      : { ok: done, pending: !done && !expired, title: done ? 'No incident opened' : expired ? 'Incident outcome unavailable' : 'Incident outcome pending', tone: done ? 'mint' : undefined, body: done ? 'Readings were classified and logged, but the detector did not escalate them. Open any reading to see its entry decision.' : expired ? 'No associated incident is retained for this run.' : 'Determined once all readings are classified.' },
  ];
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map((st, i) => (
          <li key={i} className="grid grid-cols-[20px_1fr] gap-3">
            <span className="mt-0.5">
              {st.pending ? <Loader2 className="size-4 animate-spin text-amber [animation-duration:2s]" aria-hidden /> : st.tone === 'rose' ? <ShieldAlert className="size-4 text-rose" aria-hidden /> : st.ok ? <CircleCheck className="size-4 text-mint" aria-hidden /> : <CircleDashed className="size-4 text-ink-3" aria-hidden />}
            </span>
            <div>
              <div className="text-[13px] font-medium text-ink">{st.title}</div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{st.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="overflow-x-auto rounded-[8px] border border-divider">
        <table className="w-full min-w-[520px] text-[12.5px]">
          <thead>
            <tr className="border-b border-divider text-left text-[11.5px] text-ink-3">
              <th className="px-3 py-1.5 font-medium">Scheduled reading</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 text-right font-medium">Confidence</th>
              <th className="px-3 py-1.5 font-medium">Incident</th>
            </tr>
          </thead>
          <tbody>
            {run.readingIds.map((id) => {
              const r = reading(id);
              return (
                <tr key={id} className="border-b border-divider/60 last:border-0">
                  <td className="px-3 py-1.5">
                    {r ? (
                      <Link href={`/telemetry?reading=${id}&at=${r.ts}`} className="font-mono text-ink hover:text-lav hover:underline">
                        {id}
                      </Link>
                    ) : (
                      <span className="font-mono text-ink-3">{id}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{r ? <ClassTag cls={r.predicted} /> : <span className="text-ink-3">{expired ? 'Evidence unavailable' : 'Not yet received'}</span>}</td>
                  <td className="px-3 py-1.5 text-right tnum">{r ? fmtConf(r.confidence) : '—'}</td>
                  <td className="px-3 py-1.5">{r?.incidentId ? <Link href={`/incidents/${r.incidentId}?at=${r.ts}&reading=${id}`} className="font-mono text-rose hover:underline">{r.incidentId}</Link> : <span className="text-ink-3">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {incidents[0] && (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          Report for {incidents[0].id}: <ReportBadge status={incidents[0].report.status} />
        </div>
      )}
      <RawBlock title="Acknowledgement" data={run} />
    </div>
  );
}

export default function ThreatLab() {
  const s = useSentinel();
  const adapter = useAdapter();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const form = useForm<FormVals>({ defaultValues: { count: '', intensity: '' }, mode: 'onChange' });
  const { register, handleSubmit, reset, formState } = form;

  const load = () => {
    setLoadErr(null);
    adapter
      .listScenarios()
      .then((sc) => {
        setScenarios(sc);
        setSelId((p) => p ?? sc[0]?.id ?? null);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : 'Failed to load scenarios'));
  };
  useEffect(load, [adapter]);
  // In connected mode the sample scenario panels are hidden; listScenarios is harmless but unused.

  const sc = scenarios?.find((x) => x.id === selId);
  useEffect(() => {
    if (sc) reset({ count: String(sc.defaults.count), intensity: String(sc.defaults.intensity) });
  }, [sc, reset]);

  const runs = s.runs;
  const shownRun = runs.find((r) => r.runId === activeRun) ?? runs[0];

  const { client } = useBackend();
  if (client)
    return (
      <div>
        <PageHeader title="Threat Lab" subtitle="Send labeled attack simulations or custom entries to the connected backend, then trace scoring, incident decisions and reports." />
        <BackendLab />
      </div>
    );

  const onSubmit = handleSubmit(async (v) => {
    if (!sc) return;
    setSubmitErr(null);
    try {
      const ack = await adapter.runAttack({ scenarioId: sc.id, count: Number(v.count), intensity: Number(v.intensity) });
      setActiveRun(ack.runId);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Simulation request failed');
    }
  });

  return (
    <div>
      <PageHeader
        title="Threat Lab"
        subtitle={
          <>
            <span className="mr-2 inline-flex items-center gap-1 rounded-[5px] border border-amber/40 bg-amber/[0.08] px-1.5 py-px text-[11.5px] font-medium uppercase tracking-[0.06em] text-amber">
              <FlaskConical className="size-3" aria-hidden /> Simulation
            </span>
            Select a scenario, review settings, run, then trace what the detector did with it.
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <Panel>
            <PanelHead title="1 · Scenario" meta="From the labeled demo dataset" />
            {loadErr ? (
              <div className="p-5">
                <ErrorNote>
                  {loadErr}{' '}
                  <button className="underline" onClick={load}>
                    Retry
                  </button>
                </ErrorNote>
              </div>
            ) : !scenarios ? (
              <div className="space-y-2 p-5">
                <Skel className="h-14" />
                <Skel className="h-14" />
                <Skel className="h-14" />
              </div>
            ) : (
              <div role="radiogroup" aria-label="Scenario" className="divide-y divide-divider">
                {scenarios.map((x) => (
                  <button
                    key={x.id}
                    role="radio"
                    aria-checked={x.id === selId}
                    onClick={() => setSelId(x.id)}
                    className={cn('block w-full px-5 py-3.5 text-left transition-colors duration-150', x.id === selId ? 'bg-sun shadow-[inset_3px_0_0_var(--color-palette-orange)]' : 'hover:bg-peach/60')}
                    data-testid={`radio-scenario-${x.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-medium text-ink">{x.name}</span>
                      <ClassTag cls={x.cls} />
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{x.demonstrates}</p>
                    <p className="mt-1 text-[12px] text-ink-3">Expected: {x.expected}</p>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHead title="2 · Review settings" meta={sc ? `${sc.name} · ${CLASS_LABEL[sc.cls]}` : 'Select a scenario'} />
            {sc && (
              <form onSubmit={onSubmit} noValidate className="space-y-4 px-5 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sim-count" className="text-[12.5px] font-medium text-ink">
                      Readings to inject
                    </label>
                    <input
                      id="sim-count"
                      inputMode="numeric"
                      aria-invalid={!!formState.errors.count}
                      aria-describedby="sim-count-help"
                      className={cn('mt-1.5 h-9 w-full rounded-[9px] border bg-raised px-3 tnum text-[13px] text-ink', formState.errors.count ? 'border-rose bg-blush' : 'border-divider-strong focus-visible:border-lav')}
                      {...register('count', {
                        validate: (v) => {
                          const n = Number(v);
                          if (v.trim() === '' || !Number.isFinite(n)) return 'Enter a number.';
                          if (!Number.isInteger(n)) return 'Must be a whole number.';
                          if (n < sc.limits.count[0] || n > sc.limits.count[1]) return `Must be between ${sc.limits.count[0]} and ${sc.limits.count[1]}.`;
                          return true;
                        },
                      })}
                      data-testid="input-sim-count"
                    />
                    <p id="sim-count-help" className={cn('mt-1 text-[12px]', formState.errors.count ? 'text-rose' : 'text-ink-3')}>
                      {formState.errors.count?.message ?? `${sc.limits.count[0]}–${sc.limits.count[1]} consecutive readings, one per sample second`}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="sim-int" className="text-[12.5px] font-medium text-ink">
                      Target intensity
                    </label>
                    <input
                      id="sim-int"
                      inputMode="decimal"
                      aria-invalid={!!formState.errors.intensity}
                      aria-describedby="sim-int-help"
                      className={cn('mt-1.5 h-9 w-full rounded-[9px] border bg-raised px-3 tnum text-[13px] text-ink', formState.errors.intensity ? 'border-rose bg-blush' : 'border-divider-strong focus-visible:border-lav')}
                      {...register('intensity', {
                        validate: (v) => {
                          const n = Number(v);
                          if (v.trim() === '' || !Number.isFinite(n)) return 'Enter a number.';
                          if (n < sc.limits.intensity[0] || n > sc.limits.intensity[1]) return `Must be between ${sc.limits.intensity[0]} and ${sc.limits.intensity[1]}.`;
                          return true;
                        },
                      })}
                      data-testid="input-sim-intensity"
                    />
                    <p id="sim-int-help" className={cn('mt-1 text-[12px]', formState.errors.intensity ? 'text-rose' : 'text-ink-3')}>
                      {formState.errors.intensity?.message ?? 'Approximate classifier score the injected signal aims for (0.50–0.99)'}
                    </p>
                  </div>
                </div>
                <div className="rounded-[8px] border border-amber/25 bg-amber/[0.05] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
                  <div className="flex items-center gap-1.5 font-medium text-amber">
                    <TriangleAlert className="size-3.5" aria-hidden /> Target environment: sample replay in this browser
                  </div>
                  Injects simulated readings into the sample downlink stream starting 3 readings after the replay cursor ({s.playback ? `${fmtTime(s.playback.cursorTs)} UTC` : '—'}). No spacecraft, ground station or external system is contacted. Injected readings are labeled Threat Lab everywhere they appear.
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn type="submit" variant="primary" disabled={formState.isSubmitting || s.connection !== 'connected'} data-testid="button-run-simulation">
                    {formState.isSubmitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                    {formState.isSubmitting ? 'Submitting…' : 'Run simulation'}
                  </Btn>
                  {s.connection !== 'connected' && <span className="text-[12px] text-amber">Feed disconnected. Reconnect to submit.</span>}
                  <span aria-live="polite" className="text-[12px] text-mint">
                    {!formState.isSubmitting && formState.isSubmitSuccessful && !submitErr && shownRun ? `Accepted as ${shownRun.runId}` : ''}
                  </span>
                </div>
                {submitErr && <ErrorNote>{submitErr}</ErrorNote>}
              </form>
            )}
          </Panel>
        </div>

        <Panel className="self-start">
          <PanelHead title="3 · Trace the result" meta={shownRun ? `${shownRun.runId} · ${scenarios?.find((x) => x.id === shownRun.scenarioId)?.name ?? shownRun.scenarioId}` : 'No runs yet'}>
            {runs.length > 1 && (
              <label className="inline-flex items-center gap-2 text-[12px] text-ink-3">
                Run
                <select value={shownRun?.runId} onChange={(e) => setActiveRun(e.target.value)} className="h-8 rounded-[9px] border border-divider-strong bg-raised px-2 font-mono text-[12px] text-ink" data-testid="select-run">
                  {runs.map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {r.runId}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </PanelHead>
          <div className="px-5 py-4">{shownRun ? <RunOutcome run={shownRun} /> : <Empty icon={FlaskConical} title="No simulation runs yet" body="Run a scenario to see its acknowledgement, the readings it produced, and whether the detector opened an incident." />}</div>
        </Panel>
      </div>
      <BackendLab />
    </div>
  );
}
