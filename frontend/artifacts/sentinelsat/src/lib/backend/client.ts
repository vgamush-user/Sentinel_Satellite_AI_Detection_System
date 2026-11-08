import type { z } from 'zod';
import { batchSchema, customEntryCountSchema, examplesSchema, incidentSchema, initialSchema, manualReplaySchema, packetResultSchema,
  sampleSchema, submissionSchema, windowResultSchema, type BackendInitial, type BackendBatch,
  type ManualAction, type ReplaySettings, type BackendRow, type BackendDecision } from './protocol';
import { applyBatch, hydrate, mergeStored, type BackendData } from './reducer';

export interface BackendState {
  data: BackendData | null;
  transport: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  error: string | null;
  receivedAt: number | null;
  evidence: Map<string, BackendRow>;
  evidenceDecisions: Map<string, BackendDecision>;
  syncVersion: number;
  statsReceivedAt: number | null;
}
export function validateBackendUrl(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP(S) backend URL without credentials, query parameters, or fragments.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol !== 'https:' && !loopback)
    throw new Error('This HTTPS dashboard needs an HTTPS backend to avoid blocked mixed-content requests.');
  return url.href.replace(/\/$/, '');
}
export function gatewayBase(origin = location.origin, basePath = import.meta.env?.BASE_URL ?? '/') {
  const prefix = basePath.replace(/\/$/, '');
  return new URL(prefix || '/', origin).href.replace(/\/$/, '');
}
export class BackendClient {
  readonly base: string;
  readonly readOnlyGateway: boolean;
  private listeners = new Set<() => void>();
  private state: BackendState = { data: null, transport: 'connecting', error: null, receivedAt: null, evidence: new Map(), evidenceDecisions: new Map(), syncVersion: 0, statsReceivedAt: null };
  private trackedIds = new Set<string>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private buffered: BackendBatch[] | null = null;
  private started = false;
  private generation = 0;
  constructor(base?: string) {
    this.base = validateBackendUrl(base ?? gatewayBase());
    this.readOnlyGateway = import.meta.env?.VITE_SENTINEL_DEPLOYMENT === 'local'
      ? false : base == null || typeof window !== 'undefined';
    if (typeof window !== 'undefined' && this.base !== gatewayBase())
      throw new Error('Use the same-origin server gateway. Direct browser connections are disabled.');
  }
  get = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<BackendState>) {
    let evidence = patch.evidence ?? this.state.evidence;
    for (const row of patch.data?.recent ?? []) {
      if (this.trackedIds.has(row.entry_id) && evidence.get(row.entry_id) !== row) {
        if (evidence === this.state.evidence) evidence = new Map(evidence);
        evidence.set(row.entry_id, row);
      }
    }
    let evidenceDecisions = patch.evidenceDecisions ?? this.state.evidenceDecisions;
    for (const [id, decision] of patch.data?.decisions ?? []) {
      if (this.trackedIds.has(id) && evidenceDecisions.get(id) !== decision) {
        if (evidenceDecisions === this.state.evidenceDecisions) evidenceDecisions = new Map(evidenceDecisions);
        evidenceDecisions.set(id, decision);
      }
    }
    const statsReceivedAt = patch.data && patch.data.stats !== this.state.data?.stats ? Date.now() : this.state.statsReceivedAt;
    this.state = { ...this.state, ...patch, evidence, evidenceDecisions, statsReceivedAt };
    this.listeners.forEach(fn => fn());
  }
  /** Retain evidence for submitted entries while the user visits other pages. */
  trackEntries(ids: string[]) {
    ids.forEach(id => this.trackedIds.add(id));
    while (this.trackedIds.size > 1000) this.trackedIds.delete(this.trackedIds.keys().next().value!);
    const evidence = new Map([...this.state.evidence].filter(([id]) => this.trackedIds.has(id)));
    const evidenceDecisions = new Map([...this.state.evidenceDecisions].filter(([id]) => this.trackedIds.has(id)));
    this.update({ evidence, evidenceDecisions, data: this.state.data });
  }
  async request<T>(path: string, schema: z.ZodType<T>, payload?: unknown, signal?: AbortSignal, allowEmpty = false): Promise<T> {
    if (this.readOnlyGateway && (payload !== undefined || !/^\/api\/(?:state|incidents\/[^/?]+)$/.test(path)))
      throw new Error('This gateway is read-only. Only telemetry state, incident reads, and the live stream are authorized.');
    const timeout = AbortSignal.timeout(20000);
    const response = await fetch(this.base + path, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(payload !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
    });
    if (response.status === 204 && response.ok) {
      if (allowEmpty) return undefined as T;
      throw new Error(`The backend returned no data for ${path}.`);
    }
    const value: unknown = await response.json().catch(() => { throw new Error(`Backend returned non-JSON data (${response.status}). Check the API address.`); });
    if (!response.ok) {
      const detail = value && typeof value === 'object' && 'detail' in value ? value.detail : null;
      throw new Error(typeof detail === 'string' ? detail : `Backend request failed (${response.status}).`);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error(`Unexpected response from ${path}. The backend contract does not match.`);
    return parsed.data;
  }
  probe(signal?: AbortSignal) { return this.request('/api/state', initialSchema, undefined, signal); }
  private async resync() {
    this.controller?.abort();
    const controller = new AbortController();
    const generation = this.generation;
    this.controller = controller;
    this.buffered = [];
    try {
      const snapshot = await this.probe(controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return;
      const data = hydrate(this.state.data, snapshot, this.buffered ?? []);
      this.buffered = null;
      this.update({ data, syncVersion: this.state.syncVersion + 1, error: null, transport: this.socket?.readyState === WebSocket.OPEN ? 'connected' : this.state.transport });
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      if (this.state.data) {
        let data = this.state.data;
        for (const frame of this.buffered ?? []) data = applyBatch(data, frame);
        this.update({ data });
      }
      this.buffered = null;
      this.update({ error: error instanceof Error ? error.message : 'Could not synchronize backend state.' });
    }
  }
  start() {
    if (this.started) return;
    this.started = true;
    void this.resync();
    this.connect();
  }
  private connect() {
    if (!this.started) return;
    const wsUrl = new URL(this.base + '/ws');
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(wsUrl);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.started) return;
      this.update({ transport: 'reconnecting' });
      void this.resync();
      this.ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping'); }, 20000);
    };
    socket.onmessage = event => {
      if (this.socket !== socket || !this.started) return;
      try {
        const frame = batchSchema.parse(JSON.parse(event.data));
        if (this.buffered) this.buffered.push(frame);
        else if (this.state.data) this.update({ data: applyBatch(this.state.data, frame) });
        this.update({ receivedAt: frame.telemetry?.length ? Date.now() : this.state.receivedAt });
      } catch { this.update({ error: 'A malformed backend update was rejected. Retrying synchronization is available.' }); }
    };
    socket.onclose = () => {
      if (this.socket !== socket || !this.started) return;
      if (this.ping) clearInterval(this.ping);
      this.update({ transport: 'disconnected' });
      this.retry = setTimeout(() => { this.update({ transport: 'reconnecting' }); this.connect(); }, 2000);
    };
    socket.onerror = () => { if (this.socket === socket) this.update({ error: 'Backend stream unavailable. Check the address, network, and WebSocket access.' }); };
  }
  stop() {
    this.started = false;
    this.generation++;
    this.controller?.abort();
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
  }
  reconnect() { this.stop(); this.update({ transport: 'reconnecting' }); this.start(); }
  async initial(): Promise<BackendInitial> {
    const generation = this.generation;
    try {
      const snapshot = await this.probe();
      if (generation !== this.generation) throw new Error('Connection changed before synchronization completed.');
      this.update({ data: hydrate(this.state.data, snapshot, []), syncVersion: this.state.syncVersion + 1, error: null });
      this.start();
      return snapshot;
    } catch (error) {
      if (generation !== this.generation) throw error;
      // Deep-linked screens rely on the shared shell for initial API failures.
      this.update({ error: error instanceof Error ? error.message : 'Could not load backend state.', transport: 'disconnected' });
      throw error;
    }
  }
  async incident(id: string) {
    const generation = this.generation;
    const baseline = this.state.data?.incidents.find(incident => incident.incident_id === id);
    const value = await this.request('/api/incidents/' + encodeURIComponent(id), incidentSchema);
    if (generation !== this.generation) throw new Error('Connection changed before incident lookup completed. Retry the lookup.');
    if (this.state.data) {
      const map = new Map(this.state.data.incidents.map(i => [i.incident_id, i]));
      map.set(id, mergeStored(map.get(id), value, baseline));
      this.update({ data: { ...this.state.data, incidents: [...map.values()] } });
      return map.get(id)!;
    }
    return value;
  }
  sample(cls: string, quality: 'clean' | 'noisy', signal?: AbortSignal) {
    return this.request(`/api/sample?cls=${encodeURIComponent(cls)}&quality=${quality}`, sampleSchema, undefined, signal);
  }
  async send(payload: { features: Record<string, number>; count: number; true_class: string | null; interval_sec: number }) {
    customEntryCountSchema.parse(payload.count);
    const ack = await this.request('/api/panel/send', submissionSchema, payload);
    this.trackEntries(ack.entry_ids);
    return ack;
  }
  async attack(payload: { cls: string; count: number; quality: 'clean' | 'noisy' }) {
    const ack = await this.request('/api/attack', submissionSchema, payload);
    this.trackEntries(ack.entry_ids);
    return ack;
  }
  manualReplay(signal?: AbortSignal) { return this.request('/api/analysis/replay', manualReplaySchema, undefined, signal); }
  async manualControl(action: ManualAction, settings: ReplaySettings) {
    // The source endpoint accepts a settings body for every action and responds with 204.
    const { z } = await import('zod');
    await this.request('/api/analysis/replay/' + action, z.unknown(), settings, undefined, true);
  }
  analyzeWindow() { return this.request('/api/analysis/run', windowResultSchema, {}); }
  scorePacket(payload: Record<string, number>) { return this.request('/api/analysis/predict', packetResultSchema, payload); }
  examples() { return this.request('/api/demo-scenarios', examplesSchema); }
}
