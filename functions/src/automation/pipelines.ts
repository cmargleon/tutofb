import { AutomationInput, AutomationJob, AutomationPreset, Client, Model, UploadedGarmentInput } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { createGenerationBatchCore } from '../callables/createGenerationBatch';
import { getCompatibleGarmentPoseCombinations } from '../callables/createGenerationBatch.helpers';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { GEMINI_API_KEY, getGeminiGarmentViewClassificationModel } from '../config/runtime';
import { PRODUCT_PRESETS } from './presets';
import { createProductGenerationBatchCore } from '../callables/createProductGenerationBatch';
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

export const dispatchProduct = async (job: AutomationJob, _client: Client, config: AutomationPreset): Promise<void> => {
  const preset = PRODUCT_PRESETS.generic_product;
  await createProductGenerationBatchCore({
    requestId: job.id, clientId: job.clientId,
    provider: config.provider || DEFAULT_AUTOMATION_PROVIDER, aspectRatio: config.aspectRatio || preset.aspectRatio,
    prompt: '', scenes: preset.scenes.map(({ type, prompt }) => ({ type, prompt })),
    items: [...groupedImages(job.inputImages)].map(([id, images]) => ({
      id, name: images[0].fileName, referencePaths: images.map((image) => image.storagePath!),
    })),
  }, job.createdByUid, { id: job.id, leaseToken: job.leaseToken! });
};
