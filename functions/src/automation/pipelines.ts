import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { AutomationInput, AutomationJob, AutomationPreset, Batch, Client, Job, Model, UploadedGarmentInput } from '../../../shared/src/types';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { createGenerationBatchCore } from '../callables/createGenerationBatch';
import { buildJobDraft, getCompatibleGarmentPoseCombinations } from '../callables/createGenerationBatch.helpers';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { GEMINI_API_KEY, getGeminiGarmentViewClassificationModel, getJobAutoReviewMaxAttempts } from '../config/runtime';
import { PRODUCT_IDENTITY_RULES, PRODUCT_PRESETS } from './presets';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';

const groupedImages = (inputs: AutomationInput[]) => {
  const groups = new Map<string, AutomationInput[]>();
  for (const image of inputs) groups.set(image.itemId, [...(groups.get(image.itemId) || []), image]);
  return groups;
};
export const dispatchGarment = async (job: AutomationJob, client: Client, config: AutomationPreset, modelId: string): Promise<void> => {
  const snapshot = await getAppFirestore().collection('models').doc(modelId).get();
  const model = snapshot.data() as Model | undefined;
  if (!model || model.status === 'archived' || model.clientId !== job.clientId) throw new AutomationAttentionError('El modelo no está disponible para este cliente.');
  const garments: UploadedGarmentInput[] = [];
  for (const [itemId, images] of groupedImages(job.inputImages)) {
    const classified = await classifyGarmentWithGemini({
      apiKey: GEMINI_API_KEY.value(), model: getGeminiGarmentViewClassificationModel(), userUid: job.createdByUid,
      categories: [], fallbackCategoryId: null,
      garment: { garmentId: itemId, garmentName: images[0].fileName, photos: images.map((image, index) => ({
        id: `${itemId}-${index}`, fileName: image.fileName, storagePath: image.storagePath!, sourceIndex: index,
      })) },
    });
    if (!classified.garmentBodyArea || classified.photos.some((photo) => (photo.confidence ?? 0) < 0.65)) {
      throw new AutomationAttentionError(`La clasificación de ${images[0].fileName} necesita revisión. Usa el wizard para seleccionar vistas manualmente.`);
    }
    garments.push({
      id: itemId, name: images[0].fileName, storagePath: images[0].storagePath!, isMultiAngle: images.length > 1,
      sourceType: 'single', originalFileNames: images.map((image) => image.fileName),
      photos: classified.photos, garmentBodyArea: classified.garmentBodyArea, garmentAccessoryType: classified.garmentAccessoryType,
    });
  }
  const poseIds = config.poseIds || model.poses.map((pose) => pose.id);
  const combinations = getCompatibleGarmentPoseCombinations(garments, model.poses.filter((pose) => poseIds.includes(pose.id)));
  const coveredGarments = new Set(combinations.map(({ garment }) => garment.id));
  if (poseIds.some((id) => !model.poses.some((pose) => pose.id === id)) || coveredGarments.size !== garments.length) {
    throw new AutomationAttentionError('Hay artículos sin poses clasificadas compatibles con sus vistas. Revisa el modelo/preset.');
  }
  await createGenerationBatchCore({
    clientId: job.clientId, modelId, poseIds,
    provider: config.provider || DEFAULT_AUTOMATION_PROVIDER, aspectRatio: config.aspectRatio || '3:4',
    outputMode: 'photos_only', garments, productDrafts: [], promptBase: client.generationPromptBase || '',
  }, job.createdByUid, { id: job.id, leaseToken: job.leaseToken! });
};

export const dispatchProduct = async (job: AutomationJob, client: Client, config: AutomationPreset): Promise<void> => {
  const db = getAppFirestore();
  const system = await getSystemConfigCached();
  const provider = config.provider || DEFAULT_AUTOMATION_PROVIDER;
  assertProviderEnabledInSystemConfig(provider, system, 'automatizar productos');
  const preset = PRODUCT_PRESETS.generic_product;
  const imageConfig = normalizeProviderImageConfig(provider, null, config.aspectRatio || preset.aspectRatio);
  const now = FieldValue.serverTimestamp();
  const batchRef = db.collection('batches').doc(`automation-${job.id}`);
  const jobs: Array<{ id: string; data: Omit<Job, 'id'> }> = [];
  for (const [itemId, images] of groupedImages(job.inputImages)) {
    for (const scene of preset.scenes) {
      const prompt = `${PRODUCT_IDENTITY_RULES}\n${scene.prompt}`;
      jobs.push({ id: db.collection('jobs').doc().id, data: {
        ...buildJobDraft({ garmentIsMultiAngle: false }, provider, prompt, null, Math.max(1, Math.min(preset.maxReviewAttempts, getJobAutoReviewMaxAttempts() || 3))),
        automationJobId: job.id, generationKind: 'product', productScene: scene.type,
        productReferencePaths: images.map((image) => image.storagePath!),
        batchId: batchRef.id, clientId: job.clientId, clientNameSnapshot: client.name,
        modelId: '', modelNameSnapshot: 'Producto', poseImageId: scene.type,
        poseImagePath: images[0].storagePath!, poseFileName: images[0].fileName,
        garmentId: itemId, garmentName: images[0].fileName, garmentFilePath: (images[1] || images[0]).storagePath!,
        garmentIsMultiAngle: images.length > 1, finalPrompt: prompt,
        provider, aspectRatio: imageConfig.aspectRatio, imageConfig: imageConfig.imageConfig,
        maxRetries: system.jobMaxRetries, completedAt: null, currentOutputId: null, currentOutput: null,
        completedOutputCount: 0, totalCostUsd: 0, totalDurationSeconds: 0, manualRegenerationCount: 0,
        createdAt: now, updatedAt: now, createdByUid: job.createdByUid,
      } });
    }
  }
  if (!jobs.length || jobs.length > system.batchMaxJobs) throw new HttpsError('out-of-range', 'El preset excede el límite de jobs del sistema.');
  const batch: Omit<Batch, 'id'> = {
    automationJobId: job.id, generationKind: 'product', clientId: job.clientId, clientNameSnapshot: client.name,
    modelId: '', modelNameSnapshot: 'Producto', outputMode: 'photos_only',
    provider, aspectRatio: imageConfig.aspectRatio, imageConfig: imageConfig.imageConfig,
    promptBase: PRODUCT_IDENTITY_RULES, poseIds: [], garmentCount: groupedImages(job.inputImages).size,
    totalJobs: jobs.length, pendingJobs: jobs.length, processingJobs: 0, completedJobs: 0, failedJobs: 0,
    status: 'pending', latestJobCreatedAt: now, createdAt: now, updatedAt: now, createdByUid: job.createdByUid,
  };
  await db.runTransaction(async (tx) => {
    const ref = db.collection('automationJobs').doc(job.id);
    const snap = await tx.get(ref);
    const current = snap.data() as AutomationJob;
    if (current.batchId) return;
    if (current.leaseToken !== job.leaseToken || current.status !== 'importing') throw new HttpsError('aborted', 'Reserva expirada.');
    tx.create(batchRef, batch);
    for (const generated of jobs) tx.create(db.collection('jobs').doc(generated.id), generated.data);
    tx.update(ref, {
      batchId: batchRef.id, generationJobIds: jobs.map((generated) => generated.id),
      status: 'processing', leaseToken: null, leaseExpiresAt: null, error: null, updatedAt: now,
      progress: { total: jobs.length, completed: 0, failed: 0 },
    });
    tx.update(db.collection('clients').doc(job.clientId), { batchCount: FieldValue.increment(1), lastBatchCreatedAt: now, updatedAt: now });
  });
};
