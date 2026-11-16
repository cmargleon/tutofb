import { useState } from 'react';
import type { Client, PhotoRecipe } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { isPhotoRecipe } from '../../../shared/src/marketplacePhotoRecipe';
import { useClientDraft } from '../clients/useClientDraft';
import { useToast } from '../feedback/FeedbackProvider';
import { updateClientMarketplace } from './firebase';

export function useMarketplacePhotoRecipe(client: Client, channel: MarketplaceId) {
  const entry = client.marketplaces?.[channel];
  const remote = { recipe: entry?.photoRecipe ?? null, revision: entry?.photoRecipeRevision ?? 0 };
  const draft = useClientDraft(`${client.id}:marketplace:${channel}:photo-recipe`, remote, value => {
    const candidate = value as typeof remote;
    return Number.isSafeInteger(candidate.revision) && (candidate.recipe === null || isPhotoRecipe(candidate.recipe, channel));
  });
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<typeof remote | null>(null);

  const save = async (photoRecipe: PhotoRecipe | null) => {
    setSaving(true);
    setError('');
    try {
      const { current } = await updateClientMarketplace({
        clientId: client.id!, marketplaceId: channel, photoRecipe, expectedPhotoRecipeRevision: draft.base.revision,
      });
      draft.markSaved({ recipe: current.photoRecipe ?? null, revision: current.photoRecipeRevision! });
      setConflict(null);
      toast({ tone: 'success', title: photoRecipe ? 'Receta fotográfica guardada' : 'Valores predeterminados restaurados' });
    } catch (err) {
      const failure = err as Error & { details?: { current?: { photoRecipe: PhotoRecipe | null; photoRecipeRevision: number } } };
      const current = failure.details?.current;
      if (current?.photoRecipeRevision !== undefined) setConflict({ recipe: current.photoRecipe, revision: current.photoRecipeRevision });
      setError(failure.message || 'No se pudo guardar la receta.');
    } finally { setSaving(false); }
  };
  return { ...draft, saving, error, conflict, save, setRecipe: (recipe: PhotoRecipe | null) => draft.setValue({ ...draft.value, recipe }),
    discard: () => { draft.markSaved(conflict ?? remote); setConflict(null); setError(''); } };
}
