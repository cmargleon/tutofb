import { automationPolling } from './polling';
import type { AutomationJob, AutomationPlanSummary } from '../../../shared/src/types';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationPlan, Client, CreateAutomationJobRequest, Model } from '../../../shared/src/types';
import { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy, usd } from '../../../shared/src/automationPolicy';
import { createDefaultProductGeneration } from '../../../shared/src/productGeneration';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertProviderEnabledInSystemConfig, sanitizeSystemConfig } from '../admin/systemConfig';
import { canReadAutomation, validateAutomationInput } from './domain';
import { resolveAutomationPreset } from './presets';
import { DEFAULT_AUTOMATION_PROVIDER } from './provider';
import { authorizeDriveFile, googleDrive, validateDriveFolder } from './drive';
import { estimateGenerationHold, GEMINI_OPERATION_HOLD_USD } from './budget';
import { createAutomation } from './persistence';
import { authorizeMachineJob } from './machineAuth';

export const prepareAutomationPlan = async (input: unknown, uid: string, role: string): Promise<AutomationPlan> => {
  const data = validateAutomationInput(input, uid);
  if (role === 'automation') await authorizeMachineJob(uid, data.clientId, data.jobType);
  if (!data.inputImages?.length) throw new HttpsError('failed-precondition', 'Proporciona itemId y archivos explícitos. Una carpeta sola no permite asociar fotos a artículos.');
  const db = getAppFirestore();
  const ref = db.collection('automationPlans').doc(createHash('sha256').update(`${uid}:${data.clientId}:${data.externalId}`).digest('hex'));
  const existing = await ref.get();
  if (existing.exists) return existing.data() as AutomationPlan;
  const [clientSnapshot, systemSnapshot] = await Promise.all([db.collection('clients').doc(data.clientId).get(), db.collection('system_config').doc('main').get()]);
  const client = clientSnapshot.data() as Client | undefined;
  if (!client || client.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const system = sanitizeSystemConfig(systemSnapshot.data());
  let policy;
  try { policy = resolveAutomationPolicy(system.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, client.automation, data); }
  catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
  const resolved = resolveAutomationPreset(data, client);
  const defaults = createDefaultProductGeneration(system);
  const provider = resolved.config.provider || DEFAULT_AUTOMATION_PROVIDER;
  assertProviderEnabledInSystemConfig(provider, system);
  const normalized = normalizeProviderImageConfig(provider, resolved.config.imageConfig, resolved.config.aspectRatio || '3:4');
  const preset = { ...resolved.config, provider, imageConfig: normalized.imageConfig, aspectRatio: normalized.aspectRatio,
    prompt: resolved.config.prompt ?? (data.jobType === 'product' ? defaults.prompt : client.generationPromptBase || ''),
    ...(data.jobType === 'product' ? { scenes: resolved.config.scenes || defaults.scenes } : {}),
  };
  let sceneIds: string[];
  if (data.jobType === 'garment') {
    const model = (await db.collection('models').doc(resolved.modelId!).get()).data() as Model | undefined;
    if (!model || model.clientId !== data.clientId || model.status === 'archived') throw new HttpsError('failed-precondition', 'Modelo no disponible para el cliente.');
    sceneIds = preset.poseIds || model.poses.map((pose) => pose.id);
    if (!sceneIds.length || sceneIds.some((id) => !model.poses.some((pose) => pose.id === id))) throw new HttpsError('failed-precondition', 'Poses no disponibles.');
    preset.poseIds = sceneIds;
  } else sceneIds = preset.scenes!.map((scene) => scene.type);
  const inputs: NonNullable<CreateAutomationJobRequest['inputImages']> = [];
  for (const image of data.inputImages) {
    if (image.driveFile) {
      const file = await authorizeDriveFile(data.clientId, image);
      inputs.push({ ...image, driveFile: { ...image.driveFile,
        ...(image.driveFile.revisionId || file.headRevisionId ? { revisionId: image.driveFile.revisionId || file.headRevisionId } : {}),
        ...(file.version ? { version: file.version } : {}),
      } });
    } else inputs.push(image);
  }
  const itemIds = [...new Set(inputs.map((image) => image.itemId))];
  if (itemIds.length * sceneIds.length > system.batchMaxJobs) throw new HttpsError('invalid-argument', 'El plan excede el límite de jobs por lote.');
  const items = itemIds.map((itemId) => {
    const count = inputs.filter((image) => image.itemId === itemId).length;
    const generation = estimateGenerationHold(provider, normalized.imageConfig, data.jobType === 'product' ? count : 2);
    return { itemId, imageCount: count, sceneIds,
      estimatedCostUsd: usd(sceneIds.length * (generation.holdUsd + GEMINI_OPERATION_HOLD_USD) * (policy.maxReviewAttempts + policy.maxOperationalRetries) + (data.jobType === 'garment' ? GEMINI_OPERATION_HOLD_USD * (policy.maxOperationalRetries + 1) : 0)) };
  });
  const plan: AutomationPlan = { id: ref.id, createdByUid: uid, clientId: data.clientId, clientName: client.name,
    request: { ...data, inputImages: inputs, modelId: resolved.modelId || undefined, preset: resolved.name },
    presetName: resolved.name, preset, policy, modelId: resolved.modelId, items, classificationRequired: data.jobType === 'garment',
    estimatedCostUsd: usd(items.reduce((sum, item) => sum + item.estimatedCostUsd, 0)),
    costGuarantee: 'estimated_authorization_required', createdAt: FieldValue.serverTimestamp(), executedJobId: null };
  if (!plan.modelId) delete plan.request.modelId;
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.exists) return current.data() as AutomationPlan;
    tx.create(ref, plan); return plan;
  });
};
export const readAutomationPlan = async (id: string, uid: string, role: string): Promise<AutomationPlan> => {
  const plan = (await getAppFirestore().collection('automationPlans').doc(id).get()).data() as AutomationPlan | undefined;
  if (!plan || !canReadAutomation(plan, uid, role)) throw new HttpsError('not-found', 'Plan no encontrado.');
  if (role === 'automation') await authorizeMachineJob(uid, plan.clientId, plan.request.jobType);
  return plan;
};
export const publicAutomationPlan = (plan: AutomationPlan): AutomationPlanSummary => ({ planId: plan.id, clientId: plan.clientId, clientName: plan.clientName,
  jobType: plan.request.jobType, modelId: plan.modelId, provider: plan.preset.provider, preset: plan.presetName,
  imageConfig: plan.preset.imageConfig, items: plan.items, imageCount: plan.items.reduce((count, item) => count + item.sceneIds.length, 0),
  policy: plan.policy, estimatedCostUsd: plan.estimatedCostUsd, classificationRequired: plan.classificationRequired,
  costGuarantee: plan.costGuarantee, executedJobId: plan.executedJobId,
});
export const executeAutomationPlan = async (id: string, uid: string, role: string) => {
  const plan = await readAutomationPlan(id, uid, role);
  if (plan.executedJobId) {
    const job = (await getAppFirestore().collection('automationJobs').doc(plan.executedJobId).get()).data() as AutomationJob;
    return { jobId: plan.executedJobId, status: job.status, duplicate: true, ...automationPolling(job) };
  }
  if (!plan.policy.allowEstimatedCosts || (plan.classificationRequired && !plan.policy.authorizeClassification)) throw new HttpsError('failed-precondition', 'Prepara el plan con allowEstimatedCosts y, para prendas, authorizeClassification explícitos antes de ejecutarlo.');
  // Check file versions and current folder authorization before any paid processing.
  for (const image of plan.request.inputImages || []) if (image.driveFile) await authorizeDriveFile(plan.clientId, image);
  const receipt = await createAutomation({ ...plan.request, modelId: plan.modelId || undefined }, uid, role, plan);
  const job = (await getAppFirestore().collection('automationJobs').doc(receipt.jobId).get()).data() as AutomationJob;
  return { ...receipt, ...automationPolling(job) };
};
export const listAuthorizedDriveFiles = async (clientId: string, folderId: string) => {
  const client = (await getAppFirestore().collection('clients').doc(clientId).get()).data() as Client | undefined;
  if (!client || client.status === 'archived' || client.automation?.enabled === false || !client.automation?.driveFolderIds?.includes(folderId)) throw new HttpsError('permission-denied', 'Carpeta no autorizada.');
  await validateDriveFolder(folderId);
  return { clientId, folderId, files: (await googleDrive.list(folderId)).filter((f) => f.mimeType.startsWith('image/')).map((f) => ({ fileId: f.id, fileName: f.name, version: f.version || null, revisionId: f.headRevisionId || null })), requiresExplicitItemMapping: true };
};
