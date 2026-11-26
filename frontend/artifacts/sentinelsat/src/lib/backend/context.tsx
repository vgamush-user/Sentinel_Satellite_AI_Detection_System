import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { BackendClient, type BackendState } from './client';

const Context = createContext<BackendClient | null>(null);
const EMPTY: BackendState = { data: null, transport: 'disconnected', error: null, receivedAt: null, evidence: new Map(), evidenceDecisions: new Map(), syncVersion: 0, statsReceivedAt: null };
const emptySubscribe = () => () => {};
const emptyGet = () => EMPTY;
export function BackendProvider({ client, children }: { client: BackendClient | null; children: ReactNode }) {
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useBackend() {
  const client = useContext(Context);
  const state = useSyncExternalStore(client?.subscribe ?? emptySubscribe, client?.get ?? emptyGet);
  return { client, ...state };
}
