import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { AutomationJob, AutomationJobReceipt, RetryAutomationJobRequest } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { authorizeMachineJob } from './machineAuth';
import { automationKeys, canReadAutomation, MAX_INTAKE_ATTEMPTS, validateAutomationInput } from './domain';

export const createAutomation = async (input: unknown, uid: string, role: string): Promise<AutomationJobReceipt> => {
  const data = validateAutomationInput(input, uid);
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
      if (!job || !canReadAutomation(job, uid, role) || job.clientId !== data.clientId) throw new HttpsError('permission-denied', 'Identificador no disponible.');
      keys.forEach((key) => tx.set(key, { jobId: existing.id }));
      return { jobId: existing.id, status: job.status, duplicate: true };
    }
    const client = await tx.get(db.collection('clients').doc(data.clientId));
    if (!client.exists || client.data()?.status === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const now = FieldValue.serverTimestamp();
    const job: AutomationJob = {
      ...data, ...(role === 'automation' ? { automationPrincipalId: uid.slice('automation-'.length) } : {}), id: ref.id, requestedPreset: data.preset || '', createdByUid: uid, status: 'pending',
      inputImages: data.inputImages || [], sourceImages: data.inputImages || [], outputImages: [], generationJobIds: [], batchId: null,
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null, failedAt: null,
      error: null, retryCount: 0, leaseToken: null, leaseExpiresAt: null,
      progress: { total: 0, completed: 0, failed: 0 },
    };
    tx.create(ref, job);
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
    if (!canReadAutomation(job, uid, role)) throw new HttpsError('permission-denied', 'Sin acceso.');
    if (job.batchId) throw new HttpsError('failed-precondition', 'Usa los controles de reintento del batch existente.');
    if (!['failed', 'needs_attention'].includes(job.status) || job.retryCount >= MAX_INTAKE_ATTEMPTS - 1) throw new HttpsError('failed-precondition', 'Reintentos agotados o trabajo activo.');
    const data = validateAutomationInput({ ...job, ...input }, input.inputImages ? uid : job.createdByUid);
    tx.update(ref, {
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
