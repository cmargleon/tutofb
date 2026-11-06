import { useState } from 'react';
import type { Client } from '../../../shared/src/types';
import { configSnapshot } from '../../../shared/src/configSnapshot';
import { useClientDraft } from './useClientDraft';
import { updateClient } from './firebase';

export const useClientSettings = (client: Client) => {
  const remote = { name: client.name, prompt: client.generationPromptBase ?? '' };
  const draft = useClientDraft(`${client.id}:settings`, remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      if (configSnapshot(remote) !== configSnapshot(draft.base)) throw new Error('Los datos cambiaron en otra sesión. Conservamos el borrador; revisa la configuración actual antes de guardar.');
      await updateClient(client.id!, draft.value.name.trim(), draft.value.prompt);
      draft.markSaved({ name: draft.value.name.trim(), prompt: draft.value.prompt.trim() }); setSaved(true);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  return { ...draft, saving, error, saved, save };
};
