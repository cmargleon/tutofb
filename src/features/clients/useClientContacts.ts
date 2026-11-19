import { useState } from 'react';
import type { Client, ClientContact } from '../../../shared/src/types';
import { isClientContactsDraft, normalizeClientContacts } from '../../../shared/src/clientContacts';
import { useClientDraft } from './useClientDraft';
import { updateClient } from './firebase';
import { useConfirm } from '../feedback/FeedbackProvider';

export function useClientContacts(client: Client) {
  const draft = useClientDraft(`${client.id}:contacts`, client.contacts ?? [], isClientContactsDraft);
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<ClientContact[] | null>(null);
  const save = async () => {
    setSaving(true); setError(''); setSaved(false); setConflict(null);
    try {
      const contacts = normalizeClientContacts(draft.value);
      const result = await updateClient(client.id!, { contacts, expected: { contacts: draft.base } });
      draft.markSaved(result?.values?.contacts ?? contacts);
      setSaved(true);
    } catch (err) {
      const failure = err as Error & { details?: { current?: { contacts?: ClientContact[] } } };
      setError(failure.message);
      if (failure.details?.current) setConflict(failure.details.current.contacts ?? []);
    } finally { setSaving(false); }
  };
  const remove = async (index: number) => {
    if (await confirm({ title: 'Quitar contacto', description: `Se quitará ${draft.value[index].name || 'este contacto'} de la lista al guardar los cambios.`, confirmLabel: 'Quitar contacto' })) {
      draft.setValue(current => current.filter((_, position) => position !== index));
    }
  };
  return { ...draft, saving, error, saved: saved && !draft.dirty, conflict, save, remove,
    discard: () => { draft.markSaved(conflict ?? client.contacts ?? []); setConflict(null); setError(''); setSaved(false); },
    keepDraft: () => { if (conflict) draft.rebase(conflict); setConflict(null); setError(''); },
  };
}
