import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, ScanSearch, TriangleAlert } from 'lucide-react';
import { Btn, ClassTag, CopyButton, Empty, ErrorNote, Field, PageHeader, Panel, PanelHead, RawBlock } from '@/components/kit';
import { ReportProse } from '@/components/report-prose';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, fmtConf, fmtUnit } from '@/lib/sentinel/format';
import { useAdapter, useSentinel } from '@/lib/sentinel/store';
import { useBackend } from '@/lib/backend/context';
import { BackendAnalysis } from '@/components/backend/backend-analysis';
import type { AnalysisResponse, ClassLabel, SampleInput } from '@/lib/sentinel/types';
import { useDurableState, useOperation } from '@/lib/sentinel/operations';

function HostedDemoLink() {
  return (
    <a
      href="https://huggingface.co/spaces/Amuthavel2402/Sentinel_Satellite"
      target="_blank"
      rel="noopener"
      className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-divider-strong/70 bg-raised px-3.5 text-[13px] font-medium text-ink hover:border-info hover:bg-sky"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
      Analyze in hosted demo
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const KEY = 'sentinelsat.analysis.v1';

interface Saved {
  values: Record<string, string>;
  sample: { id: string; label: string; groundTruth: ClassLabel; readingId: string } | null;
  result: { submitted: Record<string, number>; response: AnalysisResponse; sampleId?: string; groundTruth?: ClassLabel } | null;
}

export default function Analysis() {
  const s = useSentinel();
  const adapter = useAdapter();
  const features = s.config?.features ?? [];
  const [saved, setSaved] = useDurableState<Saved>(KEY, { values: {}, sample: null, result: null });
  const values = saved.values;
  const sample = saved.sample;
  const setValues = (next: Record<string, string> | ((v: Record<string, string>) => Record<string, string>)) => setSaved(p => ({ ...p, values: typeof next === 'function' ? next(p.values) : next }));
  const setSample = (next: Saved['sample'] | ((v: Saved['sample']) => Saved['sample'])) => setSaved(p => ({ ...p, sample: typeof next === 'function' ? next(p.sample) : next }));
  const operation = useOperation<NonNullable<Saved['result']>>('sentinelsat.analysis.operation.v2');
  const result = operation.result ?? saved.result;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const status = operation.status === 'pending' ? 'submitting' : operation.status;
  const failMsg = operation.error;
  const [samples, setSamples] = useState<SampleInput[]>([]);

  useEffect(() => {
    adapter.getSamples().then(setSamples);
  }, [adapter]);

  const stale = useMemo(() => {
    if (!result) return false;
    return features.some((f) => !(values[f.key] ?? '').trim() || Number(values[f.key]) !== result.submitted[f.key]);
  }, [result, values, features]);

  const validate = (key: string, v: string | undefined) => {
    const t = (v ?? '').trim();
    if (t === '') return 'Required.';
    const n = Number(t);
    if (!Number.isFinite(n)) return 'Must be a finite number.';
    return '';
  };

  const setField = (key: string, v: string) => {
    setValues((p) => ({ ...p, [key]: v }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: validate(key, v) }));
    if (sample) setSample((sm) => (sm ? { ...sm, label: sm.label.endsWith('(edited)') ? sm.label : `${sm.label} (edited)` } : sm));
  };

  const loadSample = (id: string) => {
    const sm = samples.find((x) => x.id === id);
    if (!sm) return;
    const v: Record<string, string> = {};
    for (const [key, value] of Object.entries(sm.features)) v[key] = value == null ? '' : String(value);
    setValues(v);
    setErrors({});
    setSample({ id: sm.id, label: sm.label, groundTruth: sm.groundTruth, readingId: sm.readingId });
  };

  const run = async () => {
    const errs: Record<string, string> = {};
    for (const f of features) {
      const e = validate(f.key, values[f.key]);
      if (e) errs[f.key] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`feat-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    const submitted: Record<string, number> = {};
    for (const f of features) submitted[f.key] = Number(values[f.key].trim());
    await operation.run(async () => {
      const response = await adapter.runAnalysis({ features: submitted, sampleId: sample?.id });
      const unedited = sample && !sample.label.endsWith('(edited)');
      return { submitted, response, sampleId: unedited ? sample.id : undefined, groundTruth: unedited ? sample.groundTruth : undefined };
    });
  };

  const { client } = useBackend();
  if (client)
    return (
      <div>
        <PageHeader title="Manual analysis" subtitle="Backend manual replay, full-window agent analysis, five-feature packet scoring and cached examples. Separate from the live stream.">
          <HostedDemoLink />
        </PageHeader>
        <BackendAnalysis />
      </div>
    );

  const resp = result?.response;
  const truth = result?.groundTruth ?? null;

  return (
    <div>
      <PageHeader title="Manual analysis" subtitle="Run one reading through the classifier. Results are not written to the incident store.">
        <HostedDemoLink />
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel className="self-start">
          <PanelHead title="Input reading" meta={sample ? <>Loaded: {sample.label} · source <span className="font-mono">{sample.readingId}</span></> : 'Enter values or load a labeled sample'}>
            <label className="inline-flex items-center gap-2 text-[12px] text-ink-3">
              <span>Sample</span>
              <select
                value=""
                onChange={(e) => loadSample(e.target.value)}
                className="h-8 rounded-[9px] border border-divider-strong bg-raised px-2 text-[12.5px] text-ink"
                data-testid="select-sample"
                disabled={!samples.length || !features.length}
              >
                <option value="" disabled>
                  Load sample…
                </option>
                {samples.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </PanelHead>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
            className="px-5 py-4"
          >
            {sample && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-leaf-strong bg-leaf px-3 py-2 text-[12.5px] text-ink-2" data-testid="text-ground-truth">
                Ground truth (sample label): <ClassTag cls={sample.groundTruth} />
                {sample.label.endsWith('(edited)') && <span className="text-amber">Inputs edited; label may no longer apply</span>}
              </div>
            )}
            <div className="space-y-3">
              {features.map((f) => (
                <div key={f.key} className="grid items-start gap-x-3 gap-y-1 sm:grid-cols-[170px_1fr]">
                  <label htmlFor={`feat-${f.key}`} className="pt-2">
                    <span className="block font-mono text-[12.5px] text-info-ink">{f.key}</span>
                    <span className="block text-[11.5px] text-ink-3">
                      {f.label} · {fmtUnit(f)}
                    </span>
                  </label>
                  <div>
                    <input
                      id={`feat-${f.key}`}
                      inputMode="decimal"
                      value={values[f.key] ?? ''}
                      onChange={(e) => setField(f.key, e.target.value)}
                      onBlur={(e) => setErrors((er) => ({ ...er, [f.key]: validate(f.key, e.target.value) }))}
                      aria-invalid={!!errors[f.key]}
                      aria-describedby={errors[f.key] ? `err-${f.key}` : undefined}
                      className={cn('h-9 w-full rounded-[9px] border bg-raised px-3 text-right font-mono text-[13px] text-ink', errors[f.key] ? 'border-rose bg-blush' : 'border-divider-strong focus-visible:border-lav')}
                      data-testid={`input-feature-${f.key}`}
                    />
                    {errors[f.key] && (
                      <p id={`err-${f.key}`} className="mt-1 text-[12px] text-rose">
                        {errors[f.key]}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-divider pt-4">
              <Btn type="submit" variant="primary" disabled={status === 'submitting' || !features.length} data-testid="button-run-analysis">
                {status === 'submitting' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />}
                {status === 'submitting' ? 'Analyzing…' : 'Run analysis'}
              </Btn>
              <Btn
                type="button"
                variant="ghost"
                onClick={() => {
                  setValues({});
                  setErrors({});
                  setSample(null);
                }}
                data-testid="button-clear-inputs"
              >
                Clear inputs
              </Btn>
            </div>
            {(status === 'failed' || status === 'unknown') && failMsg && (
              <div className="mt-3">
                <ErrorNote>{failMsg}</ErrorNote>
              </div>
            )}
          </form>
        </Panel>

        <Panel className="self-start">
          <PanelHead
            title="Result"
            meta={resp ? <span className="font-mono">{resp.analysisId}</span> : 'No analysis run yet'}
          />
          {!resp ? (
            <Empty icon={ScanSearch} title="Run analysis to see a result" body="Load a labeled sample, adjust any feature, then run. The result stays tied to the exact values submitted." />
          ) : (
            <div className="px-5 py-4" data-testid="panel-result">
              {stale && (
                <div role="status" className="mb-4 flex items-start gap-2 rounded-[8px] border border-amber/30 bg-amber/[0.07] px-3 py-2 text-[12.5px] text-amber" data-testid="status-previous-result">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Previous run. Inputs have changed since this result; run analysis again to update it.
                </div>
              )}
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <div className="text-[12px] text-ink-3">Predicted class</div>
                  <div className="mt-1 text-[22px] font-medium">
                    <ClassTag cls={resp.predicted} />
                  </div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-3">Confidence</div>
                  <div className="mt-1 text-[22px] font-medium tnum text-ink">{fmtConf(resp.confidence)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-ink-3">Status</div>
                  <div className="mt-1.5 text-[13px] text-mint">Completed</div>
                </div>
              </div>
              <dl className="mt-4">
                {truth && (
                  <Field k="Ground truth (sample label)">
                    <ClassTag cls={truth} /> {truth === resp.predicted ? <span className="ml-2 text-[12px] text-mint">matches prediction</span> : <span className="ml-2 text-[12px] text-amber">differs from prediction</span>}
                  </Field>
                )}
                <Field k="Escalation">{resp.wouldEscalate ? <span className="text-rose">Counts toward incident rule</span> : 'Would not escalate'}</Field>
              </dl>
              <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Class probabilities</h3>
              <ul className="space-y-1.5">
                {(Object.entries(resp.probabilities) as [ClassLabel, number][]).map(([k, v]) => (
                  <li key={k} className="grid grid-cols-[140px_1fr_56px] items-center gap-2 text-[12.5px]">
                    <span className="text-ink-2">{CLASS_LABEL[k]}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                      <span className="block h-full rounded-full" style={{ width: `${v * 100}%`, background: k === resp.predicted ? 'var(--color-info)' : 'var(--color-support)' }} />
                    </span>
                    <span className="text-right tnum">{fmtConf(v)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Submitted input</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[8px] border border-divider bg-nav px-3 py-2 sm:grid-cols-3">
                {Object.entries(result!.submitted).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 font-mono text-[11.5px]">
                    <span className="text-ink-3">{k}</span>
                    <span className={cn('tnum', !(values[k] ?? '').trim() || Number(values[k]) !== v ? 'text-amber' : 'text-ink')}>{v}</span>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-1 text-[12.5px] text-ink-2">
                {resp.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              {resp.sparta.length > 0 && (
                <>
                  <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">SPARTA context</h3>
                  <ul className="divide-y divide-divider rounded-[8px] border border-divider">
                    {resp.sparta.map((t) => (
                      <li key={t.id} className="px-3 py-2 text-[12.5px]">
                        <span className="font-mono text-lav">{t.id}</span> <span className="text-ink">{t.technique}</span> <span className="text-ink-3">· {t.tactic}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {resp.mitigations.length > 0 && (
                <>
                  <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink">Mitigation guidance (review only)</h3>
                  <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
                    {resp.mitigations.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              )}
              {resp.report && (
                <div className="mt-5 border-t border-divider pt-4">
                  <ReportProse body={resp.report} />
                </div>
              )}
              <div className="mt-5 flex items-center justify-end">
                <CopyButton text={JSON.stringify(resp, null, 2)} label="Copy response" />
              </div>
              <div className="mt-2">
                <RawBlock title="Raw analysis response" data={resp} />
              </div>
            </div>
          )}
        </Panel>
      </div>
      <BackendAnalysis />
    </div>
  );
}
