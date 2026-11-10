import { type ReactNode } from 'react';
import { PlugZap } from 'lucide-react';
import { Empty } from '@/components/kit';
import { useBackend } from '@/lib/backend/context';
import { useDurableState } from '@/lib/sentinel/operations';

export const inputCls = (bad?: boolean) =>
  `mt-1.5 h-9 w-full rounded-[9px] border bg-raised px-3 tnum text-[13px] text-ink ${bad ? 'border-rose bg-blush' : 'border-divider-strong focus-visible:border-lav'}`;
export const selectCls = 'mt-1.5 h-9 w-full rounded-[9px] border border-divider-strong bg-raised px-2 text-[13px] text-ink';

export const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
export const isNormal = (c: string | null | undefined) => !!c && (c === 'nominal' || c.toLowerCase() === 'normal');

/** Persist non-secret form values per backend identity (base URL). */
export function usePersisted<T>(name: string, initial: T, migrate?: (saved: T) => T): [T, (v: T | ((p: T) => T)) => void, string] {
  const { client } = useBackend();
  const key = `sentinelsat.backend.${client?.base ?? 'none'}.${name}`;
  const [value, setValue] = useDurableState<T>(key, initial, saved => migrate ? migrate({ ...initial, ...saved }) : ({ ...initial, ...saved }));
  return [value, setValue, key];
}

/** Patch a persisted value directly (used when a request resolves after its page unmounted). */
export function patchStored<T>(key: string, fn: (v: T) => T) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) localStorage.setItem(key, JSON.stringify(fn(JSON.parse(raw))));
  } catch {
    /* ignore */
  }
}

export function ConnectRequired({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <Empty icon={PlugZap} title="Connect backend required" body={`${what} needs a connected SentinelSat backend. Use the connection setup in the navigation to add one. Nothing is submitted while disconnected.`}>
      {children}
    </Empty>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink">
      {children}
    </label>
  );
}
