import { gatewayBase } from './client';

const KEY = 'sentinelsat.backend.connection.v1';
export function backendAddress(): string | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'mode' in saved && saved.mode === 'sample') return null;
  } catch { /* Gateway mode is the default; invalid settings never activate a direct connection. */ }
  return gatewayBase();
}
export function saveBackendAddress(url: string | null) {
  if (url && url !== gatewayBase()) throw new Error('Only the same-origin server gateway can be selected.');
  localStorage.setItem(KEY, JSON.stringify({ mode: url ? 'gateway' : 'sample' }));
}
