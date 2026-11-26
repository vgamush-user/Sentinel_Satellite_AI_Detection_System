import type { SentinelAdapter } from '@/lib/sentinel/adapter';
import type { AdapterEvent, AnalysisRequest, AttackAck, AttackRequest, ReplayAction, Scenario } from '@/lib/sentinel/types';
import { BackendClient } from './client';
import { normalizeData, normalizeIncident } from './normalize';
import type { BackendData } from './reducer';

export class ConnectedAdapter implements SentinelAdapter {
  readonly mode = 'connected' as const;
  readonly sourceLabel = 'Connected backend';
  constructor(readonly client: BackendClient) {}
  async getState() {
    await this.client.initial();
    const data = this.client.get().data;
    if (!data) throw new Error('Backend snapshot is not available.');
    return normalizeData(data);
  }
  subscribe(cb: (event: AdapterEvent) => void) {
    let previous: BackendData | null = null;
    let previousVersion = -1;
    const unsub = this.client.subscribe(() => {
      const state = this.client.get();
      if (state.data && state.data !== previous) {
        const snapshot = normalizeData(state.data);
        if (state.syncVersion !== previousVersion) cb({ type: 'resync', snapshot });
        else {
          if (state.data.recent !== previous?.recent || state.data.decisions !== previous?.decisions || state.data.incidents !== previous?.incidents)
            cb({ type: 'readings', readings: snapshot.readings });
          if (state.data.incidents !== previous?.incidents) cb({ type: 'incidents', incidents: snapshot.incidents });
          if (state.data.stats !== previous?.stats) cb({ type: 'stats', stats: snapshot.stats });
        }
        previous = state.data;
        previousVersion = state.syncVersion;
      }
      cb({ type: 'connection', state: state.transport });
    });
    return () => { unsub(); this.client.stop(); };
  }
  async getIncident(id: string) {
    const raw = await this.client.incident(id);
    return normalizeIncident(raw, this.client.get().data ? normalizeData(this.client.get().data!).readings : []);
  }
  async listScenarios(): Promise<Scenario[]> {
    const config = this.client.get().data?.config;
    return (config?.classes ?? []).filter(cls => cls.toLowerCase() !== 'normal').map(cls => ({
      id: cls, cls, name: cls, demonstrates: `Submit labeled ${cls} samples to the real detector.`,
      expected: `The backend applies its configured ${config!.guards.min_rows}-of-${config!.guards.window_rows} rule.`,
      defaults: { count: 15, intensity: 1 }, limits: { count: [1, 100], intensity: [1, 1] },
    }));
  }
  async getSamples() { return []; }
  async runAttack(req: AttackRequest): Promise<AttackAck> {
    const ack = await this.client.attack({ cls: req.scenarioId, count: req.count, quality: 'clean' });
    const runId = ack.entry_ids[0];
    return { runId, scenarioId: req.scenarioId, acceptedAt: Date.now(), scheduledFromSeq: 0, scheduledToSeq: 0,
      readingIds: ack.entry_ids, request: req };
  }
  async replay(_action: ReplayAction): Promise<never> { throw new Error('The live Kafka stream is backend-owned. Use the independent Manual Analysis replay controls.'); }
  async runAnalysis(_request: AnalysisRequest): Promise<never> { throw new Error('Use the backend window analyzer or separate five-feature packet model.'); }
  async retryReport(_id: string): Promise<never> { throw new Error('This backend does not expose a report-retry endpoint.'); }
  disconnect() { this.client.stop(); }
  async reconnect() { this.client.reconnect(); }
  reset() { throw new Error('Reset is only available in Sample demo mode.'); }
  getRuns(): AttackAck[] { return []; }
}
