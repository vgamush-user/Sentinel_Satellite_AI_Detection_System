import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

type Setter<T> = (next: T | ((previous: T) => T)) => void;
/** Provider-owned cells survive route unmounts; storage is a checkpoint, never a request queue. */
export class DurableCell<T> {
  private value: T;
  private listeners = new Set<() => void>();
  constructor(private key: string, initial: T, migrate?: (value: T) => T) {
    this.value = initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.value = migrate ? migrate(JSON.parse(raw)) : JSON.parse(raw);
    } catch { /* Invalid/unavailable storage leaves the current workspace usable. */ }
  }
  get = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set: Setter<T> = next => {
    this.value = typeof next === 'function' ? (next as (v: T) => T)(this.value) : next;
    try { localStorage.setItem(this.key, JSON.stringify(this.value)); } catch { /* session remains usable */ }
    this.listeners.forEach(listener => listener());
  };
}

const Context = createContext<Map<string, DurableCell<unknown>> | null>(null);
export function OperationsProvider({ children }: { children: ReactNode }) {
  const [cells] = useState(() => new Map<string, DurableCell<unknown>>());
  return <Context.Provider value={cells}>{children}</Context.Provider>;
}
export function useDurableState<T>(key: string, initial: T, migrate?: (value: T) => T): [T, Setter<T>] {
  const cells = useContext(Context);
  if (!cells) throw new Error('OperationsProvider missing');
  let cell = cells.get(key) as DurableCell<T> | undefined;
  if (!cell) {
    cell = new DurableCell(key, initial, migrate);
    cells.set(key, cell as DurableCell<unknown>);
  }
  return [useSyncExternalStore(cell.subscribe, cell.get), cell.set];
}

export interface Operation<T> {
  status: 'idle' | 'pending' | 'succeeded' | 'failed' | 'unknown';
  id?: string;
  result?: T;
  error?: string;
}
export function recoverOperation<T>(value: Operation<T>): Operation<T> {
  return value?.status === 'pending' ? { ...value, status: 'unknown', error: 'The page reloaded before completion was confirmed. No request was retried.' } : value ?? { status: 'idle' };
}
export async function executeOperation<T>(cell: DurableCell<Operation<T>>, work: () => Promise<T>) {
  if (cell.get().status === 'pending') return;
  const id = crypto.randomUUID();
  cell.set(previous => ({ ...previous, id, status: 'pending', error: undefined }));
  try {
    const result = await work();
    if (cell.get().id === id) cell.set({ id, status: 'succeeded', result });
  } catch (error) {
    const uncertain = error instanceof TypeError || error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name);
    if (cell.get().id === id) cell.set(previous => ({ ...previous, status: uncertain ? 'unknown' : 'failed',
      error: uncertain ? 'Completion could not be confirmed. Check the run evidence before submitting again; no request was retried.' : error instanceof Error ? error.message : 'Request failed. No automatic retry was made.' }));
  }
}
export function useOperation<T>(key: string) {
  const [operation] = useDurableState<Operation<T>>(key, { status: 'idle' }, recoverOperation);
  // The cell, not the render's snapshot, guards duplicate submissions synchronously.
  const cells = useContext(Context)!;
  const run = (work: () => Promise<T>) => executeOperation(cells.get(key) as DurableCell<Operation<T>>, work);
  return { ...operation, run };
}
