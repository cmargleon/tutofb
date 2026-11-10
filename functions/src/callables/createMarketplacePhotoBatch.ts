import { GEMINI_API_KEY } from '../config/runtime';
import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { AutomationJob, Batch, Client, CreateMarketplacePhotoBatchRequest, Job, Model, PhotoPlan, PhotoPlanInput } from '../../../shared/src/types';
import { activePhotoChannels, buildMarketplacePhotoPlan, canonicalPhotoJson } from '../../../shared/src/marketplacePhotoPlan';
import { normalizePhotoAttributes, withDeclaredModelAge } from '../../../shared/src/photoAttributes';
import { COMMERCIAL_PHOTO_PROFILE, resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertCallableRoles } from '../auth/roles';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { buildJobDraft } from './createGenerationBatch.helpers';
import { automationScenePatch } from '../automation/recovery';

export async function resolveMarketplacePhotoPlan(data: PhotoPlanInput & { modelId?: string | null }, uid: string, frozen?: Client['marketplaces']): Promise<PhotoPlan> {
  if (!data || typeof data.clientId !== 'string' || !Array.isArray(data.articles) || !data.articles.length || data.articles.length > 100) throw new HttpsError('invalid-argument', 'Artículos inválidos.');
  const db = getAppFirestore();
  const client = (await db.doc(`clients/${data.clientId}`).get()).data() as Client | undefined;
  if (!client || client.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const system = await getSystemConfigCached();
  assertProviderEnabledInSystemConfig(data.provider, system);
  const normalized = resolveCommercialPhotoConfig(data.provider, data.imageConfig, data.aspectRatio);
  const model = data.modelId ? (await db.doc(`models/${data.modelId}`).get()).data() as Model | undefined : undefined;
  if (data.modelId && (!model || model.clientId !== data.clientId || model.active === false || model.status === 'archived')) throw new HttpsError('failed-precondition', 'Modelo no disponible para este cliente.');
  const articles = data.articles.map(a => {
    if (![a.itemId, a.productId, a.variantId, a.name].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200) || !['garment', 'product'].includes(a.kind) || !Array.isArray(a.references) || a.references.length > 20) throw new HttpsError('invalid-argument', 'Identidad o referencias inválidas.');
    for (const r of a.references) if (typeof r.storagePath !== 'string' || !r.storagePath.startsWith(`garments/drafts/${uid}/`) || /[\\%?#\x00-\x1f]/.test(r.storagePath) || r.storagePath.split('/').some(p => p === '..' || p === '.') || !['front', 'back', 'side', 'detail'].includes(r.view)) throw new HttpsError('permission-denied', 'Referencia fuera de los drafts del operador.');
    return { ...a, attributes: normalizePhotoAttributes(a.attributes, true) };
  });
  if (new Set(articles.map(a => a.itemId)).size !== articles.length) throw new HttpsError('invalid-argument', 'Identificadores de artículo duplicados.');
  return buildMarketplacePhotoPlan({ clientId: data.clientId, articles, ...(data.objectScenes ? { objectScenes: data.objectScenes } : {}), marketplaces: frozen ?? client.marketplaces,
    bases: (model?.poses || []).filter(p => p.active !== false).map(p => ({ id: p.id, storagePath: p.storagePath, ...(p.photoObservation ? { observation: p.photoObservation } : {}) })),
    provider: data.provider, imageConfig: normalized.imageConfig, aspectRatio: normalized.aspectRatio });
}

export async function createMarketplacePhotoBatchCore(data: CreateMarketplacePhotoBatchRequest, uid: string, automation?: { id: string; leaseToken: string; plan: PhotoPlan }) {
  if (typeof data.requestId !== 'string' || !/^[\w-]{1,160}$/.test(data.requestId) || typeof data.prompt !== 'string' || data.prompt.length > 30000) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const db = getAppFirestore();
  const identity = createHash('sha256').update(`${uid}:${data.clientId}:${data.requestId}`).digest('hex');
  const batchRef = db.doc(`batches/photo-${identity}`);
  const inputHash = createHash('sha256').update(canonicalPhotoJson([data.approvedPlanId, data.prompt, data.articles, data.provider, data.imageConfig, data.aspectRatio, data.modelId || null])).digest('hex');
  const previous = await batchRef.get();
  if (previous.exists) {
    if (previous.get('photoInputHash') !== inputHash) throw new HttpsError('already-exists', 'La solicitud ya se usó con otra entrada.');
    return { batchId: batchRef.id, createdJobs: previous.get('totalJobs') as number };
  }
  const plan = automation?.plan || await resolveMarketplacePhotoPlan(data, uid);
  if (plan.id !== data.approvedPlanId) throw new HttpsError('failed-precondition', 'El plan cambió. Revisa fotos, destinos y costo antes de generar.');
  if (!plan.channels.length || !plan.tasks.length || (!automation && plan.issues.some(i => i.blocking))) throw new HttpsError('failed-precondition', 'Corrige las incidencias del plan antes de generar.');
  const system = await getSystemConfigCached();
  if (plan.tasks.length > system.batchMaxJobs) throw new HttpsError('out-of-range', 'El plan excede el límite de trabajos.');

  const clientRef = db.doc(`clients/${data.clientId}`);
  const requestHash = createHash('sha256').update(canonicalPhotoJson([plan, data.prompt])).digest('hex');
  return db.runTransaction(async tx => {
    const automationRef = automation ? db.doc(`automationJobs/${automation.id}`) : null;
    const [existing, clientSnapshot] = await tx.getAll(batchRef, clientRef);
    const current = automationRef ? (await tx.get(automationRef)).data() as AutomationJob : null;
    if (existing.exists) {
      if (existing.get('photoRequestHash') !== requestHash) throw new HttpsError('already-exists', 'La solicitud ya se usó con otro plan.');
      return { batchId: batchRef.id, createdJobs: plan.tasks.length };
    }
    if (automation && (current?.leaseToken !== automation.leaseToken || current?.status !== 'importing' || current.batchId)) throw new HttpsError('aborted', 'La reserva de importación ya no está activa.');
    const client = clientSnapshot.data() as Client;
    if (!client || client.status === 'archived' || plan.channels.some(channel => client.marketplaces?.[channel]?.enabled !== true)) throw new HttpsError('failed-precondition', 'Un canal del plan ya no está habilitado. Prepara un nuevo plan.');
    if (!automation && canonicalPhotoJson(activePhotoChannels(client.marketplaces)) !== canonicalPhotoJson(plan.channels)) throw new HttpsError('failed-precondition', 'Los destinos cambiaron. Revisa el plan.');
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch: Omit<Batch, 'id'> = { photoPlan: plan, photoProfile: COMMERCIAL_PHOTO_PROFILE, generationKind: data.articles[0].kind,
      ...(automation ? { automationJobId: automation.id } : {}),
      clientId: data.clientId, clientNameSnapshot: client.name, clientSnapshot: { id: data.clientId, name: client.name }, modelId: data.modelId || '', modelNameSnapshot: 'Plan de fotografías', outputMode: 'photos_only',
      provider: plan.effectiveConfig.provider, aspectRatio: plan.effectiveConfig.aspectRatio, imageConfig: plan.effectiveConfig.imageConfig, promptBase: data.prompt,
      poseIds: plan.tasks.map(t => t.id), garmentCount: plan.articles.length, totalJobs: plan.tasks.length, pendingJobs: plan.tasks.length, processingJobs: 0, completedJobs: 0, failedJobs: 0, status: 'pending',
      latestJobCreatedAt: now, createdAt: now, updatedAt: now, createdByUid: uid };
    tx.create(batchRef, { ...batch, photoRequestHash: requestHash, photoInputHash: inputHash });
    const ids: string[] = [];
    for (const task of plan.tasks) {
      const jobRef = db.doc(`jobs/photo-${identity}-${task.id}`); ids.push(jobRef.id);
      const article = plan.articles.find(a => a.itemId === task.itemId)!;
      const prompt = `${data.prompt}\n\nPlan aprobado ${plan.id}; tarea ${task.id}. Las siguientes obligaciones se conservan en todos los intentos:\n${task.instructions}`;
      const references = [...(task.base || task.identityBase ? [(task.base || task.identityBase)!.storagePath] : []), ...task.referencePaths];
      const draft = buildJobDraft({ garmentIsMultiAngle: task.referencePaths.length > 1, garmentReferenceImageType: 'single_view', promptCaseKey: null, promptCaseText: null }, plan.effectiveConfig.provider, prompt, null, current?.effectivePolicy?.maxReviewAttempts || 3, prompt);
      const job: Omit<Job, 'id'> = { ...draft, ...automationScenePatch(current?.effectivePolicy), photoPlanId: plan.id, photoTask: task, photoProfile: COMMERCIAL_PHOTO_PROFILE,
        ...(automation ? { automationJobId: automation.id } : {}),
        // Reference editing accepts both a verified model base and model-free product inputs.
        generationKind: 'product', productScene: task.id, productReferencePaths: references,
        batchId: batchRef.id, clientId: data.clientId, clientNameSnapshot: client.name, modelId: data.modelId || '', modelNameSnapshot: 'Plan de fotografías',
        poseImageId: task.id, poseImagePath: references[0], garmentId: task.itemId, garmentName: article.name, garmentFilePath: task.referencePaths[0], garmentIsMultiAngle: task.referencePaths.length > 1,
        aspectRatio: plan.effectiveConfig.aspectRatio, imageConfig: plan.effectiveConfig.imageConfig,
        maxRetries: current?.effectivePolicy?.maxOperationalRetries ?? system.jobMaxRetries,
        completedAt: null, latestOutputCreatedAt: null, currentOutputId: null, currentOutput: null, completedOutputCount: 0, totalCostUsd: 0, totalDurationSeconds: 0, providerUsage: {}, manualRegenerationCount: 0,
        createdAt: now, updatedAt: now, createdByUid: uid, lastError: null, failureInfo: null };
      tx.create(jobRef, job);
    }
    if (automationRef) tx.update(automationRef, { photoPlan: plan, batchId: batchRef.id, batchIds: [batchRef.id], generationJobIds: ids, status: 'processing', leaseToken: null, leaseExpiresAt: null, error: null,
      progress: { total: ids.length, completed: 0, failed: 0 }, updatedAt: now });
    tx.set(clientRef, { batchCount: admin.firestore.FieldValue.increment(1), lastBatchCreatedAt: now }, { merge: true });
    return { batchId: batchRef.id, createdJobs: ids.length };
  });
}
export const previewMarketplacePhotoPlan = onCall<PhotoPlanInput & { modelId?: string | null }>(async request => {
  await assertCallableRoles(request, ['admin', 'operador']);
  await assertHumanClientAccess(request.auth!.uid, request.data.clientId);
  return resolveMarketplacePhotoPlan(request.data, request.auth!.uid);
});
export const createMarketplacePhotoBatch = onCall<CreateMarketplacePhotoBatchRequest>(async request => {
  await assertCallableRoles(request, ['admin', 'operador']);
  await assertHumanClientAccess(request.auth!.uid, request.data.clientId);
  return createMarketplacePhotoBatchCore(request.data, request.auth!.uid);
});

/** Add observations to a few selected existing bases; never regenerates the catalogue. */
export const verifyMarketplacePhotoBases = onCall<{ modelId: string; poseIds: string[] }>({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300 }, async request => {
  await assertCallableRoles(request, ['admin']);
  const { classifyPoseWithGemini } = await import('../utils/classifyPose');
  const { GEMINI_API_KEY, getGeminiPoseClassificationModel } = await import('../config/runtime');
  const db = getAppFirestore();
  if (!request.data.modelId || !Array.isArray(request.data.poseIds) || request.data.poseIds.length > 8) throw new HttpsError('invalid-argument', 'Selecciona hasta ocho bases.');
  const ref = db.doc(`models/${request.data.modelId}`); const snapshot = await ref.get(); const model = snapshot.data() as Model;
  if (!model) throw new HttpsError('not-found', 'Modelo no encontrado.');
  await assertHumanClientAccess(request.auth!.uid, model.clientId);
  const observations = new Map<string, NonNullable<Model['poses'][number]['photoObservation']>>();
  for (const id of request.data.poseIds) {
    const pose = model.poses.find(p => p.id === id);
    if (!pose) throw new HttpsError('invalid-argument', 'Base fuera del modelo.');
    const result = await classifyPoseWithGemini({ apiKey: GEMINI_API_KEY.value(), model: getGeminiPoseClassificationModel(), pose, clientId: model.clientId, modelId: ref.id, userUid: request.auth!.uid });
    if (result.photoObservation) observations.set(id, withDeclaredModelAge(result.photoObservation, model.identityTraits));
  }
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Model;
    if (!current || request.data.poseIds.some(id => current.poses.find(p => p.id === id)?.storagePath !== model.poses.find(p => p.id === id)?.storagePath)) throw new HttpsError('aborted', 'Las bases cambiaron.');
    tx.update(ref, { poses: current.poses.map(p => observations.has(p.id) ? { ...p, photoObservation: observations.get(p.id) } : p), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { modelId: ref.id, observations: Object.fromEntries(observations) };
});
