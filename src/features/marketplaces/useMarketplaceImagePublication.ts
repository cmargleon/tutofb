import { useState } from 'react';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import type { MarketplaceExportScope, PublishedMarketplaceImage } from '../../../shared/src/types';
import { useToast } from '../feedback/FeedbackProvider';
import { publishMarketplaceImages } from './exportFirebase';

export function useMarketplaceImagePublication(scope: MarketplaceExportScope, productId: string, onPublished: (channel: MarketplaceId, images: PublishedMarketplaceImage[]) => void) {
  const [busyChannel, setBusyChannel] = useState<MarketplaceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const publish = async (marketplaceId: MarketplaceId, authorized: boolean) => {
    if (!authorized || busyChannel) return;
    setBusyChannel(marketplaceId); setError(null);
    try {
      const result = await publishMarketplaceImages({ ...scope, productId, marketplaceId, authorizePublicImages: true });
      onPublished(marketplaceId, result.images);
      if (result.failures.length) setError(result.failures.map(failure => `${failure.outputId}: ${failure.message}`).join('\n'));
      if (result.images.length) toast({ tone: result.failures.length ? 'warning' : 'success', title: `${result.images.length} fotografías listas para exportar`, description: 'Las URL públicas se usarán al guardar y validar el producto.' });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusyChannel(null); }
  };
  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast({ tone: 'success', title: 'URL pública copiada' }); }
    catch { toast({ tone: 'error', title: 'No se pudo copiar la URL', description: 'Selecciona y copia la dirección del campo URL pública.' }); }
  };
  return { busyChannel, error, publish, copyUrl };
}
