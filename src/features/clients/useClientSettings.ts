import { useState } from 'react';
import type { Client } from '../../../shared/src/types';
import { changedFields } from '../../../shared/src/fieldConcurrency';
import { useClientDraft } from './useClientDraft';
import { updateClient } from './firebase';

export const useClientSettings = (client: Client) => {
  const remote = { name: client.name, prompt: client.generationPromptBase ?? '' };
  const draft = useClientDraft(`${client.id}:settings`, remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<typeof remote | null>(null);
  const save = async () => {
    setSaving(true); setError(''); setSaved(false); setConflict(null);
    const value = { name: draft.value.name.trim(), prompt: draft.value.prompt.trim() };
    const changes = changedFields(draft.base, value);
    try {
      const result = await updateClient(client.id!, {
        ...(changes.name === undefined ? {} : { name: value.name }),
        ...(changes.prompt === undefined ? {} : { generationPromptBase: value.prompt || null }),
        expected: { name: draft.base.name, generationPromptBase: draft.base.prompt.trim() || null },
      });
      draft.markSaved(result?.values ? { name: result.values.name, prompt: result.values.generationPromptBase ?? '' } : value); setSaved(true);
    } catch (err) {
      const failure = err as Error & { details?: { current?: { name: string; generationPromptBase: string | null } } };
      setError(failure.message);
      if (failure.details?.current) setConflict({ name: failure.details.current.name, prompt: failure.details.current.generationPromptBase ?? '' });
    } finally { setSaving(false); }
  };
  const keepDraft = () => { if (conflict) draft.rebase(conflict); setConflict(null); setError(''); };
  const discard = () => { draft.markSaved(conflict ?? remote); setConflict(null); setError(''); setSaved(false); };
  return { ...draft, discard, saving, error, saved: saved && !draft.dirty, save, conflict, keepDraft };
};
