import { activePhotoChannels } from '../../../shared/src/marketplacePhotoPlan';
import { COMMERCIAL_PHOTO_PROFILE } from '../../../shared/src/commercialPhoto';
import { resolveAutomationPreset } from './presets';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getManglarContext } from '../manglar/context';
import { delegatedStamp } from '../manglar/access';
import { createHash } from 'node:crypto';
import { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy } from '../../../shared/src/automationPolicy';
import { DEFAULT_AUTOMATION_RULES, resolveAutomationRules } from '../../../shared/src/automationConfig';
import { sanitizeSystemConfig } from '../admin/systemConfig';
import type { AutomationPlan, Client } from '../../../shared/src/types';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { AutomationJob, AutomationJobReceipt, RetryAutomationJobRequest } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { authorizeMachineJob } from './machineAuth';
import { automationKeys, canReadAutomation, MAX_INTAKE_ATTEMPTS, validateAutomationInput } from './domain';

// Upload ownership is claimed on first automated use, independently of the caller's multi-client access.
// Reuse the private idempotency namespace; bindings never expose Storage paths or credentials.
const readUploadBindings = async (tx: FirebaseFirestore.Transaction, data: import('../../../shared/src/types').CreateAutomationJobRequest) => {
  const refs = [...new Set((data.inputImages || []).flatMap((image) => image.storagePath ? [image.storagePath] : []))]
    .map((path) => getAppFirestore().collection('automationKeys').doc(createHash('sha256').update(`upload-client:${path}`).digest('hex')));
  if (!refs.length) return [];
  const snapshots = await tx.getAll(...refs);
  if (snapshots.some((snapshot) => snapshot.exists && snapshot.data()?.inputClientId !== data.clientId)) throw new HttpsError('permission-denied', 'Una fotografía subida ya está asociada a otro cliente. Sube una referencia propia de este cliente.');
  return snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.ref);
};

export const createAutomation = async (input: unknown, uid: string, role: string, plan?: AutomationPlan): Promise<AutomationJobReceipt> => {
  const data = validateAutomationInput(input, uid);
  if (role !== 'automation') await assertHumanClientAccess(uid, data.clientId);
  if (role === 'automation') await authorizeMachineJob(uid, data.clientId, data.jobType);
  const db = getAppFirestore();
  const keys = automationKeys(data).map((key) => db.collection('automationKeys').doc(key));
  const ref = db.collection('automationJobs').doc();
  const receipt = await db.runTransaction(async (tx) => {
    const keyDocs = await tx.getAll(...keys);
    const jobIds = [...new Set(keyDocs.filter((doc) => doc.exists).map((doc) => doc.data()!.jobId as string))];
    if (jobIds.length > 1) throw new HttpsError('already-exists', 'Los identificadores corresponden a trabajos diferentes.');
    if (jobIds.length) {
      const existing = await tx.get(db.collection('automationJobs').doc(jobIds[0]));
      const job = existing.data() as AutomationJob | undefined;
      if (!job || !canReadAutomation(job, uid, role) || (job.clientId !== data.clientId || job.jobType !== data.jobType)) throw new HttpsError('permission-denied', 'Identificador no disponible.');
      if (plan) tx.update(db.collection('automationPlans').doc(plan.id), { executedJobId: existing.id });
      keys.forEach((key) => tx.set(key, { jobId: existing.id }));
      return { jobId: existing.id, status: job.status, duplicate: true };
    }
    const client = await tx.get(db.collection('clients').doc(data.clientId));
    if (!client.exists || client.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const system = await tx.get(db.collection('system_config').doc('main'));
    let policy;
    try { policy = resolveAutomationPolicy(system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, (client.data() as Client).automation, plan ? { ...data, ...plan.policy } : data); }
    catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
    const uploadBindings = await readUploadBindings(tx, data);
    const now = FieldValue.serverTimestamp();
    const resolved = plan ? null : resolveAutomationPreset(data, client.data() as Client);
    const photoModelId = data.jobType !== 'garment' ? null : plan ? plan.photoModelId || null : resolved?.modelId || null;
    const photoModel = !plan && photoModelId && activePhotoChannels((client.data() as Client).marketplaces).length
      ? (await tx.get(db.doc(`models/${photoModelId}`))).data() as import('../../../shared/src/types').Model | undefined : undefined;
    if (photoModel && (photoModel.clientId !== data.clientId || photoModel.active === false || photoModel.status === 'archived')) throw new HttpsError('failed-precondition', 'Modelo no disponible.');
    const photoBases = plan?.photoBases ?? (photoModel?.poses || []).filter(p => p.active !== false && (!resolved?.config.poseIds || resolved.config.poseIds.includes(p.id))).map(p => ({ id: p.id, storagePath: p.storagePath, ...(p.photoObservation ? { observation: p.photoObservation } : {}) }));
    const job: AutomationJob = {
      ...(plan ? (plan.photoProfile ? { photoProfile: plan.photoProfile } : {}) : { photoProfile: COMMERCIAL_PHOTO_PROFILE, resolvedPreset: resolved!.config }),
      ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}),
      ...(data.jobType === 'garment' && (plan?.photoMarketplaces !== undefined || !plan) ? { photoBases, photoModelId } : {}),
      ...(data.jobType !== 'garment' ? {} : plan?.photoMarketplaces !== undefined ? { photoMarketplaces: plan.photoMarketplaces } : !plan ? { photoMarketplaces: (client.data() as Client).marketplaces || {} } : {}),
      ...data, clientNameSnapshot: client.data()!.name, effectivePolicy: policy,
      effectiveRules: plan ? plan.effectiveRules ?? { ...DEFAULT_AUTOMATION_RULES }
        : resolveAutomationRules(sanitizeSystemConfig(system.data()).automationRules, (client.data() as Client).automation?.rules),
      budget: { limitUsd: policy.budgetUsd, reservedUsd: 0, spentUsd: 0, recordedUsd: 0, providerConfirmedUsd: null },
      ...(plan ? { planId: plan.id, resolvedPreset: plan.preset, estimatedCostUsd: plan.estimatedCostUsd, ...(plan.modelOptions ? { modelOptions: plan.modelOptions } : {}) } : {}), ...(role === 'automation' ? { automationPrincipalId: uid.slice('automation-'.length) } : {}), id: ref.id, requestedPreset: data.preset || resolved?.name || plan?.presetName || '', createdByUid: uid, status: 'pending',
      inputImages: data.inputImages || [], sourceImages: data.inputImages || [], outputImages: [], generationJobIds: [], batchId: null,
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null, failedAt: null,
      error: null, retryCount: 0, leaseToken: null, leaseExpiresAt: null,
      progress: { total: 0, completed: 0, failed: 0 },
    };
    uploadBindings.forEach((binding) => tx.create(binding, { inputClientId: data.clientId }));
    tx.create(ref, job);
    if (plan) tx.update(db.collection('automationPlans').doc(plan.id), { executedJobId: ref.id });
    keys.forEach((key) => tx.create(key, { jobId: ref.id }));
    return { jobId: ref.id, status: 'pending' as const, duplicate: false };
  });
  logger.info(receipt.duplicate ? 'automation duplicate ignored' : 'automation job created', { jobId: receipt.jobId, source: data.source });
  return receipt;
};

export const retryAutomation = async (input: RetryAutomationJobRequest, uid: string, role: string): Promise<AutomationJobReceipt> => {
  if (!input || typeof input.jobId !== 'string' || !/^[\w-]{1,200}$/.test(input.jobId)) throw new HttpsError('invalid-argument', 'jobId inválido.');
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(input.jobId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Trabajo no encontrado.');
    const job = snap.data() as AutomationJob;
    if (role !== 'automation') await assertHumanClientAccess(uid, job.clientId);
    if (!canReadAutomation(job, uid, role)) throw new HttpsError('permission-denied', 'Sin acceso.');
    if (job.batchId) throw new HttpsError('failed-precondition', 'Usa los controles de reintento del batch existente.');
    const system = await tx.get(db.collection('system_config').doc('main'));
    const client = await tx.get(db.collection('clients').doc(job.clientId));
    const global = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    const maxIntakeRetries = Math.min(job.effectivePolicy?.maxOperationalRetries ?? MAX_INTAKE_ATTEMPTS - 1, global.maxOperationalRetries, client.data()?.automation?.maxOperationalRetries ?? global.maxOperationalRetries);
    if (!['failed', 'needs_attention'].includes(job.status) || job.retryCount >= maxIntakeRetries) throw new HttpsError('failed-precondition', 'Reintentos agotados o trabajo activo.');
    const data = validateAutomationInput({ ...job, inputImages: job.sourceImages || job.inputImages, ...input }, input.inputImages ? uid : job.createdByUid);
    if (job.planId && (input.preset || input.provider || input.modelId)) throw new HttpsError('failed-precondition', 'Prepara un nuevo plan para cambiar la configuración autorizada.');
    const updatedPreset = job.photoProfile && (input.preset || input.provider || input.modelId) ? resolveAutomationPreset(data, client.data() as Client).config : null;
    const uploadBindings = await readUploadBindings(tx, data);
    uploadBindings.forEach((binding) => tx.create(binding, { inputClientId: data.clientId }));
    tx.update(ref, {
      ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}),
      ...((input.preset || input.provider || input.modelId) ? { resolvedPreset: updatedPreset || FieldValue.delete(), modelOptions: FieldValue.delete() } : {}),
      ...(data.provider ? { provider: data.provider } : {}),
      modelId: data.modelId || null, requestedPreset: data.preset || '', preset: data.preset || null,
      inputImages: data.inputImages || [], ...(input.inputImages ? { sourceImages: input.inputImages } : {}), status: 'pending', error: null,
      retryCount: job.retryCount + 1, leaseToken: null, leaseExpiresAt: null,
      failedAt: null, updatedAt: FieldValue.serverTimestamp(),
    });
    return { jobId: ref.id, status: 'pending' as const };
  });
  logger.info('automation retry', { jobId: ref.id });
  return result;
};
export const automationPublicError = (error: unknown): AutomationJob['error'] => error instanceof HttpsError
  ? { code: error.code, message: error.message }
  : { code: 'processing-failed', message: 'No se pudo procesar el trabajo. Revisa la configuración o reintenta desde Manglar.' };
