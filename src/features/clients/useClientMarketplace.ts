import { useState } from 'react';
import type { Client, UpdateClientMarketplaceRequest } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { useClientDraft } from './useClientDraft';
import { updateClientMarketplace } from './firebase';

export const useClientMarketplace = (client: Client, marketplaceId: MarketplaceId) => {
  const config = client.marketplaces?.[marketplaceId];
  const draft = useClientDraft(`${client.id}:marketplace:${marketplaceId}`, {
    region: config?.settings?.region ?? '', sellerId: config?.settings?.sellerId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async (patch: Pick<UpdateClientMarketplaceRequest, 'enabled' | 'settings'>) => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await updateClientMarketplace({ clientId: client.id!, marketplaceId, ...patch });
      if (patch.settings) draft.markSaved({ region: patch.settings.region?.trim() ?? '', sellerId: patch.settings.sellerId?.trim() ?? '' });
      setSaved(true);
    } catch (err) { setError((err as Error).message || 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  return { ...draft, enabled: config?.enabled === true, saving, error, saved, save };
};
