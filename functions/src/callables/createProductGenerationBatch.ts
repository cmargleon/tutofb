import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { AutomationJob, Batch, Client, CreateGenerationBatchResponse, CreateProductGenerationBatchRequest, Job } from '../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../shared/src/domain';
import { buildProductPrompt, buildProductSceneInstructions } from '../../../shared/src/productGeneration';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertCallableRoles } from '../auth/roles';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { getJobAutoReviewMaxAttempts } from '../config/runtime';
import { buildJobDraft } from './createGenerationBatch.helpers';
import { validateProductGenerationInput } from './createProductGenerationBatch.helpers';

export const createProductGenerationBatchCore = async (
  input: CreateProductGenerationBatchRequest, uid: string, automation?: { id: string; leaseToken: string },
): Promise<CreateGenerationBatchResponse> => {
  const db = getAppFirestore();
  const system = await getSystemConfigCached();
  const data = validateProductGenerationInput(input, uid, system.batchMaxJobs);
  assertProviderEnabledInSystemConfig(data.provider, system, 'generar objetos');
  const imageConfig = normalizeProviderImageConfig(data.provider, data.imageConfig, data.aspectRatio || '1:1');
  const batchId = automation ? `automation-${automation.id}` : `product-${createHash('sha256').update(`${uid}:${data.requestId}`).digest('hex')}`;
  const batchRef = db.collection('batches').doc(batchId);
  const clientRef = db.collection('clients').doc(data.clientId);
  const userSnapshot = await db.collection('users').doc(uid).get();
  const now = FieldValue.serverTimestamp();
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(batchRef);
    if (existing.exists) {
      if (existing.data()!.createdByUid !== uid) throw new HttpsError('permission-denied', 'Lote no disponible.');
      return { batchId, createdJobs: existing.data()!.totalJobs as number };
    }
    const clientSnapshot = await tx.get(clientRef);
    const client = clientSnapshot.data() as Client | undefined;
    if (!client || !isActiveCatalogEntity(client)) throw new HttpsError('not-found', 'El cliente no está disponible.');
    const automationRef = automation ? db.collection('automationJobs').doc(automation.id) : null;
    if (automationRef) {
      const current = (await tx.get(automationRef)).data() as AutomationJob | undefined;
      if (!current || current.leaseToken !== automation!.leaseToken || current.status !== 'importing') throw new HttpsError('aborted', 'Reserva expirada.');
    }
    const jobs: Array<{ id: string; data: Omit<Job, 'id'> }> = [];
    for (const item of data.items) {
      for (const scene of data.scenes) {
        const instructions = buildProductSceneInstructions(data.prompt, scene.prompt);
        jobs.push({ id: db.collection('jobs').doc().id, data: {
          ...buildJobDraft({ garmentIsMultiAngle: item.referencePaths.length > 1 }, data.provider, instructions, null, Math.max(1, Math.min(3, getJobAutoReviewMaxAttempts() || 3))),
          ...(automation ? { automationJobId: automation.id } : {}), generationKind: 'product', productScene: scene.type,
          productReferencePaths: item.referencePaths, batchId, clientId: data.clientId, clientNameSnapshot: client.name,
          modelId: '', modelNameSnapshot: 'Producto', poseImageId: scene.type,
          poseImagePath: item.referencePaths[0], poseFileName: item.name,
          garmentId: item.id, garmentName: item.name, garmentFilePath: item.referencePaths[1] || item.referencePaths[0],
          garmentIsMultiAngle: item.referencePaths.length > 1, finalPrompt: buildProductPrompt(data.prompt, scene.prompt),
          provider: data.provider, aspectRatio: imageConfig.aspectRatio, imageConfig: imageConfig.imageConfig,
          maxRetries: system.jobMaxRetries, completedAt: null, currentOutputId: null, currentOutput: null,
          completedOutputCount: 0, totalCostUsd: 0, totalDurationSeconds: 0, manualRegenerationCount: 0,
          createdAt: now, updatedAt: now, createdByUid: uid,
        } });
      }
    }
    const batch: Omit<Batch, 'id'> = {
      ...(automation ? { automationJobId: automation.id } : {}), generationKind: 'product', clientId: data.clientId, clientNameSnapshot: client.name,
      modelId: '', modelNameSnapshot: 'Producto', outputMode: 'photos_only', provider: data.provider,
      aspectRatio: imageConfig.aspectRatio, imageConfig: imageConfig.imageConfig, promptBase: data.prompt, productScenes: data.scenes,
      poseIds: [], garmentCount: data.items.length, totalJobs: jobs.length, pendingJobs: jobs.length, processingJobs: 0, completedJobs: 0, failedJobs: 0,
      status: 'pending', latestJobCreatedAt: now, createdAt: now, updatedAt: now, createdByUid: uid,
      createdByDisplayName: userSnapshot.data()?.displayName || null,
    };
    tx.create(batchRef, batch);
    for (const job of jobs) tx.create(db.collection('jobs').doc(job.id), job.data);
    if (automationRef) tx.update(automationRef, {
      batchId, generationJobIds: jobs.map((job) => job.id), status: 'processing', leaseToken: null, leaseExpiresAt: null,
      error: null, updatedAt: now, progress: { total: jobs.length, completed: 0, failed: 0 },
    });
    tx.update(clientRef, { batchCount: FieldValue.increment(1), lastBatchCreatedAt: now, updatedAt: now });
    return { batchId, createdJobs: jobs.length };
  });
};

export const createProductGenerationBatch = onCall<CreateProductGenerationBatchRequest, Promise<CreateGenerationBatchResponse>>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador']);
  return createProductGenerationBatchCore(request.data, request.auth!.uid);
});
