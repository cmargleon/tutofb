import { useState } from 'react';
import type { Model } from '../../../../shared/src/types';
import { verifyMarketplacePhotoBases } from '../firebase';
import { useToast } from '../../feedback/FeedbackProvider';
export function usePhotoBaseVerification(model: Model) {
  const [busy, setBusy] = useState(false); const toast = useToast();
  const verify = async () => {
    if (!model.id || busy) return;
    setBusy(true);
    try {
      const poses = model.poses.filter(p => p.active !== false && !p.photoObservation?.verified).slice(0, 8);
      const result = await verifyMarketplacePhotoBases(model.id, poses.map(p => p.id));
      toast({ tone: 'success', title: 'Bases analizadas', description: `${Object.keys(result.observations).length} fotografías observadas. Solo se usarán las compatibles con cada encuadre y destino.` });
    } catch (error) { toast({ tone: 'error', title: 'No se pudieron verificar las bases', description: error instanceof Error ? error.message : 'Reintenta más tarde.' }); }
    finally { setBusy(false); }
  };
  return { busy, verify, pending: model.poses.filter(p => p.active !== false && !p.photoObservation?.verified).length };
}
