import type { IdentityTiming } from './identityTiming';
import { modelBasePoseActiveAfterReview } from '../../../shared/src/modelPoseCatalog';
import { MODEL_BASE_MAX_ATTEMPTS, modelBaseRetryPrompt, modelBaseReviewOutcome } from './marketplaceSetPolicy';
import { extensionForContentType } from '../workers/jobWorker.helpers';
import type { GenerateModelBaseRequest, ModelBaseAttempt, ModelBaseOperation, ScheduleModelPhotoSetsRequest } from '../../../shared/src/types';
import { getModelMarketplaceRules, modelMarketplaceRulesRef } from './marketplaceRules';
import { effectiveModelMarketplaceRule } from '../../../shared/src/modelMarketplaceRules';
import { MODEL_POSE_RECIPES_BY_ID } from '../../../shared/src/modelPoseRecipes';
import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import { GEMINI_OPERATION_HOLD_USD } from '../costs/generationEstimates';
import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Client, Model, ModelPhotoSetsPreview, ModelPhotoSetsRequest, Pose, VerifyModelBaseRequest, VerifyModelBaseResponse } from '../../../shared/src/types';
import { MODEL_SET_SHOTS, modelBaseResumable, concreteModelBaseSpec, baseObservationIssues, compatibleBaseApproval, modelBaseSpec, modelPhotoBases, photoConfigForRatio, sameBaseSpec } from '../../../shared/src/modelPhotoSets';
import { PHOTO_RECIPE_CATEGORIES, effectivePhotoRecipe } from '../../../shared/src/marketplacePhotoRecipe';
import { activePhotoChannels, photoIdentity } from '../../../shared/src/marketplacePhotoPlan';
import { DEFAULT_IMAGE_PROVIDER, MODEL_PHOTO_PROVIDER_VALUES, mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import { getModelPhotoProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { ASPECT_RATIO_VALUES, normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { withDeclaredModelAge } from '../../../shared/src/photoAttributes';
import { resolveAutomationPresetName } from '../../../shared/src/automationConfig';
import { assertUserRoles } from '../auth/roles';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { FAL_KEY, GEMINI_API_KEY, getGeminiModelBaseVerifierModel } from '../config/runtime';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { classifyPoseWithGemini } from '../utils/classifyPose';
import { generateSingleModelPhoto } from '../utils/modelPhotoGeneration';

const visualSpec = (spec: import('../../../shared/src/types').ModelBaseSpec) => {
  const { rulesRevision: _revision, lookingAtCamera: _gaze, standingFront: _standing, validation: _validation, ...visual } = spec;
  return visual;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function modelAssetFingerprint(storagePath: string, timing?: IdentityTiming) {
  const measure = <T,>(stage: string, run: () => Promise<T>) => timing ? timing.measure(stage, run) : run();
  const file = admin.storage().bucket().file(storagePath);
  const [metadata] = await measure('storageMetadata', () => file.getMetadata());
  const [bytes] = await measure('storageDownload', () => admin.storage().bucket().file(storagePath, { generation: metadata.generation }).download());
  if (!metadata.contentType?.startsWith('image/') || bytes.length >= 10 * 1024 * 1024) throw new HttpsError('failed-precondition', 'Base fuera del perfil de imagen admitido.');
  const sha256 = await measure('sha256', async () => hash(bytes));
  return { sha256, storageGeneration: String(metadata.generation) };
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
    const candidate = model.poses.filter(p => p.marketplaceBaseSpec && sameBaseSpec(p.marketplaceBaseSpec, visualSpec(spec))).at(-1);
    return { spec, ...(candidate ? { issues: baseObservationIssues(spec, candidate.photoObservation || undefined) } : {}), poseId: bases.find(b => compatibleBaseApproval(b, spec))?.id || null,
      candidatePoseIds: model.poses.filter(p => p.marketplaceBaseSpec && sameBaseSpec(p.marketplaceBaseSpec, visualSpec(spec))).map(p => p.id),
      estimatedCostUsd: getModelPhotoProviderCostUsd(provider, config.imageConfig, 1) + GEMINI_OPERATION_HOLD_USD };
  });
  const missing = shots.filter(s => !s.poseId);
  const preview: ModelPhotoSetsPreview = { ...(model.approvedIdentity ? { identitySha256: model.approvedIdentity.sha256 } : {}), id: photoIdentity([specs, model.poses.map(pose => [pose.id, pose.storagePath, pose.active ?? true, pose.marketplaceBaseSpec || null]), model.approvedIdentity || null, model.marketplaceBaseApprovals || [], provider, normalized]), provider, shots, incompatible,
    maxAttempts: MODEL_BASE_MAX_ATTEMPTS, maxCostUsd: Number((missing.reduce((sum, s) => sum + s.estimatedCostUsd, 0) * MODEL_BASE_MAX_ATTEMPTS).toFixed(6)),
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

export async function verifyModelBaseCore(input: VerifyModelBaseRequest, uid: string, onReviewCost?: (costUsd: number) => Promise<void>): Promise<VerifyModelBaseResponse> {
  const context = await loadModelSetContext({ ...input, ...(input.poseRecipeId && !input.poseRecipeIds ? { poseRecipeIds: [input.poseRecipeId] } : {}), channels: [input.channel] }, uid);
  const { ref, model, preview } = context;
  if (preview.issues.length) throw new HttpsError('failed-precondition', preview.issues.join(' '));
  const spec = preview.shots.find(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)?.spec;
  // Inactive candidates can be reviewed without first exposing them to generation.
  const pose = model.poses.find(p => p.id === input.poseId);
  if (!spec || !pose) throw new HttpsError('invalid-argument', 'Toma o base no disponible.');
  const identity = model.approvedIdentity!;
  const identityFingerprint = await modelAssetFingerprint(identity.storagePath);
  if (identity.sha256 !== identityFingerprint.sha256 || identity.storageGeneration !== identityFingerprint.storageGeneration) throw new HttpsError('failed-precondition', 'La identidad cambió. Apruébala de nuevo.');
  const fingerprint = await modelAssetFingerprint(pose.storagePath);
  const result = await classifyPoseWithGemini({ apiKey: GEMINI_API_KEY.value(), model: getGeminiModelBaseVerifierModel(), pose: { ...pose, marketplaceBaseSpec: spec },
    clientId: model.clientId, modelId: ref.id, userUid: uid, identityStoragePath: identity.storagePath, performer: identity.performer, onUsage: onReviewCost });
  const observation = result.photoObservation && withDeclaredModelAge(result.photoObservation, model.identityTraits);
  if (!observation?.verified) throw new HttpsError('unavailable', 'Gemini no produjo una observación fiable. Conserva la imagen y verifica de nuevo, sin regenerar.');
  const issues = baseObservationIssues(spec, observation, { requireFillerOutfit: true });
  if (!(await assetGenerationMatches(pose.storagePath, fingerprint.storageGeneration))) throw new HttpsError('aborted', 'La fotografía cambió durante la verificación.');
  await getAppFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Model;
    if (!current || current.clientId !== model.clientId || current.approvedIdentity?.sha256 !== identity.sha256
      || current.poses.find(p => p.id === pose.id)?.storagePath !== pose.storagePath) throw new HttpsError('aborted', 'La identidad o las bases cambiaron.');
    const rules = (await tx.get(modelMarketplaceRulesRef())).get('marketplaces');
    if ((rules?.[spec.channel]?.revision ?? 0) !== (spec.rulesRevision ?? 0)) throw new HttpsError('aborted', 'Las reglas cambiaron durante la verificación. Revisa y verifica de nuevo.');
    const approvals = (current.marketplaceBaseApprovals || []).filter(a => !(a.poseId === pose.id && sameBaseSpec(a.spec, spec)));
    if (!issues.length) approvals.push({ clientId: model.clientId, modelId: ref.id, recipeRevision: context.client.marketplaces?.[spec.channel]?.photoRecipeRevision ?? 0,
      verifierModel: getGeminiModelBaseVerifierModel(), confidence: result.confidence, spec, poseId: pose.id, storagePath: pose.storagePath, ...fingerprint, identitySha256: identity.sha256, observation: observation!,
      verifiedAt: new Date().toISOString(), verifiedByUid: uid, verifierVersion: 'model-base-verifier-v1' });
    tx.update(ref, { marketplaceBaseApprovals: approvals, poses: current.poses.map(p => p.id === pose.id && observation ? { ...p, active: modelBasePoseActiveAfterReview(p, approvals), photoObservation: observation, aiClassification: buildPoseAiClassification({ ...result, taggedAt: new Date().toISOString(), displayLabel: spec.poseRecipeId ? MODEL_POSE_RECIPES_BY_ID.get(spec.poseRecipeId)?.label : null }) } : p), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { approved: !issues.length, poseId: pose.id, issues, observation, reviewCostUsd: result.usageCostUsd ?? 0 };
}

type StoredOperation = ModelBaseOperation & {
  inputHash: string; input: GenerateModelBaseRequest; createdByUid: string;
  provider: import('../../../shared/src/types').ModelPhotoProvider;
  imageConfig: import('../../../shared/src/types').ProviderImageConfig;
  identity: NonNullable<Model['approvedIdentity']>;
  executionMode: 'inline' | 'background'; claimToken?: string;
};
const validRequestId = (id: string) => typeof id === 'string' && /^[\w-]{1,160}$/.test(id);

/** All selected combinations enter the durable queue in one transaction, before returning to the UI. */
export async function scheduleModelPhotoSetsCore(input: ScheduleModelPhotoSetsRequest, uid: string, executionMode: StoredOperation['executionMode'] = 'background') {
  if (!validRequestId(input.requestId) || !Array.isArray(input.combinations) || !input.combinations.length || input.combinations.length > 160)
    throw new HttpsError('invalid-argument', 'Solicitud o combinaciones inválidas.');
  const concrete = executionMode === 'inline' && input.combinations[0].poseRecipeId && !input.poseRecipeIds ? { poseRecipeIds: [input.combinations[0].poseRecipeId] } : {};
  const { ref, model, preview, provider, mappedProvider, normalized } = await loadModelSetContext({ ...input, ...concrete }, uid);
  if (preview.issues.length) throw new HttpsError('failed-precondition', preview.issues.join(' '));
  const selected = input.combinations.map(c => preview.shots.find(s => s.spec.channel === c.channel && s.spec.shot === c.shot && s.spec.poseRecipeId === c.poseRecipeId));
  if (selected.some(s => !s) || new Set(selected.map(s => photoIdentity(s!.spec))).size !== selected.length)
    throw new HttpsError('invalid-argument', 'Combinaciones inválidas o duplicadas.');
  const batch = ref.collection('baseSchedules').doc(input.requestId);
  const inputHash = photoIdentity(input);
  return getAppFirestore().runTransaction(async tx => {
    const prior = await tx.get(batch);
    if (prior.exists) {
      if (prior.get('inputHash') !== inputHash) throw new HttpsError('already-exists', 'Solicitud usada con otras combinaciones.');
      return prior.get('operationIds') as string[];
    }
    const current = (await tx.get(ref)).data() as Model;
    if (!current || current.clientId !== model.clientId || JSON.stringify(current.approvedIdentity) !== JSON.stringify(model.approvedIdentity)) throw new HttpsError('aborted', 'La identidad cambió.');
    const rules = (await tx.get(modelMarketplaceRulesRef())).get('marketplaces');
    const entries = [];
    for (const shot of selected) {
      const spec = shot!.spec;
      if ((rules?.[spec.channel]?.revision ?? 0) !== (spec.rulesRevision ?? 0)) throw new HttpsError('aborted', 'Las reglas cambiaron.');
      const lock = ref.collection('baseCombinationLocks').doc(photoIdentity([spec, preview.identitySha256]));
      const locked = await tx.get(lock);
      const existing = locked.exists ? await tx.get(ref.collection('baseOperations').doc(locked.get('requestId'))) : null;
      entries.push({ shot: shot!, lock, existing });
    }
    if (input.approvedPreviewId !== preview.id) throw new HttpsError('failed-precondition', 'El costo o el set cambió. Revisa la estimación.');
    const operationIds: string[] = [];
    for (const { shot, lock, existing } of entries) {
      if (modelPhotoBases(current).some(b => compatibleBaseApproval(b, shot.spec)) && shot.poseId) continue;
      // Terminal operations stay available for manual review; a new request cannot reset the attempt cap.
      if (existing?.exists && existing.get('spec')) {
        const prior = existing.data() as StoredOperation;
        // Only a technical failure without an image may resume; visual attempts already paid are kept and still count.
        if (modelBaseResumable(prior)) tx.update(existing.ref, { status: 'queued', executionMode, attemptNumber: prior.attempts.filter(a => a.poseId).length,
          attempts: prior.attempts.filter(a => a.poseId), technicalErrors: [...(prior.technicalErrors || []), ...prior.attempts.filter(a => !a.poseId)],
          error: null, claimToken: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        operationIds.push(existing.id); continue;
      }
      if (existing?.exists && ['generating', 'verifying'].includes(existing.get('status'))) throw new HttpsError('failed-precondition', 'Esta combinación ya se está procesando.');
      const operationId = executionMode === 'inline' ? input.requestId : photoIdentity([input.requestId, shot.spec]);
      const operation = ref.collection('baseOperations').doc(operationId);
      const config = shot.spec.aspectRatio === normalized.aspectRatio && shot.spec.channel !== 'tiktok-shop' ? normalized : photoConfigForRatio({ provider: mappedProvider, imageConfig: normalized.imageConfig }, shot.spec.aspectRatio);
      const generationInput: GenerateModelBaseRequest = { ...input, ...concrete, channel: shot.spec.channel, shot: shot.spec.shot, ...(shot.spec.poseRecipeId ? { poseRecipeId: shot.spec.poseRecipeId } : {}), requestId: operationId };
      tx.create(operation, { inputHash, input: generationInput, spec: shot.spec, identity: model.approvedIdentity!, identitySha256: preview.identitySha256!, provider, imageConfig: config.imageConfig,
        status: 'queued', attemptNumber: 0, attempts: [], executionMode, createdByUid: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(lock, { requestId: operationId });
      operationIds.push(operationId);
    }
    tx.create(batch, { inputHash, operationIds, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return operationIds;
  });
}

/** One paid attempt per claim. Never reclaim an ambiguous in-flight provider call. */
export async function processModelBaseOperation(modelId: string, operationId: string, expectedAttemptNumber?: number) {
  const db = getAppFirestore(), ref = db.doc(`models/${modelId}`), operation = ref.collection('baseOperations').doc(operationId);
  const expected = expectedAttemptNumber ?? (await operation.get()).get('attemptNumber');
  const token = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const snapshot = await tx.get(operation);
    const data = snapshot.data() as StoredOperation | undefined;
    if (!data || data.status !== 'queued' || data.attemptNumber !== expected || data.attemptNumber >= MODEL_BASE_MAX_ATTEMPTS) return null;
    const number = data.attemptNumber + 1;
    const prompt = modelBaseRetryPrompt(data.spec, data.attempts.flatMap(a => a.verification?.issues || []));
    const attempt: ModelBaseAttempt = { number, prompt };
    tx.update(operation, { status: 'generating', result: null, error: null, claimToken: token, attemptNumber: number, attempts: [...data.attempts, attempt], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { ...data, attemptNumber: number, attempts: [...data.attempts, attempt] };
  });
  if (!claimed) return;
  const attempt = claimed.attempts.at(-1)!;
  const patch = async (fields: Record<string, unknown>) => db.runTransaction(async tx => {
    const snapshot = await tx.get(operation);
    if (snapshot.get('claimToken') !== token) throw new HttpsError('aborted', 'La operación cambió.');
    tx.update(operation, { ...fields, attempts: claimed.attempts, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  try {
    await assertUserRoles(claimed.createdByUid, null, ['admin']);
    const context = await loadModelSetContext(claimed.input, claimed.createdByUid);
    if (context.preview.issues.length || JSON.stringify(context.model.approvedIdentity) !== JSON.stringify(claimed.identity)
      || !context.preview.shots.some(s => sameBaseSpec(s.spec, claimed.spec))) throw new Error('Identidad, reglas o configuración cambiaron; requiere revisión manual.');
    const alreadyApproved = context.preview.shots.find(s => sameBaseSpec(s.spec, claimed.spec))?.poseId;
    if (alreadyApproved) { await patch({ status: 'approved', result: { approved: true, poseId: alreadyApproved, issues: [] } }); return; }
    const identity = claimed.identity;
    const fingerprint = await modelAssetFingerprint(identity.storagePath);
    if (identity.sha256 !== fingerprint.sha256 || identity.storageGeneration !== fingerprint.storageGeneration) throw new Error('La identidad cambió.');
    const [url] = await admin.storage().bucket().file(identity.storagePath, { generation: identity.storageGeneration }).getSignedUrl({ action: 'read', expires: Date.now() + 3600000, version: 'v4' });
    const result = await generateSingleModelPhoto({ provider: claimed.provider, prompt: attempt.prompt, imageConfig: claimed.imageConfig, falKey: FAL_KEY.value(), referenceImageUrl: url, preserveReferenceDetails: true });
    const poseId = randomUUID(), ext = extensionForContentType(result.contentType);
    const storagePath = `model_generations/${context.model.clientId}/${ref.id}/pose/${operationId}/${poseId}.${ext}`;
    attempt.poseId = poseId; attempt.storagePath = storagePath;
    attempt.generationCostUsd = getModelPhotoProviderCostUsd(claimed.provider, claimed.imageConfig, 1);
    // Account for every completed provider call, including a later upload/review failure.
    await db.runTransaction(async tx => {
      const op = await tx.get(operation);
      if (op.get('claimToken') !== token || op.get('status') !== 'generating') throw new Error('La operación cambió.');
      tx.update(operation, { attempts: claimed.attempts, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(ref, { generatedPhotoCount: admin.firestore.FieldValue.increment(1), generatedPhotoCostUsd: admin.firestore.FieldValue.increment(attempt.generationCostUsd!) });
      tx.create(db.collection('model_generation_logs').doc(`${modelId}-${operationId}-${attempt.number}`), { provider: claimed.provider, requestedPhotos: 1, completedPhotos: 1, estimatedCostUsd: attempt.generationCostUsd, clientId: context.model.clientId, modelId, poseId, operationId, attemptNumber: attempt.number, stage: 'pose', createdByUid: claimed.createdByUid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    await admin.storage().bucket().file(storagePath).save(result.imageBytes, { resumable: false, metadata: { contentType: result.contentType } });
    const pose: Pose = { id: poseId, active: false, storagePath, fileName: `${claimed.spec.channel}-${claimed.spec.bodyArea}-${claimed.spec.poseRecipeId || claimed.spec.shot}.${ext}`, marketplaceBaseSpec: claimed.spec, createdAt: new Date().toISOString() };
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Model;
      const op = await tx.get(operation);
      if (op.get('claimToken') !== token || op.get('status') !== 'generating') throw new Error('La operación cambió.');
      if (!current) throw new Error('Modelo no disponible.');
      tx.update(ref, { poses: [...current.poses, pose], poseCount: current.poses.length + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(operation, { status: 'verifying', attempts: claimed.attempts, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    const verification = await verifyModelBaseCore({ ...claimed.input, poseId }, claimed.createdByUid, async cost => {
      attempt.reviewCostUsd = cost;
      await patch({ status: 'verifying' });
    });
    attempt.verification = verification; attempt.reviewCostUsd = verification.reviewCostUsd ?? attempt.reviewCostUsd ?? 0;
    await patch({ status: modelBaseReviewOutcome(verification, attempt.number), result: verification, claimToken: null });
  } catch (error) {
    attempt.error = error instanceof Error ? error.message : 'Error técnico';
    await patch({ status: attempt.poseId ? 'needs_attention' : 'failed', error: attempt.error, claimToken: null });
  }
}

/** Connector compatibility: waits server-side using the same persisted attempts and retry policy. */
export async function generateModelBaseCore(input: GenerateModelBaseRequest, uid: string): Promise<VerifyModelBaseResponse> {
  if (!validRequestId(input.requestId) || !validRequestId(input.modelId)) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const operation = getAppFirestore().doc(`models/${input.modelId}/baseOperations/${input.requestId}`);
  const prior = await operation.get();
  if (prior.exists) {
    if (prior.get('inputHash') !== photoIdentity({ ...input, combinations: [{ channel: input.channel, shot: input.shot, ...(input.poseRecipeId ? { poseRecipeId: input.poseRecipeId } : {}) }] }))
      throw new HttpsError('already-exists', 'Solicitud usada con otra toma.');
    if (!['queued', 'generating', 'verifying'].includes(prior.get('status')) && prior.get('result')) return prior.get('result') as VerifyModelBaseResponse;
    throw new HttpsError('failed-precondition', 'Operación ya iniciada; revisa su progreso.');
  }
  const ids = await scheduleModelPhotoSetsCore({ ...input, combinations: [{ channel: input.channel, shot: input.shot, ...(input.poseRecipeId ? { poseRecipeId: input.poseRecipeId } : {}) }] }, uid, 'inline');
  if (!ids.length) {
    const { preview } = await loadModelSetContext(input, uid);
    return { approved: true, poseId: preview.shots.find(s => s.spec.shot === input.shot && s.spec.poseRecipeId === input.poseRecipeId)!.poseId!, issues: [] };
  }
  const target = operation.parent.doc(ids[0]);
  for (let n = 0; n < MODEL_BASE_MAX_ATTEMPTS; n++) {
    await processModelBaseOperation(input.modelId, ids[0]);
    const latest = await target.get();
    if (latest.get('status') !== 'queued') {
      if (latest.get('result')) return latest.get('result') as VerifyModelBaseResponse;
      throw new HttpsError('internal', latest.get('error') || 'Operación en curso; consulta su progreso.');
    }
  }
  throw new HttpsError('internal', 'Revisa el estado de la operación.');
}
