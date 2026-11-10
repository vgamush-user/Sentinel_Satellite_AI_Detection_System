import type { Dispatch, SetStateAction } from 'react';
import { useLocation, useSearch } from 'wouter';

/** URL owns investigation state. Replacing edits avoids a history entry per keystroke. */
export function useQueryState<T>(key: string, fallback: T, valid?: (value: T) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const decode = (params: URLSearchParams): T => {
    const raw = params.get(key);
    if (raw == null) return fallback;
    try {
      const value = (typeof fallback === 'string' ? raw : JSON.parse(raw)) as T;
      return valid && !valid(value) ? fallback : value;
    } catch { return fallback; }
  };
  const value = decode(new URLSearchParams(search));
  const set: Dispatch<SetStateAction<T>> = update => {
    const params = new URLSearchParams(window.location.search);
    const previous = decode(params);
    const next = typeof update === 'function' ? (update as (old: T) => T)(previous) : update;
    if (next == null || next === fallback) params.delete(key);
    else params.set(key, typeof next === 'string' ? next : JSON.stringify(next));
    const suffix = params.toString();
    navigate(path + (suffix ? `?${suffix}` : ''), { replace: true });
  };
  return [value, set];
}
