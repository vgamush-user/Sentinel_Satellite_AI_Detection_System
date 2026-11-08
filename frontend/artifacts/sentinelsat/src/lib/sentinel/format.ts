import type { ClassLabel, FeatureDef } from './types';

export const CLASS_LABEL: Record<ClassLabel, string> = new Proxy({
  nominal: 'Nominal',
  jamming: 'Jamming',
  spoofing: 'Spoofing',
  command_injection: 'Command injection',
}, { get: (labels, key) => typeof key === 'string' ? Reflect.get(labels, key) ?? key : Reflect.get(labels, key) });

export function isNominal(value: string) {
  return value === 'nominal' || value.toLowerCase() === 'normal';
}

export function fmtTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  return new Date(ts).toISOString().slice(11, 19);
}

export function fmtDateTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return 'Unavailable';
  const iso = new Date(ts).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

export function fmtConf(c: number | null | undefined, digits = 1) {
  if (c == null || !Number.isFinite(c)) return '—';
  return `${(c * 100).toFixed(digits)}%`;
}

export function fmtValue(v: number | null | undefined, f?: FeatureDef) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(f?.digits ?? 2);
}

export function fmtUnit(f: FeatureDef) {
  return f.unit ?? 'unit n/a';
}

export function fmtAge(ms: number | null) {
  if (ms == null) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function fmtInt(n: number) {
  return n.toLocaleString('en-US');
}
