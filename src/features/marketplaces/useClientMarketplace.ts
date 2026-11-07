import { useState } from 'react';
import type { Client, UpdateClientMarketplaceRequest } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { changedFields } from '../../../shared/src/fieldConcurrency';
import { useClientDraft } from '../clients/useClientDraft';
import { updateClientMarketplace } from './firebase';

export const useClientMarketplace = (client: Client, marketplaceId: MarketplaceId) => {
  const config = client.marketplaces?.[marketplaceId];
  const remote = { region: config?.settings?.region ?? '', sellerId: config?.settings?.sellerId ?? '' };
  const draft = useClientDraft(`${client.id}:marketplace:${marketplaceId}`, remote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<(typeof remote & { enabled: boolean }) | null>(null);
  const save = async (patch: Pick<UpdateClientMarketplaceRequest, 'enabled' | 'settings'>) => {
    setSaving(true); setError(''); setSaved(false); setConflict(null);
    const value = { region: draft.value.region.trim(), sellerId: draft.value.sellerId.trim() };
    try {
      const result = await updateClientMarketplace({ clientId: client.id!, marketplaceId,
        ...(patch.enabled === undefined ? { settings: changedFields(draft.base, value) } : { enabled: patch.enabled }),
        expected: { ...draft.base, enabled: config?.enabled === true },
      });
      if (patch.settings) draft.markSaved(result.current ? { region: result.current.region, sellerId: result.current.sellerId } : value);
      setSaved(true);
    } catch (err) {
      const failure = err as Error & { details?: { current?: typeof conflict } };
      setError(failure.message || 'No se pudo guardar.');
      setConflict(failure.details?.current ?? null);
    } finally { setSaving(false); }
  };
  const keepDraft = () => { if (conflict) draft.rebase({ region: conflict.region, sellerId: conflict.sellerId }); setConflict(null); setError(''); };
  const discard = () => { draft.markSaved(conflict ? { region: conflict.region, sellerId: conflict.sellerId } : remote); setConflict(null); setError(''); setSaved(false); };
  return { ...draft, discard, enabled: config?.enabled === true, saving, error, saved: saved && !draft.dirty, save, conflict, keepDraft };
};
