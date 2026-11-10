import type { Client, Model, PhotoPlanInput } from '../../../../shared/src/types';
import type { WizardState } from '../types';
import * as commercialPhotoNamespace from '../../../../shared/src/commercialPhoto';
const { resolveCommercialPhotoConfig } = ((commercialPhotoNamespace as { default?: unknown }).default ?? commercialPhotoNamespace) as typeof import('../../../../shared/src/commercialPhoto');
export function wizardPhotoPlanInput(state: WizardState, client: Client, model: Model | null): PhotoPlanInput & { modelId?: string | null } {
  const normalized = resolveCommercialPhotoConfig(state.provider, state.providerImageConfigs[state.provider]);
  return { clientId: client.id!, marketplaces: client.marketplaces, modelId: model?.id || null,
    provider: state.provider, ...normalized, objectScenes: state.productScenes,
    bases: (model?.poses || []).filter(p => p.active !== false).map(p => ({ id: p.id, storagePath: p.storagePath, ...(p.photoObservation ? { observation: p.photoObservation } : {}) })),
    articles: state.garments.map(g => ({ itemId: g.id, productId: g.photoProductId || g.id, variantId: g.photoVariantId || g.id, name: g.name, kind: state.generationKind || 'garment', attributes: g.photoAttributes || {},
      references: g.originalPhotos.filter(p => p.upload.storagePath).map(p => ({ id: p.id, storagePath: p.upload.storagePath!, view: p.classification.isDetail ? 'detail' : p.classification.view || 'front' })) })) };
}
