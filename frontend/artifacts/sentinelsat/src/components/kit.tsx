import { forwardRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Check, ChevronDown, CircleAlert, CircleCheck, CircleDashed, Clock3, Copy, FileText, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CLASS_LABEL, fmtConf, isNominal } from '@/lib/sentinel/format';
import type { ClassLabel, Lifecycle, ReportStatus } from '@/lib/sentinel/types';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }>(
  function Btn({ variant = 'secondary', size = 'md', className, ...p }, ref) {
    return (
      <button
        ref={ref}
        {...p}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity,transform] active:translate-y-px duration-150 ease-ui disabled:opacity-45 disabled:cursor-not-allowed select-none',
          size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13px]',
          variant === 'primary' && 'bg-action text-on-action font-semibold shadow-[0_2px_0_#c40000] hover:bg-action-hover active:bg-action-pressed',
          variant === 'secondary' && 'border border-divider-strong/70 bg-raised text-ink hover:border-info hover:bg-sky',
          variant === 'ghost' && 'text-ink-2 hover:text-ink hover:bg-sun',
          variant === 'danger' && 'border border-rose/40 bg-blush text-rose hover:bg-danger-hover',
          className,
        )}
      />
    );
  },
);

export function Panel({ className, children, ...p }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section {...p} className={cn('min-w-0 rounded-[16px] border border-divider bg-panel soft-shadow', className)}>
      {children}
    </section>
  );
}

export function PanelHead({ title, meta, children, id }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-divider px-4 py-3 md:px-5">
      <div className="min-w-0 basis-[200px] grow">
        <h2 id={id} className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">
          <span aria-hidden className="h-4 w-1.5 rounded-full bg-[linear-gradient(var(--color-palette-blue),var(--color-palette-lime))]" />
          {title}
        </h2>
        {meta && <div className="mt-0.5 text-[12px] text-ink-3">{meta}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-[26px] md:text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-2">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function NativeSelect({ label, className, children, hideLabel, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-[12px] text-ink-3', className)}>
      <span className={cn(hideLabel && 'sr-only')}>{label}</span>
      <span className="relative inline-flex">
        <select
          {...p}
          className="h-8 appearance-none rounded-[9px] border border-divider-strong bg-raised pl-2.5 pr-7 text-[12.5px] text-ink hover:border-info-ink hover:bg-sky focus-visible:border-action"
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, size = 'sm' }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-divider bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          data-testid={`segment-${label.replace(/\s+/g, '-').toLowerCase()}-${o.value}`}
          className={cn(
            'rounded-[8px] px-2.5 font-medium tnum transition-colors duration-150 disabled:opacity-35 disabled:cursor-not-allowed',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[12.5px]',
            value === o.value ? 'bg-sun-strong text-ink font-semibold shadow-[inset_0_0_0_1px_var(--color-palette-orange)]' : 'text-ink-3 hover:bg-sun hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CLASS_TONE: Record<string, string> = {
  nominal: 'text-ink-2 bg-hover',
  jamming: 'text-rose bg-blush',
  spoofing: 'text-amber bg-peach',
  command_injection: 'text-highlight bg-sun',
};

export function ClassTag({ cls, prefix }: { cls: ClassLabel; prefix?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[12px] font-medium', CLASS_TONE[cls] ?? (isNominal(cls) ? CLASS_TONE.nominal : 'text-rose bg-blush'))}>
      <span aria-hidden className={cn('size-1.5 rounded-full', isNominal(cls) ? 'bg-ink-3/60' : 'bg-current')} />
      {prefix}
      {CLASS_LABEL[cls]}
    </span>
  );
}

export function PredictionCell({ cls, confidence, threshold = 0.7 }: { cls: ClassLabel; confidence: number; threshold?: number }) {
  const sus = !isNominal(cls) && confidence < threshold;
  return (
    <span className="inline-flex items-center gap-1.5">
      <ClassTag cls={cls} />
      {sus && <span className="rounded-full border border-amber/30 bg-peach px-1.5 text-[10.5px] font-medium text-amber">below threshold</span>}
    </span>
  );
}

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  return lifecycle === 'open' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blush px-2 py-0.5 text-[12px] font-medium text-rose">
      <ShieldAlert aria-hidden className="size-3.5" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf px-2 py-0.5 text-[12px] font-medium text-mint">
      <CircleCheck aria-hidden className="size-3.5" /> Closed
    </span>
  );
}

export function ReportBadge({ status }: { status: ReportStatus }) {
  const m = {
    ready: { icon: FileText, text: 'Report ready', cls: 'text-mint' },
    pending: { icon: Loader2, text: 'Pending', cls: 'text-amber' },
    failed: { icon: XCircle, text: 'Failed', cls: 'text-rose' },
    unavailable: { icon: CircleDashed, text: 'After close', cls: 'text-ink-3' },
  }[status];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]', m.cls)}>
      <Icon aria-hidden className={cn('size-3.5', status === 'pending' && 'animate-spin [animation-duration:2.4s]')} />
      {m.text}
    </span>
  );
}

export function ConfidenceBar({ value, threshold }: { value: number; threshold?: number }) {
  return (
    <span className="inline-flex items-center gap-2 tnum">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-sky-strong" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-info" style={{ width: `${value * 100}%` }} />
        {threshold != null && <span className="absolute inset-y-0 w-0.5 bg-danger-ink" style={{ left: `${threshold * 100}%` }} />}
      </span>
      {fmtConf(value)}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Btn
      size="sm"
      variant="ghost"
      aria-label={label}
      data-testid="button-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone('ok');
        } catch {
          setDone('fail');
        }
        setTimeout(() => setDone('idle'), 1600);
      }}
    >
      {done === 'ok' ? <Check className="size-3.5 text-mint" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{done === 'ok' ? 'Copied' : done === 'fail' ? 'Copy blocked' : label}</span>
    </Btn>
  );
}

export function RawBlock({ title, data, defaultOpen = false }: { title: string; data: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="rounded-[12px] border border-dashed border-support/60 bg-hover/60">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 py-1 text-left text-[12px] text-ink-2 hover:text-ink"
          data-testid="button-toggle-raw"
        >
          <ChevronDown aria-hidden className={cn('size-3.5 transition-transform duration-150', !open && '-rotate-90')} />
          <span className="rounded-full bg-sky-strong px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider text-info-ink">raw</span>
          {title}
        </button>
        <CopyButton text={text} label="Copy JSON" />
      </div>
      {open && (
        <pre className="max-h-80 overflow-auto border-t border-dashed border-support/60 bg-panel px-3 rounded-b-[12px] py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2 whitespace-pre-wrap break-all">
          {text}
        </pre>
      )}
    </div>
  );
}

export function Empty({ icon: Icon = Clock3, title, body, children }: { icon?: typeof Clock3; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-[14px] bg-sky text-info-ink ring-4 ring-sun">
        <Icon aria-hidden className="size-4" />
      </span>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-[12.5px] text-ink-3">{body}</p>}
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-rose/30 bg-blush px-3 py-2 text-[12.5px] text-rose">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[6px] bg-hover', className)} />;
}

export function Field({ k, children, mono }: { k: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(110px,40%)_1fr] gap-3 border-b border-divider/70 py-2 last:border-0">
      <dt className="text-[12.5px] text-ink-3">{k}</dt>
      <dd className={cn('min-w-0 break-words text-[13px] text-ink', mono && 'font-mono text-[12.5px]')}>{children}</dd>
    </div>
  );
}
