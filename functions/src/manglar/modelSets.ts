import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarModelBaseStatusRequest, ModelBaseOperation, ScheduleModelPhotoSetsRequest } from '../../../shared/src/types';
import { getModelPhotoProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import { photoIdentity } from '../../../shared/src/marketplacePhotoPlan';
import { modelBaseResumable } from '../../../shared/src/modelPhotoSets';
import { photoConfigForRatio } from '../../../shared/src/modelPhotoSets';
import { estimateGenerationHold, GEMINI_OPERATION_HOLD_USD } from '../costs/generationEstimates';
import { loadModelSetContext } from '../models/marketplaceSets';
import { MODEL_BASE_MAX_ATTEMPTS } from '../models/marketplaceSetPolicy';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertResourceAccess, validId } from './access';
import { runManglarPaid } from './budget';
import type { DelegatedCaller } from './context';
import { callableRequest } from './request';
import { sanitizeResult } from './reads';

export async function estimateSets(data: ScheduleModelPhotoSetsRequest, uid: string) {
  const { preview, normalized, mappedProvider } = await loadModelSetContext(data, uid);
  if (preview.issues.length || data.approvedPreviewId !== preview.id)
    throw new HttpsError('failed-precondition', 'Revisa previewSets y aprueba el set vigente sin incidencias.');
  const selected = data.combinations.map(c => preview.shots.find(s => s.spec.channel === c.channel && s.spec.shot === c.shot && s.spec.poseRecipeId === c.poseRecipeId));
  if (!selected.length || selected.some(s => !s) || new Set(selected).size !== selected.length)
    throw new HttpsError('invalid-argument', 'Combinaciones inválidas o duplicadas.');
  const missing = selected.filter(s => !s!.poseId);
  // Background workers do not inherit the MCP request context. Reserve their entire
  // conservative exposure here, before enqueueing, rather than reserving only attempt one.
  const reservations = await Promise.all(missing.map(async shot => {
    const spec = shot!.spec;
    const config = spec.aspectRatio === normalized.aspectRatio && spec.channel !== 'tiktok-shop' ? normalized
      : photoConfigForRatio({ provider: mappedProvider, imageConfig: normalized.imageConfig }, spec.aspectRatio);
    // A technical retry may resume an older operation, whose provider/configuration
    // are intentionally immutable even if the new request selects a cheaper provider.
    const ref = getAppFirestore().doc(`models/${data.modelId}`);
    const lock = await ref.collection('baseCombinationLocks').doc(photoIdentity([spec, preview.identitySha256])).get();
    const prior = lock.exists ? (await ref.collection('baseOperations').doc(lock.get('requestId')).get()).data() : null;
    const resumed = prior?.spec && modelBaseResumable(prior as ModelBaseOperation) && prior.provider && prior.imageConfig;
    const hold = estimateGenerationHold(resumed ? mapModelPhotoProviderToProvider(prior.provider) : mappedProvider, resumed ? prior.imageConfig : config.imageConfig, 1);
    return { holdUsd: (hold.holdUsd + GEMINI_OPERATION_HOLD_USD) * MODEL_BASE_MAX_ATTEMPTS,
      maxCostUsd: (resumed ? getModelPhotoProviderCostUsd(prior.provider, prior.imageConfig, 1) + .01 : shot!.estimatedCostUsd) * MODEL_BASE_MAX_ATTEMPTS };
  }));
  const initialReservationUsd = Number(reservations.reduce((sum, reservation) => sum + reservation.holdUsd, 0).toFixed(6));
  return { units: missing.length, maxAttempts: MODEL_BASE_MAX_ATTEMPTS,
    maxCostUsd: Number(reservations.reduce((sum, reservation) => sum + reservation.maxCostUsd, 0).toFixed(6)),
    estimatedGenerationCostUsd: null, initialReservationUsd, retriesIncluded: true, providerConfirmedUsd: null,
    costBasis: 'rate_card_estimates_and_conservative_holds', note: 'Reserva completa antes de encolar: generación y verificación, hasta tres intentos por combinación. No se libera por terminar antes; no es factura del proveedor.' };
}

export async function scheduleSets(data: ScheduleModelPhotoSetsRequest, caller: DelegatedCaller) {
  const estimate = await estimateSets(data, caller.uid);
  const schedule = async () => (await import('../callables/modelMarketplaceSets')).scheduleModelMarketplaceSets.run(callableRequest(data, caller));
  return estimate.initialReservationUsd > 0 ? runManglarPaid(estimate.initialReservationUsd, schedule) : schedule();
}

export async function baseStatus(data: ManglarModelBaseStatusRequest, caller: DelegatedCaller) {
  const id = validId(data.id), limit = data.limit ?? 25;
  const model = await assertResourceAccess(caller, 'models', validId(id));
  let query = getAppFirestore().collection(`models/${id}/baseOperations`).orderBy('__name__').limit(limit + 1);
  if (data.cursor) query = query.startAfter(validId(data.cursor));
  const snapshots = await query.get();
  const page = snapshots.docs.slice(0, limit);
  const pose = async (poseId?: string) => {
    const found = model.poses?.find((p: any) => p.id === poseId);
    if (!found) return poseId ? { id: poseId } : null;
    const { downloadUrl: _url, previewUrl: _preview, ...safe } = found;
    return { ...safe, previewUrl: (await admin.storage().bucket().file(found.previewStoragePath || found.storagePath)
      .getSignedUrl({ action: 'read', version: 'v4', expires: Date.now() + 900000 }))[0], expiresInSeconds: 900 };
  };
  const operations = await Promise.all(page.map(async snapshot => {
    const op = snapshot.data() as ModelBaseOperation;
    const attempts = [...(op.attempts || []), ...(op.technicalErrors || [])];
    return { id: snapshot.id, spec: op.spec, status: op.status, attemptNumber: op.attemptNumber,
      attempts: op.attempts || [], technicalErrors: op.technicalErrors || [], result: op.result || null, error: op.error || null,
      generationCostUsd: attempts.reduce((sum, a) => sum + (a.generationCostUsd || 0), 0),
      verificationCostUsd: attempts.reduce((sum, a) => sum + (a.reviewCostUsd || 0), 0),
      pose: await pose(op.result?.poseId || op.attempts?.at(-1)?.poseId) };
  }));
  return sanitizeResult({ modelId: id, operations, nextCursor: snapshots.size > limit ? page.at(-1)!.id : null,
    marketplaceBaseApprovals: model.marketplaceBaseApprovals || [], costBasis: 'stored_rate_card_estimates', providerConfirmedUsd: null });
}
