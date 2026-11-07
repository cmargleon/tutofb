import { useEffect, useState } from 'react';
import { changedFields } from '../../../shared/src/fieldConcurrency';
import { configSnapshot } from '../../../shared/src/configSnapshot';
import { useAuth } from '../auth/AuthProvider';
import { auth } from '../../firebase';
import { clientDraftKey, readClientDraft } from './draftStorage';

/** Recovery is session-only. Logout removes this identity's sections; never persist tokens. */
export function useClientDraft<T>(key: string, remote: T, validate?: (value: unknown) => boolean) {
  const { user } = useAuth();
  const storageKey = user ? clientDraftKey(auth.app.options.projectId!, user.uid, key) : null;
  const [stored, setStored] = useState(() => ({ key: storageKey, ...readClientDraft(storageKey, remote, validate) }));
  // Reset during render so the previous identity's values never reach the form or persistence effect.
  let draft = stored;
  if (stored.key !== storageKey) {
    draft = { key: storageKey, ...readClientDraft(storageKey, remote, validate) };
    setStored(draft);
  }
  const dirty = configSnapshot(draft.value) !== configSnapshot(draft.base);
  const remoteSnapshot = configSnapshot(remote);
  useEffect(() => {
    setStored(current => configSnapshot(current.value) !== configSnapshot(current.base) ? current : { key: storageKey, value: remote, base: remote });
  }, [remoteSnapshot, storageKey]);
  useEffect(() => {
    if (!storageKey || auth.currentUser?.uid !== user?.uid) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, value: draft.value, base: draft.base }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The beforeunload guard still protects the current page. */ }
  }, [draft, dirty, storageKey, user?.uid]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const setValue = (next: T | ((current: T) => T)) => setStored(current => ({ ...current,
    value: typeof next === 'function' ? (next as (current: T) => T)(current.value) : next }));
  const markSaved = (value: T) => setStored({ key: storageKey, value, base: value });
  const markSavedPartial = (merge: (current: T) => T) => setStored(current => ({ ...current, value: merge(current.value), base: merge(current.base) }));
  const rebase = (base: T) => setStored(current => ({ ...current, base,
    value: base && typeof base === 'object' && !Array.isArray(base)
      ? { ...base, ...changedFields(current.base as Record<string, unknown>, current.value as Record<string, unknown>) } as T
      : current.value }));
  return { value: draft.value, base: draft.base, setValue, dirty, markSaved, markSavedPartial, rebase, discard: () => markSaved(remote) };
}
