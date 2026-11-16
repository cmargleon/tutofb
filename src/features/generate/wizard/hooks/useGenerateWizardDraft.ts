import { useCallback, useEffect, useRef, useState } from 'react';
import type { WizardState } from '../../types';
import {
  WizardDraftDirtyFlags,
  WizardDraftRestoreResult,
  parseWizardDraft,
  restoreWizardDraft,
  serializeWizardDraft,
  wizardDraftKey,
} from '../draft';
import { loadDraftCatalog, useWizardDraftIdentity } from '../draftEnvironment';

const SAVE_DELAY_MS = 300;

export interface WizardDraftNotice {
  savedAt: number;
  warnings: string[];
  failed?: boolean;
}

interface SaveInput {
  state: WizardState;
  draftBatchId: string | null;
  dirty: WizardDraftDirtyFlags;
  submitting: boolean;
}

const readStoredDraft = (key: string | null): unknown => {
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

/**
 * Persists the generation wizard per user and scope, and restores it once on
 * mount after checking it against the current catalog and Storage.
 */
export const useGenerateWizardDraft = (
  scope: string,
  createBaseState: () => WizardState,
  onRestore: (result: WizardDraftRestoreResult) => void,
) => {
  const identity = useWizardDraftIdentity();
  const uid = identity?.uid ?? null;
  const key = identity ? wizardDraftKey(identity.project, identity.uid, scope) : null;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [initialDraft] = useState(() => uid ? parseWizardDraft(readStoredDraft(key), { uid, scope, now: Date.now() }) : null);
  const [restoring, setRestoring] = useState(Boolean(initialDraft));
  const [notice, setNotice] = useState<WizardDraftNotice | null>(null);
  const restoringRef = useRef(Boolean(initialDraft));
  const suppressedRef = useRef(false);
  /** After a failed restore keep the stored draft until the user produces new work. */
  const preserveStoredRef = useRef(false);
  const pendingRef = useRef<SaveInput | null>(null);
  const timerRef = useRef<number | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const write = useCallback((input: SaveInput) => {
    if (!key || suppressedRef.current || restoringRef.current || !identityRef.current?.isCurrent()) return;
    const draft = serializeWizardDraft({ ...input, scope, now: Date.now() });
    try {
      if (draft) {
        preserveStoredRef.current = false;
        localStorage.setItem(key, JSON.stringify(draft));
      } else if (!preserveStoredRef.current) {
        localStorage.removeItem(key);
      }
    } catch { /* Quota or blocked storage: the wizard keeps working without recovery. */ }
  }, [key, scope]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      write(pendingRef.current);
      pendingRef.current = null;
    }
  }, [write]);

  const save = useCallback((input: SaveInput) => {
    if (restoringRef.current || suppressedRef.current) return;
    pendingRef.current = input;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  /** Removes the stored draft. `suppress` also stops later saves (used after a successful submit). */
  const clear = useCallback((suppress = false) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    preserveStoredRef.current = false;
    suppressedRef.current = suppress;
    setNotice(null);
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* Nothing stored. */ }
  }, [key]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!initialDraft) return undefined;
    let cancelled = false;
    loadDraftCatalog(initialDraft)
      .then((catalog) => {
        if (cancelled) return;
        const result = restoreWizardDraft(initialDraft, catalog, createBaseState());
        restoringRef.current = false;
        onRestoreRef.current(result);
        setNotice({ savedAt: initialDraft.savedAt, warnings: result.warnings });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('No se pudo restaurar el borrador del wizard', error);
        restoringRef.current = false;
        preserveStoredRef.current = true;
        setNotice({
          savedAt: initialDraft.savedAt,
          failed: true,
          warnings: ['No se pudo recuperar el lote en preparación. Recarga la página para reintentar o empieza de nuevo.'],
        });
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => { cancelled = true; };
    // Restore runs once per mounted wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { restoring, notice, dismissNotice: () => setNotice(null), save, clear };
};
