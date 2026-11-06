import { useEffect, useState } from 'react';
import { configSnapshot } from '../../../shared/src/configSnapshot';

/** Session-only recovery: drafts survive tabs, navigation and reload, without remote writes. */
export function useClientDraft<T>(key: string, remote: T) {
  const storageKey = `tuto:client-draft:${key}`;
  const [draft, setDraft] = useState<{ value: T; base: T }>(() => {
    try { const stored = sessionStorage.getItem(storageKey); if (stored) return JSON.parse(stored); } catch { /* Storage may be unavailable. */ }
    return { value: remote, base: remote };
  });
  const dirty = configSnapshot(draft.value) !== configSnapshot(draft.base);
  const remoteSnapshot = configSnapshot(remote);
  useEffect(() => {
    setDraft(current => configSnapshot(current.value) !== configSnapshot(current.base) ? current : { value: remote, base: remote });
  }, [remoteSnapshot]);
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The beforeunload guard still protects the current page. */ }
  }, [draft, dirty, storageKey]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const setValue = (next: T | ((current: T) => T)) => setDraft(current => ({ ...current,
    value: typeof next === 'function' ? (next as (current: T) => T)(current.value) : next }));
  const markSaved = (value: T) => setDraft({ value, base: value });
  const markSavedPartial = (merge: (current: T) => T) => setDraft(current => ({ value: merge(current.value), base: merge(current.base) }));
  return { value: draft.value, base: draft.base, setValue, dirty, markSaved, markSavedPartial, discard: () => markSaved(remote) };
}
