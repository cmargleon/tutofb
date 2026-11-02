import { createHash } from 'node:crypto';
import { AutomationInput, AutomationItemState, AutomationJob, AutomationPreset, Client, Model, UploadedGarmentInput } from '../../../shared/src/types';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { createGenerationBatchCore } from '../callables/createGenerationBatch';
import { getCompatibleGarmentPoseCombinations } from '../callables/createGenerationBatch.helpers';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { GEMINI_API_KEY, getGeminiGarmentViewClassificationModel } from '../config/runtime';
import { PRODUCT_PRESETS } from './presets';
import { createProductGenerationBatchCore } from '../callables/createProductGenerationBatch';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';
import { getSystemConfigCached } from '../admin/systemConfig';
import { createDefaultProductGeneration } from '../../../shared/src/productGeneration';
import { AutomationBudgetError } from './budget';

const groupedImages = (inputs: AutomationInput[]) => {
  const groups = new Map<string, AutomationInput[]>();
  for (const image of inputs) groups.set(image.itemId, [...(groups.get(image.itemId) || []), image]);
  return groups;
};
export const dispatchGarment = async (job: AutomationJob, client: Client, config: AutomationPreset, modelId: string): Promise<void> => {
  const snapshot = await getAppFirestore().collection('models').doc(modelId).get();
  const model = snapshot.data() as Model | undefined;
  if (!model || model.status === 'archived' || model.clientId !== job.clientId) throw new AutomationAttentionError('El modelo no está disponible para este cliente.');
  const poseIds = config.poseIds || model.poses.map((pose) => pose.id);
  if (poseIds.some((id) => !model.poses.some((pose) => pose.id === id))) throw new AutomationAttentionError('Hay poses no disponibles en el modelo/preset.');
  const selectedPoses = model.poses.filter((pose) => poseIds.includes(pose.id));
  const garments: UploadedGarmentInput[] = [];
  const items: AutomationItemState[] = [];
  const ref = getAppFirestore().collection('automationJobs').doc(job.id);
  const persistItems = async (finished = false) => getAppFirestore().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.leaseToken !== job.leaseToken || current?.status !== 'importing' || current?.batchId) throw new HttpsError('aborted', 'La importación ya no tiene una reserva activa.');
    tx.update(ref, { items, updatedAt: FieldValue.serverTimestamp(), ...(finished ? {
      status: 'needs_attention', error: { code: 'item-preparation-failed', message: 'Ningún artículo pudo prepararse. Revisa las incidencias de cada artículo.' },
      failedAt: FieldValue.serverTimestamp(), leaseToken: null, leaseExpiresAt: null,
    } : {}) });
  });
  await persistItems();
  for (const [itemId, images] of groupedImages(job.inputImages)) {
    const cacheKey = createHash('sha256').update(JSON.stringify([itemId, images.map((i) => [i.storagePath, i.normalizedSha256 || null])])).digest('hex');
    const cached = job.classificationCache?.[cacheKey];
    let garment = cached;
    if (!garment) {
      let classified: Awaited<ReturnType<typeof classifyGarmentWithGemini>>;
      try {
        classified = job.analysisCache?.[cacheKey] || await classifyGarmentWithGemini({
          ...(job.effectivePolicy ? { automation: { id: job.id, key: `classification:${cacheKey}:${job.retryCount}`, kind: 'classification' as const }, clientId: job.clientId } : {}),
          apiKey: GEMINI_API_KEY.value(), model: getGeminiGarmentViewClassificationModel(), userUid: job.createdByUid,
          categories: [], fallbackCategoryId: null,
          garment: { garmentId: itemId, garmentName: images[0].fileName, photos: images.map((image, index) => ({
            id: `${itemId}-${index}`, fileName: image.fileName, storagePath: image.storagePath!, sourceIndex: index,
          })) },
        });
      } catch (error) {
        // Budget and authorization failures still stop the entire intake before further paid calls.
        if (error instanceof AutomationBudgetError || (error instanceof HttpsError && ['permission-denied', 'unauthenticated', 'failed-precondition', 'aborted'].includes(error.code))) throw error;
        items.push({ itemId, status: 'needs_attention', scenes: [], issue: { code: 'classification-failed', message: `No se pudo clasificar ${images[0].fileName}. Revisa sus fotografías antes de volver a procesar este artículo.` } });
        await persistItems();
        continue;
      }
      if (!job.analysisCache?.[cacheKey]) await getAppFirestore().collection('automationJobs').doc(job.id).update({ [`analysisCache.${cacheKey}`]: classified });
      if (classified.itemKind !== 'garment' || (classified.itemKindConfidence ?? 0) < 0.65 || !classified.garmentBodyArea || classified.photos.some((photo) => (photo.confidence ?? 0) < 0.65)) {
        items.push({ itemId, status: 'needs_attention', scenes: [], issue: { code: 'classification-required', message: `La clasificación de ${images[0].fileName} necesita revisión. Revisa el tipo de artículo y sus vistas.` } });
        await persistItems();
        continue;
      }
      garment = {
        id: itemId, name: images[0].fileName, storagePath: images[0].storagePath!, isMultiAngle: images.length > 1,
        sourceType: 'single', originalFileNames: images.map((image) => image.fileName),
        photos: classified.photos, garmentBodyArea: classified.garmentBodyArea, garmentAccessoryType: classified.garmentAccessoryType,
      };
      await getAppFirestore().collection('automationJobs').doc(job.id).update({ [`classificationCache.${cacheKey}`]: garment });
    }
    if (!getCompatibleGarmentPoseCombinations([garment], selectedPoses).length) {
      items.push({ itemId, status: 'needs_attention', scenes: [], issue: { code: 'no-compatible-poses', message: `No hay poses compatibles con las vistas de ${images[0].fileName}. Revisa el modelo/preset de este artículo.` } });
      await persistItems();
      continue;
    }
    garments.push(garment);
  }
  if (!garments.length) { await persistItems(true); return; }
  await createGenerationBatchCore({
    clientId: job.clientId, modelId, poseIds,
    provider: config.provider || DEFAULT_AUTOMATION_PROVIDER, aspectRatio: config.aspectRatio || '3:4', ...(config.imageConfig ? { imageConfig: config.imageConfig } : {}),
    outputMode: 'photos_only', garments, productDrafts: [], promptBase: config.prompt ?? client.generationPromptBase ?? '',
  }, job.createdByUid, { id: job.id, leaseToken: job.leaseToken! });
};

export const dispatchProduct = async (job: AutomationJob, _client: Client, config: AutomationPreset): Promise<void> => {
  const preset = PRODUCT_PRESETS.generic_product;
  const defaults = createDefaultProductGeneration(await getSystemConfigCached());
  await createProductGenerationBatchCore({
    requestId: job.id, clientId: job.clientId,
    provider: config.provider || DEFAULT_AUTOMATION_PROVIDER, aspectRatio: config.aspectRatio || preset.aspectRatio,
    ...(config.imageConfig ? { imageConfig: config.imageConfig } : {}),
    prompt: config.prompt ?? defaults.prompt, scenes: config.scenes || defaults.scenes,
    items: [...groupedImages(job.inputImages)].map(([id, images]) => ({
      id, name: images[0].fileName, referencePaths: images.map((image) => image.storagePath!),
    })),
  }, job.createdByUid, { id: job.id, leaseToken: job.leaseToken! });
};
