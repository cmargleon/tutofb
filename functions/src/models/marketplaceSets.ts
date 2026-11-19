import { getModelMarketplaceRules, modelMarketplaceRulesRef } from './marketplaceRules';
import { effectiveModelMarketplaceRule } from '../../../shared/src/modelMarketplaceRules';
import { MODEL_POSE_RECIPES_BY_ID } from '../../../shared/src/modelPoseRecipes';
import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Client, Model, ModelPhotoSetsPreview, ModelPhotoSetsRequest, Pose, VerifyModelBaseRequest, VerifyModelBaseResponse } from '../../../shared/src/types';
import { MODEL_SET_SHOTS, concreteModelBaseSpec, baseObservationIssues, buildModelBasePrompt, compatibleBaseApproval, modelBaseSpec, modelPhotoBases, photoConfigForRatio, sameBaseSpec } from '../../../shared/src/modelPhotoSets';
import { PHOTO_RECIPE_CATEGORIES, effectivePhotoRecipe } from '../../../shared/src/marketplacePhotoRecipe';
import { activePhotoChannels, photoIdentity } from '../../../shared/src/marketplacePhotoPlan';
import { DEFAULT_IMAGE_PROVIDER, MODEL_PHOTO_PROVIDER_VALUES, mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import { getModelPhotoProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { ASPECT_RATIO_VALUES, normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { withDeclaredModelAge } from '../../../shared/src/photoAttributes';
import { resolveAutomationPresetName } from '../../../shared/src/automationConfig';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { FAL_KEY, GEMINI_API_KEY, getGeminiPoseClassificationModel } from '../config/runtime';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { classifyPoseWithGemini } from '../utils/classifyPose';
import { generateSingleModelPhoto } from '../utils/modelPhotoGeneration';

const visualSpec = (spec: import('../../../shared/src/types').ModelBaseSpec) => {
  const { rulesRevision: _revision, lookingAtCamera: _gaze, standingFront: _standing, validation: _validation, ...visual } = spec;
  return visual;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function modelAssetFingerprint(storagePath: string) {
  const file = admin.storage().bucket().file(storagePath);
  const [metadata] = await file.getMetadata();
  const [bytes] = await admin.storage().bucket().file(storagePath, { generation: metadata.generation }).download();
  if (!metadata.contentType?.startsWith('image/') || bytes.length >= 10 * 1024 * 1024) throw new HttpsError('failed-precondition', 'Base fuera del perfil de imagen admitido.');
  return { sha256: hash(bytes), storageGeneration: String(metadata.generation) };
}
export async function loadModelSetContext(input: ModelPhotoSetsRequest, uid: string) {
  if (typeof input?.modelId !== 'string' || !/^[\w-]{1,160}$/.test(input.modelId) || !PHOTO_RECIPE_CATEGORIES.includes(input.category)
    || !['upper_body', 'lower_body', 'full_body', 'footwear', 'head_accessory', 'carry_accessory'].includes(input.bodyArea)
    || input.aspectRatio && !ASPECT_RATIO_VALUES.includes(input.aspectRatio)) throw new HttpsError('invalid-argument', 'Modelo, categoría, zona o proporción inválidos.');
  if (input.poseRecipeIds !== undefined && (!Array.isArray(input.poseRecipeIds) || input.poseRecipeIds.length > MODEL_POSE_RECIPES_BY_ID.size
    || new Set(input.poseRecipeIds).size !== input.poseRecipeIds.length || input.poseRecipeIds.some(id => !MODEL_POSE_RECIPES_BY_ID.has(id))))
    throw new HttpsError('invalid-argument', 'Selecciona poses concretas válidas, sin duplicados.');
  const db = getAppFirestore();
  const ref = db.doc(`models/${input.modelId}`);
  const data = (await ref.get()).data() as Model | undefined;
  const model = data ? { ...data, id: ref.id } : undefined;
  if (!model || model.status === 'archived' || model.active === false) throw new HttpsError('not-found', 'Modelo no disponible.');
  await assertHumanClientAccess(uid, model.clientId);
  const client = (await db.doc(`clients/${model.clientId}`).get()).data() as Client | undefined;
  if (!client || client.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const preset = client.automation?.presets?.[resolveAutomationPresetName({ jobType: 'garment' }, client.automation)];
  const provider = input.provider || MODEL_PHOTO_PROVIDER_VALUES.find(p => mapModelPhotoProviderToProvider(p) === preset?.provider) || DEFAULT_IMAGE_PROVIDER as import('../../../shared/src/types').ModelPhotoProvider;
  if (!MODEL_PHOTO_PROVIDER_VALUES.includes(provider)) throw new HttpsError('invalid-argument', 'Proveedor de modelo inválido.');
  const mappedProvider = mapModelPhotoProviderToProvider(provider);
  assertProviderEnabledInSystemConfig(mappedProvider, await getSystemConfigCached());
  const requestedConfig = input.imageConfig ?? (preset?.imageConfig?.provider === mappedProvider ? preset.imageConfig : undefined);
  const normalized = normalizeProviderImageConfig(mappedProvider, requestedConfig, input.aspectRatio || preset?.aspectRatio || '3:4');
  if (input.aspectRatio && normalized.aspectRatio !== input.aspectRatio) Object.assign(normalized, photoConfigForRatio({ provider: mappedProvider, imageConfig: normalized.imageConfig }, input.aspectRatio));
  const channels = input.channels ?? activePhotoChannels(client.marketplaces);
  if (!Array.isArray(channels) || channels.length > 4 || new Set(channels).size !== channels.length || channels.some(c => !activePhotoChannels(client.marketplaces).includes(c)))
    throw new HttpsError('invalid-argument', 'Selecciona marketplaces activos del cliente.');
  const declaredAudience = withDeclaredModelAge({} as any, model.identityTraits).audience;
  const audience = declaredAudience || 'adult';
  // Models without a declared age require explicit identity traits before paid operations.
  const issues: string[] = [];
  if (!declaredAudience) issues.push('Confirma la edad de la identidad en la ficha del modelo.');
  if (!model.approvedIdentity) issues.push('Elige y aprueba primero una fotografía de identidad del modelo.');
  else if (JSON.stringify(model.approvedIdentity.traitsSnapshot) !== JSON.stringify(model.identityTraits || null)) issues.push('Los rasgos de identidad cambiaron. Confirma de nuevo la identidad antes de completar sus sets.');
  if (!channels.length) issues.push('El cliente no tiene destinos seleccionados.');
  const incompatible: NonNullable<ModelPhotoSetsPreview['incompatible']> = [];
  if (input.poseRecipeIds && !input.poseRecipeIds.length) issues.push('Selecciona al menos una pose.');
  const rules = await getModelMarketplaceRules();
  const specs = channels.flatMap(channel => {
    if (input.poseRecipeIds) return input.poseRecipeIds.flatMap(poseRecipeId => {
      const result = concreteModelBaseSpec(MODEL_POSE_RECIPES_BY_ID.get(poseRecipeId)!, channel, input.category, audience, client.marketplaces, normalized.aspectRatio, rules);
      if (!result.spec) { incompatible.push({ channel, poseRecipeId, reason: result.reason! }); return []; }
      return [result.spec];
    });
    const child = audience !== 'adult';
    const modelFree = child && (channel === 'tiktok-shop' || ['bodysuit', 'fitted_child', 'underwear', 'swimwear'].includes(input.category)) || audience === 'baby' && channel === 'mercado-libre';
    if (modelFree) return [];
    const { preferences } = effectivePhotoRecipe(client.marketplaces?.[channel]?.photoRecipe, input.category);
    return MODEL_SET_SHOTS.filter(shot => effectiveModelMarketplaceRule(channel, rules).shots.includes(shot)).filter(shot => (shot === 'front' || preferences.views.includes(shot === 'commercial_back' ? 'back' : 'side'))
      && (shot === 'front' ? preferences.mainComposition : preferences.additionalComposition) !== 'flat_lay')
      .map(shot => modelBaseSpec(channel, input.category, audience, input.bodyArea, shot, client.marketplaces, normalized.aspectRatio, rules));
  });
  const bases = await currentModelPhotoBases(model);
  const shots = specs.map(spec => {
    const config = spec.aspectRatio === normalized.aspectRatio && spec.channel !== 'tiktok-shop' ? normalized : photoConfigForRatio({ provider: mappedProvider, imageConfig: normalized.imageConfig }, spec.aspectRatio);
    const candidate = model.poses.filter(p => p.active !== false && p.marketplaceBaseSpec && sameBaseSpec(p.marketplaceBaseSpec, visualSpec(spec))).at(-1);
    return { spec, ...(candidate ? { issues: baseObservationIssues(spec, candidate.photoObservation || undefined) } : {}), poseId: bases.find(b => compatibleBaseApproval(b, spec))?.id || null,
      candidatePoseIds: model.poses.filter(p => p.active !== false && p.marketplaceBaseSpec && sameBaseSpec(p.marketplaceBaseSpec, visualSpec(spec))).map(p => p.id),
      estimatedCostUsd: getModelPhotoProviderCostUsd(provider, config.imageConfig, 1) + .01 };
  });
  const missing = shots.filter(s => !s.poseId);
  const preview: ModelPhotoSetsPreview = { ...(model.approvedIdentity ? { identitySha256: model.approvedIdentity.sha256 } : {}), id: photoIdentity([specs, model.poses.map(pose => [pose.id, pose.storagePath, pose.active ?? true, pose.marketplaceBaseSpec || null]), model.approvedIdentity || null, model.marketplaceBaseApprovals || [], provider, normalized]), provider, shots, incompatible,
    missing: missing.length, estimatedCostUsd: Number(missing.reduce((sum, s) => sum + s.estimatedCostUsd, 0).toFixed(6)), issues };
  return { ref, model, client, provider, mappedProvider, normalized, preview };
}

/** Check the stored server approval and the current immutable Storage object before scheduling. */
export async function currentModelPhotoBases(model?: Model, poseIds?: string[]) {
  const bases = modelPhotoBases(model, poseIds);
  if (!model?.approvedIdentity) return bases.map(b => ({ ...b, approvals: [] }));
  const identity = model.approvedIdentity;
  const identityPose = model.poses.find(p => p.id === identity.poseId && p.active !== false && p.storagePath === identity.storagePath);
  const identityValid = identityPose && await assetGenerationMatches(identity.storagePath, identity.storageGeneration);
  return Promise.all(bases.map(async b => ({ ...b, approvals: identityValid ? (await assetGenerationMatches(b.storagePath, b.approvals?.[0]?.storageGeneration))
    ? b.approvals?.filter(a => a.storageGeneration === b.approvals?.[0]?.storageGeneration) : [] : [] })));
}
async function assetGenerationMatches(path: string, generation?: string) {
  if (!generation) return false;
  try { return String((await admin.storage().bucket().file(path).getMetadata())[0].generation) === generation; } catch { return false; }
}

export async function verifyModelBaseCore(input: VerifyModelBaseRequest, uid: string): Promise<VerifyModelBaseResponse> {
  const context = await loadModelSetContext({ ...input, ...(input.poseRecipeId && !input.poseRecipeIds ? { poseRecipeIds: [input.poseRecipeId] } : {}), channels: [input.channel] }, uid);
  const { ref, model, preview } = context;
  if (preview.issues.length) throw new HttpsError('failed-precondition', preview.issues.join(' '));
  const spec = preview.shots.find(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)?.spec;
  const pose = model.poses.find(p => p.id === input.poseId && p.active !== false);
  if (!spec || !pose) throw new HttpsError('invalid-argument', 'Toma o base no disponible.');
  const identity = model.approvedIdentity!;
  const identityFingerprint = await modelAssetFingerprint(identity.storagePath);
  if (identity.sha256 !== identityFingerprint.sha256 || identity.storageGeneration !== identityFingerprint.storageGeneration) throw new HttpsError('failed-precondition', 'La identidad cambió. Apruébala de nuevo.');
  const fingerprint = await modelAssetFingerprint(pose.storagePath);
  const result = await classifyPoseWithGemini({ apiKey: GEMINI_API_KEY.value(), model: getGeminiPoseClassificationModel(), pose: { ...pose, marketplaceBaseSpec: spec },
    clientId: model.clientId, modelId: ref.id, userUid: uid, identityStoragePath: identity.storagePath, performer: identity.performer });
  const observation = result.photoObservation && withDeclaredModelAge(result.photoObservation, model.identityTraits);
  const issues = baseObservationIssues(spec, observation);
  if (!(await assetGenerationMatches(pose.storagePath, fingerprint.storageGeneration))) throw new HttpsError('aborted', 'La fotografía cambió durante la verificación.');
  await getAppFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Model;
    if (!current || current.clientId !== model.clientId || current.approvedIdentity?.sha256 !== identity.sha256
      || current.poses.find(p => p.id === pose.id)?.storagePath !== pose.storagePath) throw new HttpsError('aborted', 'La identidad o las bases cambiaron.');
    const rules = (await tx.get(modelMarketplaceRulesRef())).get('marketplaces');
    if ((rules?.[spec.channel]?.revision ?? 0) !== (spec.rulesRevision ?? 0)) throw new HttpsError('aborted', 'Las reglas cambiaron durante la verificación. Revisa y verifica de nuevo.');
    const approvals = (current.marketplaceBaseApprovals || []).filter(a => !(a.poseId === pose.id && sameBaseSpec(a.spec, spec)));
    if (!issues.length) approvals.push({ clientId: model.clientId, modelId: ref.id, recipeRevision: context.client.marketplaces?.[spec.channel]?.photoRecipeRevision ?? 0,
      verifierModel: getGeminiPoseClassificationModel(), confidence: result.confidence, spec, poseId: pose.id, storagePath: pose.storagePath, ...fingerprint, identitySha256: identity.sha256, observation: observation!,
      verifiedAt: new Date().toISOString(), verifiedByUid: uid, verifierVersion: 'model-base-verifier-v1' });
    tx.update(ref, { marketplaceBaseApprovals: approvals, poses: current.poses.map(p => p.id === pose.id && observation ? { ...p, photoObservation: observation, aiClassification: buildPoseAiClassification({ ...result, taggedAt: new Date().toISOString(), displayLabel: spec.poseRecipeId ? MODEL_POSE_RECIPES_BY_ID.get(spec.poseRecipeId)?.label : null }) } : p), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { approved: !issues.length, poseId: pose.id, issues };
}

export async function generateModelBaseCore(input: import('../../../shared/src/types').GenerateModelBaseRequest, uid: string) {
  const context = await loadModelSetContext({ ...input, ...(input.poseRecipeId && !input.poseRecipeIds ? { poseRecipeIds: [input.poseRecipeId] } : {}), channels: [input.channel] }, uid);
  const { ref, model, preview, provider, mappedProvider, normalized } = context;
  if (preview.issues.length) throw new HttpsError('failed-precondition', preview.issues.join(' '));
  if (!/^[\w-]{1,160}$/.test(input.requestId)) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  if (!preview.shots.some(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)) throw new HttpsError('invalid-argument', 'Toma no pertinente para esta receta.');
  const selectedShot = preview.shots.find(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)!;
  const combination = ref.collection('baseCombinationLocks').doc(photoIdentity([selectedShot.spec, preview.identitySha256]));
  const operation = ref.collection('baseOperations').doc(input.requestId);
  const inputHash = photoIdentity(input);
  // A request is paid at most once. Interrupted requests remain visible for operator attention.
  const previous = await getAppFirestore().runTransaction(async tx => {
    const prior = await tx.get(operation);
    if (prior.exists) {
      if (prior.get('inputHash') !== inputHash) throw new HttpsError('already-exists', 'Solicitud usada con otra toma.');
      if (prior.get('result')) return prior.get('result') as VerifyModelBaseResponse;
      throw new HttpsError('failed-precondition', 'Operación ya iniciada; revisa las candidatas antes de reintentar con otra solicitud.');
    }
    const locked = await tx.get(combination);
    const lockedOperation = locked.exists ? await tx.get(ref.collection('baseOperations').doc(locked.get('requestId'))) : null;
    if (lockedOperation && ['generating', 'verifying'].includes(lockedOperation.get('status')))
      throw new HttpsError('failed-precondition', 'Esta combinación ya se está procesando. Espera el resultado; no se cobrará otra solicitud.');
    const current = (await tx.get(ref)).data() as Model;
    const rules = (await tx.get(modelMarketplaceRulesRef())).get('marketplaces');
    if ((rules?.[selectedShot.spec.channel]?.revision ?? 0) !== (selectedShot.spec.rulesRevision ?? 0)) throw new HttpsError('aborted', 'Las reglas cambiaron. Actualiza la estimación antes de generar.');
    const currentBases = modelPhotoBases(current);
    const approved = currentBases.find(b => compatibleBaseApproval(b, selectedShot.spec));
    if (approved && lockedOperation?.get('status') === 'approved' && selectedShot.poseId !== approved.id)
      throw new HttpsError('failed-precondition', 'Ya existe un resultado aprobado de esta combinación. Actualiza o verifica su archivo antes de generar.');
    if (approved && selectedShot.poseId === approved.id) return { approved: true, poseId: approved.id, issues: [] };
    if (input.approvedPreviewId !== preview.id) throw new HttpsError('failed-precondition', 'El costo o el set cambió. Revisa la estimación.');
    tx.set(combination, { requestId: input.requestId });
    tx.create(operation, { inputHash, status: 'generating', createdByUid: uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return null;
  });
  if (previous) return previous;
  const spec = preview.shots.find(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)?.spec;
  if (!spec) throw new HttpsError('invalid-argument', 'Toma inválida.');
  try {
    const identity = model.approvedIdentity!;
    const fingerprint = await modelAssetFingerprint(identity.storagePath);
    if (identity.sha256 !== fingerprint.sha256 || identity.storageGeneration !== fingerprint.storageGeneration) throw new HttpsError('failed-precondition', 'La identidad cambió.');
    const [url] = await admin.storage().bucket().file(identity.storagePath, { generation: identity.storageGeneration }).getSignedUrl({ action: 'read', expires: Date.now() + 3600000, version: 'v4' });
    const config = spec.aspectRatio === normalized.aspectRatio && spec.channel !== 'tiktok-shop' ? normalized : photoConfigForRatio({ provider: mappedProvider, imageConfig: normalized.imageConfig }, spec.aspectRatio);
    const result = await generateSingleModelPhoto({ provider, prompt: buildModelBasePrompt(spec), imageConfig: config.imageConfig, falKey: FAL_KEY.value(), referenceImageUrl: url, preserveReferenceDetails: true });
    const poseId = randomUUID();
    const ext = result.contentType.includes('jpeg') ? 'jpg' : result.contentType.includes('webp') ? 'webp' : 'png';
    const storagePath = `model_generations/${model.clientId}/${ref.id}/pose/${input.requestId}/${poseId}.${ext}`;
    await admin.storage().bucket().file(storagePath).save(result.imageBytes, { resumable: false, metadata: { contentType: result.contentType } });
    const pose: Pose = { id: poseId, storagePath, fileName: `${spec.channel}-${spec.bodyArea}-${spec.poseRecipeId || spec.shot}.${ext}`, marketplaceBaseSpec: spec, createdAt: new Date().toISOString() };
    const cost = getModelPhotoProviderCostUsd(provider, config.imageConfig, 1);
    await getAppFirestore().runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Model;
      if (!current || current.clientId !== model.clientId || current.approvedIdentity?.sha256 !== identity.sha256) throw new HttpsError('aborted', 'La identidad cambió durante la generación.');
      tx.update(ref, { poses: [...current.poses, pose], poseCount: current.poses.length + 1, generatedPhotoCount: admin.firestore.FieldValue.increment(1), generatedPhotoCostUsd: admin.firestore.FieldValue.increment(cost), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.create(getAppFirestore().collection('model_generation_logs').doc(), { provider, requestedPhotos: 1, completedPhotos: 1, estimatedCostUsd: cost, clientId: model.clientId, modelId: ref.id, stage: 'pose', createdByUid: uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(operation, { status: 'verifying', poseId });
    });
    let verification: VerifyModelBaseResponse;
    try { verification = await verifyModelBaseCore({ ...input, poseId }, uid); }
    catch (error) { verification = { approved: false, poseId, issues: [`Base conservada; verificación pendiente: ${error instanceof Error ? error.message : 'Error de verificación'}`] }; }
    await operation.update({ status: verification.approved ? 'approved' : 'needs_attention', result: verification });
    return verification;
  } catch (error) {
    await operation.update({ status: 'failed', error: error instanceof Error ? error.message : 'Error de generación' });
    throw new HttpsError('internal', error instanceof Error ? error.message : 'Error de generación', { modelBaseOperationFailed: true });
  }
}
