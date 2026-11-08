import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createAdapter, type SentinelAdapter } from './adapter';
import type { AdapterEvent, AttackAck, ConnectionState, Incident, Playback, Reading, SourceConfig, StateSnapshot, Stats } from './types';

export interface ClientState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  connection: ConnectionState;
  config: SourceConfig | null;
  readings: Reading[];
  readingIndex: Map<string, Reading>;
  incidents: Incident[];
  stats: Stats | null;
  playback: Playback | null;
  /** wall-clock ms of the last delivered reading */
  lastReceivedAt: number | null;
  lastResync: { at: number; added: number; duplicates: number; incidentsUpdated: number } | null;
  runs: AttackAck[];
}

class Store {
  state: ClientState = {
    status: 'loading',
    connection: 'connecting',
    config: null,
    readings: [],
    readingIndex: new Map(),
    incidents: [],
    stats: null,
    playback: null,
    lastReceivedAt: null,
    lastResync: null,
    runs: [],
  };
  private subs = new Set<() => void>();
  constructor(public adapter: SentinelAdapter) {}

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  get = () => this.state;
  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.subs.forEach((s) => s());
  }

  private mergeReadings(incoming: Reading[], bufferSize?: number) {
    const index = new Map(this.state.readingIndex);
    let added = 0;
    let duplicates = 0;
    for (const r of incoming) {
      const prev = index.get(r.id);
      if (prev) {
        if (prev.decision === r.decision && prev.incidentId === r.incidentId) duplicates++;
      } else added++;
      index.set(r.id, r);
    }
    let list = [...index.values()].sort((a, b) => a.seq - b.seq);
    const cap = bufferSize ?? this.state.config?.bufferSize ?? 900;
    if (list.length > cap) {
      for (const r of list.slice(0, list.length - cap)) index.delete(r.id);
      list = list.slice(-cap);
    }
    return { list, index, added, duplicates };
  }

  private mergeIncidents(incoming: Incident[]) {
    const m = new Map(this.state.incidents.map((i) => [i.id, i]));
    for (const i of incoming) m.set(i.id, i);
    return [...m.values()].sort((a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id));
  }

  private applySnapshot(s: StateSnapshot, resync: boolean) {
    const before = this.state.incidents.length;
    const { list, index, added, duplicates } = this.mergeReadings(s.readings, s.config.bufferSize);
    const incidents = this.mergeIncidents(s.incidents);
    this.set({
      status: 'ready',
      error: undefined,
      config: s.config,
      readings: list,
      readingIndex: index,
      incidents,
      stats: s.stats,
      playback: s.playback,
      lastReceivedAt: added > 0 ? Date.now() : this.state.lastReceivedAt,
      lastResync: resync ? { at: Date.now(), added, duplicates, incidentsUpdated: incidents.length - before } : this.state.lastResync,
    });
  }

  onEvent = (e: AdapterEvent) => {
    switch (e.type) {
      case 'readings': {
        const { list, index, added } = this.mergeReadings(e.readings);
        this.set({ readings: list, readingIndex: index, lastReceivedAt: added > 0 ? Date.now() : this.state.lastReceivedAt });
        break;
      }
      case 'incidents':
        this.set({ incidents: this.mergeIncidents(e.incidents) });
        break;
      case 'stats':
        this.set({ stats: e.stats });
        break;
      case 'playback':
        this.set({ playback: e.playback });
        break;
      case 'connection':
        this.set({ connection: e.state });
        break;
      case 'resync':
        this.applySnapshot(e.snapshot, true);
        break;
      case 'runs':
        this.set({ runs: e.runs });
        break;
    }
  };

  async init() {
    try {
      this.set({ connection: 'connecting', status: 'loading' });
      const s = await this.adapter.getState();
      this.applySnapshot(s, false);
      this.set({ connection: this.adapter.mode === 'sample' ? 'connected' : this.state.connection, runs: this.adapter.getRuns() });
    } catch (err) {
      this.set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load state' });
    }
  }
}

const Ctx = createContext<Store | null>(null);

export function SentinelProvider({ children, adapter }: { children: ReactNode; adapter?: SentinelAdapter }) {
  const [store] = useState(() => new Store(adapter ?? createAdapter()));
  useEffect(() => {
    const unsub = store.adapter.subscribe(store.onEvent);
    void store.init();
    return () => {
      unsub();
    };
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('SentinelProvider missing');
  return s;
}

export function useSentinel() {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useAdapter() {
  return useStore().adapter;
}

export function useRetryInit() {
  const store = useStore();
  return () => void store.init();
}

/** Wall clock that re-renders every `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Keeps the latest value in a ref for stable callbacks. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
