import { createHash } from 'node:crypto';
import { AutomationInput, AutomationItemState, AutomationJob, AutomationModelOption, AutomationPreset, Client, Model, UploadedGarmentInput } from '../../../shared/src/types';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { getAppFirestore } from '../firebase/appFirestore';
import { createGenerationBatchesCore } from '../callables/createGenerationBatch';
import { selectAutomationModel } from './models';
import { getCompatibleGarmentPoseCombinations } from '../callables/createGenerationBatch.helpers';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { GEMINI_API_KEY, getGeminiGarmentViewClassificationModel } from '../config/runtime';
import { PRODUCT_PRESETS, resolveAutomationPoseIds } from './presets';
import { createProductGenerationBatchCore } from '../callables/createProductGenerationBatch';
import { AutomationAttentionError } from './imports';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';
import { getSystemConfigCached } from '../admin/systemConfig';
import { createDefaultProductGeneration } from '../../../shared/src/productGeneration';
import { AutomationBudgetError } from './budget';
import { APPROVED_TRY_ON_PROMPT_FORMAT, composeApprovedTryOnPrompt, seedTryOnPrompt } from '../../../shared/src/approvedTryOnPrompt';
import { DEFAULT_TRY_ON_PROMPT } from '../../../shared/src/domain';

const groupedImages = (inputs: AutomationInput[]) => {
  const groups = new Map<string, AutomationInput[]>();
  for (const image of inputs) groups.set(image.itemId, [...(groups.get(image.itemId) || []), image]);
  return groups;
};
export const dispatchGarment = async (job: AutomationJob, client: Client, config: AutomationPreset, options: AutomationModelOption[]): Promise<void> => {
  const snapshots = await getAppFirestore().getAll(...options.map(option => getAppFirestore().collection('models').doc(option.modelId)));
  const available = options.flatMap((option, index) => {
    const model = snapshots[index].data() as Model | undefined;
    if (!model || model.status === 'archived' || model.active === false || model.clientId !== job.clientId) {
      if (option.gender) return [];
      throw new AutomationAttentionError('El modelo no está disponible para este cliente.');
    }
    return [{ ...option, poseIds: resolveAutomationPoseIds(model, option.poseIds), model }];
  });
  if (!available.length) throw new AutomationAttentionError('No hay modelos predeterminados disponibles para este cliente.');
  const groups = new Map<string, { option: typeof available[number]; garments: UploadedGarmentInput[] }>();
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
    let garment = job.classificationCache?.[cacheKey];
    let analysis = job.analysisCache?.[cacheKey];
    const needsGenderAnalysis = new Set(available.map(option => option.modelId)).size > 1 && !Object.hasOwn(analysis || {}, 'garmentGender');
    if (!garment || needsGenderAnalysis) {
      let classified: Awaited<ReturnType<typeof classifyGarmentWithGemini>>;
      try {
        classified = (!needsGenderAnalysis && analysis) || await classifyGarmentWithGemini({
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
      analysis = classified;
      if (needsGenderAnalysis || !job.analysisCache?.[cacheKey]) await getAppFirestore().collection('automationJobs').doc(job.id).update({ [`analysisCache.${cacheKey}`]: classified });
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
    const detection = {
      garmentGender: analysis?.garmentGender || null,
      garmentGenderConfidence: analysis?.garmentGenderConfidence ?? null,
      garmentGenderReasoning: analysis?.garmentGenderReasoning || null,
    };
    const selection = selectAutomationModel(available, detection.garmentGender, detection.garmentGenderConfidence, `${job.id}:${itemId}`);
    if (!selection) {
      items.push({ itemId, ...detection, status: 'needs_attention', scenes: [], issue: {
        code: 'garment-gender-required', message: `No se pudo determinar si ${images[0].fileName} es masculino, femenino o unisex. Revisa sus referencias o selecciona un modelo explícito.`,
      } });
      await persistItems();
      continue;
    }
    const option = available.find(option => option.modelId === selection.modelId)!;
    const selectedPoses = option.model.poses.filter(pose => option.poseIds.includes(pose.id));
    if (!getCompatibleGarmentPoseCombinations([garment], selectedPoses).length) {
      items.push({ itemId, ...detection, modelId: option.modelId, status: 'needs_attention', scenes: [], issue: { code: 'no-compatible-poses', message: `No hay poses compatibles con las vistas de ${images[0].fileName}. Revisa el modelo/preset de este artículo.` } });
      await persistItems();
      continue;
    }
    const group = groups.get(option.modelId) || { option, garments: [] };
    group.garments.push(garment);
    groups.set(option.modelId, group);
    items.push({ itemId, ...detection, modelId: option.modelId, status: 'processing', scenes: [] });
  }
  if (!groups.size) { await persistItems(true); return; }
  await persistItems();
  const systemConfig = await getSystemConfigCached();
  const prompt = config.prompt?.trim() || client.generationPromptBase?.trim() || systemConfig.systemPromptOverride || DEFAULT_TRY_ON_PROMPT;
  await createGenerationBatchesCore([...groups.values()].map(({ option, garments }) => {
    const seeded = seedTryOnPrompt(prompt, option.model.identityTraits, systemConfig);
    return {
      clientId: job.clientId, modelId: option.modelId, poseIds: option.poseIds,
      provider: config.provider || DEFAULT_AUTOMATION_PROVIDER, aspectRatio: config.aspectRatio || '3:4', ...(config.imageConfig ? { imageConfig: config.imageConfig } : {}),
      outputMode: 'photos_only', garments, productDrafts: [], promptBase: seeded.general,
      promptFormat: APPROVED_TRY_ON_PROMPT_FORMAT,
      approvedPrompts: garments.map(garment => ({ garmentId: garment.id,
        text: composeApprovedTryOnPrompt(seeded.general, seeded.blocks, garment.garmentBodyArea),
      })),
    };
  }), job.createdByUid, { id: job.id, leaseToken: job.leaseToken! });

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
