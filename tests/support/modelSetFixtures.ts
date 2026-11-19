import { createRequire } from 'node:module';
import type { Model, PhotoBase, PhotoBaseObservation, PhotoPlanInput } from '../../shared/src/types';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { modelBaseSpec, MODEL_SET_SHOTS } = require('./lib/shared/src/modelPhotoSets.js') as typeof import('../../shared/src/modelPhotoSets');
const { activePhotoChannels, photoIdentity, knownPhotoAttribute } = require('./lib/shared/src/marketplacePhotoPlan.js') as typeof import('../../shared/src/marketplacePhotoPlan');

/** Explicit test approvals. Production only issues these after server verification. */
export function approvedBasesForInput(input: PhotoPlanInput): PhotoBase[] {
  const bases = new Map<string, PhotoBase>();
  for (const article of input.articles) for (const channel of activePhotoChannels(input.marketplaces)) for (const shot of MODEL_SET_SHOTS) {
    const category = knownPhotoAttribute(article.attributes.category);
    const audience = knownPhotoAttribute(article.attributes.audience);
    const area = knownPhotoAttribute(article.attributes.bodyArea);
    if (!category || category === 'object' || !audience || !area) continue;
    // Both backgrounds are physically present in this fixture, each explicitly approved.
    for (const background of ['white', 'neutral'] as const) {
      const spec = { ...modelBaseSpec(channel, category, audience, area, shot, input.marketplaces, input.aspectRatio), background };
      const id = photoIdentity([audience, area, shot, background, spec.aspectRatio]);
      const [w, h] = spec.aspectRatio.split(':').map(Number);
      const observation: PhotoBaseObservation = { pose: shot, orientation: shot === 'commercial_back' ? 'back' : shot === 'front_three_quarter' ? 'side' : 'front', audience,
        posture: 'standing', framing: spec.framing, background, garmentVisible: true, accessories: false, performer: 'synthetic', verified: true, evidence: 'Fixture actual observation',
        whiteRgbVerified: background === 'white', width: w * 400, height: h * 400, faceVisible: spec.faceVisible, lookingAtCamera: spec.faceVisible, identityCoherent: true, mainPoseCompliant: shot === 'front' };
      const base = bases.get(id) || { id, storagePath: `models/test/model/poses/${id}.png`, observation, approvals: [] };
      base.approvals!.push({ clientId: input.clientId, modelId: 'model', recipeRevision: input.marketplaces?.[channel]?.photoRecipeRevision || 0, spec, poseId: id, storagePath: base.storagePath, sha256: id, storageGeneration: '1', identitySha256: 'identity', observation,
        verifiedAt: '2026-11-19T00:00:00Z', verifiedByUid: 'admin', verifierVersion: 'model-base-verifier-v1' });
      bases.set(id, base);
    }
  }
  return [...bases.values()];
}
export function modelFromBases(bases: PhotoBase[]): Model {
  return { id: 'model', clientId: 'test', name: 'Identity', clientNameSnapshot: 'Test', createdAt: null, updatedAt: null, createdByUid: 'admin', poseCount: bases.length,
    approvedIdentity: { traitsSnapshot: null, poseId: bases[0]?.id || '', storagePath: bases[0]?.storagePath || '', sha256: 'identity', storageGeneration: '1', performer: 'synthetic', approvedAt: '2026-11-19', approvedByUid: 'admin' },
    poses: bases.map(base => ({ id: base.id, storagePath: base.storagePath, fileName: `${base.id}.png`, photoObservation: base.observation, createdAt: null })), marketplaceBaseApprovals: bases.flatMap(base => base.approvals || []) };
}
