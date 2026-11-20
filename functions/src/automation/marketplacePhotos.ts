import { getModelMarketplaceRules } from '../models/marketplaceRules';
import { currentModelPhotoBases } from '../models/marketplaceSets';
import { marketplaceDressingCustomization } from '../../../shared/src/modelPhotoSets';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, Client, AutomationPreset, PhotoArticle, AutomationItemState, Model } from '../../../shared/src/types';
import { buildMarketplacePhotoPlan } from '../../../shared/src/marketplacePhotoPlan';
import { normalizePhotoAttributes, mergePhotoAttributes } from '../../../shared/src/photoAttributes';
import { resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { createDefaultProductGeneration } from '../../../shared/src/productGeneration';
import { createMarketplacePhotoBatchCore } from '../callables/createMarketplacePhotoBatch';
import { classifyGarmentWithGemini } from '../callables/classifyGarmentViewsWithGemini';
import { getAppFirestore } from '../firebase/appFirestore';
import { GEMINI_API_KEY, getGeminiGarmentViewClassificationModel } from '../config/runtime';
import { getSystemConfigCached } from '../admin/systemConfig';
import { AutomationBudgetError } from './budget';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';
import { DEFAULT_AUTOMATION_RULES } from '../../../shared/src/automationConfig';
import { organizerCategory } from './organizerCategory';
import { organizerReferenceViews } from '../organizer/commerce';
import { loadAutomationModelOptions, selectAutomationModel } from './models';

export async function dispatchMarketplacePhotos(job: AutomationJob, _client: Client, config: AutomationPreset) {
  const classificationMinConfidence = job.effectiveRules?.classificationMinConfidence ?? DEFAULT_AUTOMATION_RULES.classificationMinConfidence;
  if (job.jobType !== 'garment') throw new HttpsError('failed-precondition', 'Los objetos utilizan el recorrido de escenas existente.');
  const db = getAppFirestore(); const ref = db.doc(`automationJobs/${job.id}`);
  const provider = config.provider || DEFAULT_AUTOMATION_PROVIDER;
  const normalized = resolveCommercialPhotoConfig(provider, config.imageConfig, config.aspectRatio || '3:4');
  const grouped = new Map<string, typeof job.inputImages>();
  job.inputImages.forEach(i => grouped.set(i.itemId, [...(grouped.get(i.itemId) || []), i]));
  const articles: PhotoArticle[] = []; const items: AutomationItemState[] = [];
  const genders = new Map<string, { gender: Awaited<ReturnType<typeof classifyGarmentWithGemini>>['garmentGender']; confidence: number | null | undefined }>();
  const patch = async (extra: Record<string, unknown> = {}) => db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.leaseToken !== job.leaseToken || current.status !== 'importing' || current.batchId) throw new HttpsError('aborted', 'Reserva de importación no disponible.');
    tx.update(ref, { items, ...extra, updatedAt: FieldValue.serverTimestamp() });
  });
  for (const [itemId, images] of grouped) {
    const classificationKey = createHash('sha256').update(JSON.stringify([itemId, images.map(i => [i.storagePath, i.normalizedSha256])])).digest('hex');
    const commerce = await organizerCategory(job, _client, itemId);
    const key = commerce?.hasCandidates ? commerce.key(classificationKey) : classificationKey;
    try {
      const input: Parameters<typeof classifyGarmentWithGemini>[0] = {
        automation: { id: job.id, key: `classification:${key}:${job.retryCount}`, kind: 'classification' }, clientId: job.clientId,
        apiKey: GEMINI_API_KEY.value(), model: getGeminiGarmentViewClassificationModel(), userUid: job.createdByUid, categories: [], fallbackCategoryId: null,
        garment: { garmentId: itemId, garmentName: images[0].fileName, photos: images.map((image, index) => ({ id: `${itemId}-${index}`, fileName: image.fileName, storagePath: image.storagePath!, sourceIndex: index })) },
      };
      const analysis = job.analysisCache?.[key] || await (commerce?.classify(input, classificationKey) ?? classifyGarmentWithGemini(input));
      await patch({ [`analysisCache.${key}`]: analysis });
      genders.set(itemId, { gender: analysis.garmentGender, confidence: analysis.garmentGenderConfidence });
      if (analysis.itemKind !== job.jobType || (analysis.itemKindConfidence ?? 0) < classificationMinConfidence) throw new Error('Confirma el tipo de artículo.');
      const explicit = (job.metadata?.photoArticles as Record<string, any> | undefined)?.[itemId];
      const referenceViews = { ...await organizerReferenceViews(job, itemId), ...explicit?.referenceViews };
      if (analysis.photos.some(p => !['front', 'back', 'side', 'detail'].includes(referenceViews[p.fileName]) && (p.confidence ?? 0) < classificationMinConfidence)) throw new Error('Confirma las vistas de referencia; la clasificación visual no es suficientemente cierta.');
      articles.push({ itemId, productId: typeof explicit?.productId === 'string' ? explicit.productId : itemId, variantId: typeof explicit?.variantId === 'string' ? explicit.variantId : itemId,
        name: images[0].fileName, kind: job.jobType, attributes: mergePhotoAttributes(analysis.photoAttributes, normalizePhotoAttributes(explicit?.attributes, true)),
        references: analysis.photos.map(p => ({ id: p.id, storagePath: p.storagePath, view: ['front', 'back', 'side', 'detail'].includes(referenceViews[p.fileName]) ? referenceViews[p.fileName] : p.isDetail ? 'detail' : p.view, ...(images.find(i => i.storagePath === p.storagePath)?.normalizedSha256 ? { sha256: images.find(i => i.storagePath === p.storagePath)!.normalizedSha256 } : {}) })) });
    } catch (error) {
      if (error instanceof AutomationBudgetError || error instanceof HttpsError && ['aborted', 'permission-denied', 'failed-precondition'].includes(error.code)) throw error;
      items.push({ itemId, status: 'needs_attention', scenes: [], issue: { code: 'classification-required', message: error instanceof Error ? error.message : 'Clasificación pendiente' } });
    }
  }
  // An explicit/preset model dresses every article; otherwise each article gets the client's model for its garment
  // gender (defaultMaleModelId/defaultFemaleModelId, or defaultModelId when no gender defaults exist).
  const explicitModelId = job.photoModelId || job.modelId || config.modelId || null;
  const options = explicitModelId || !articles.length ? null : await loadAutomationModelOptions(job.clientId, _client, null, config.poseIds);
  for (const article of [...articles]) {
    if (!options) continue;
    const gender = genders.get(article.itemId);
    const option = selectAutomationModel(options, gender?.gender, gender?.confidence, `${job.id}:${article.itemId}`, job.effectiveRules?.garmentGenderMinConfidence);
    if (option) { article.modelId = option.modelId; continue; }
    articles.splice(articles.indexOf(article), 1);
    items.push({ itemId: article.itemId, status: 'needs_attention', scenes: [], issue: { code: 'model-required',
      message: `Confirma el género de la prenda (${gender?.gender || 'desconocido'}) para elegir el modelo masculino o femenino del cliente.` } });
  }
  const modelIds = explicitModelId ? [explicitModelId] : [...new Set(articles.map(a => a.modelId!).filter(Boolean))];
  const bases: Awaited<ReturnType<typeof currentModelPhotoBases>> = [];
  for (const modelId of modelIds) {
    const model = (await db.doc(`models/${modelId}`).get()).data() as Model | undefined;
    if (!model || model.clientId !== job.clientId || model.active === false || model.status === 'archived') throw new HttpsError('failed-precondition', 'Modelo explícito/preset no disponible.');
    bases.push(...await currentModelPhotoBases({ ...model, id: modelId }, config.poseIds));
  }
  const selectedModelId = modelIds.length === 1 ? modelIds[0] : null;
  const defaults = createDefaultProductGeneration(await getSystemConfigCached());
  const plan = buildMarketplacePhotoPlan({
    modelMarketplaceRules: await getModelMarketplaceRules(),
    clientId: job.clientId, marketplaces: job.photoMarketplaces, customPrompt: marketplaceDressingCustomization(config.prompt), articles, bases, provider, ...normalized, objectScenes: config.scenes || defaults.scenes,
  });
  if (plan.issues.some(i => !i.itemId && i.blocking)) { plan.tasks = []; }
  for (const article of articles) {
    const blocking = plan.issues.filter(i => (!i.itemId || i.itemId === article.itemId) && i.blocking);
    items.push({ itemId: article.itemId, status: blocking.length ? 'needs_attention' : 'processing', scenes: [], ...(blocking.length ? { issue: { code: 'photo-plan-required', message: blocking.map(i => i.message).join(' ') } } : {}) });
  }
  await patch({ photoPlan: plan, ...(!plan.tasks.length ? { status: 'needs_attention', error: { code: 'photo-plan-required', message: 'Revisa las incidencias por artículo; referencias conservadas.' }, leaseToken: null, leaseExpiresAt: null } : {}) });
  if (!plan.tasks.length) return;
  await createMarketplacePhotoBatchCore({ clientId: job.clientId, marketplaces: job.photoMarketplaces, articles: plan.articles, provider, ...normalized,
    modelId: selectedModelId, requestId: job.id, approvedPlanId: plan.id, prompt: marketplaceDressingCustomization(config.prompt),
  }, job.createdByUid, { id: job.id, leaseToken: job.leaseToken!, plan });
}
