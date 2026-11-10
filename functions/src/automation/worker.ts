import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { DEFAULT_AUTOMATION_BUDGET } from '../../../shared/src/automationPolicy';
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AutomationJob, Client, Job } from '../../../shared/src/types';
import { getAppFirestore, APP_FIRESTORE_DATABASE_ID } from '../firebase/appFirestore';
import { GEMINI_API_KEY } from '../config/runtime';
import { assertUserRoles } from '../auth/roles';
import { AutomationAttentionError, importImagesForAutomationJob } from './imports';
import { resolveAutomationPreset } from './presets';
import { loadAutomationModelOptions } from './models';
import { dispatchGarment, dispatchProduct } from './pipelines';
import { automationPublicError } from './persistence';
import { authorizeMachineJob, pruneExpiredMachineTokens } from './machineAuth';
import { MAX_INTAKE_ATTEMPTS, summarizeAutomation } from './domain';

export const processAutomation = async (jobId: string): Promise<void> => {
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(jobId);
  const token = randomUUID();
  const job = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data() as AutomationJob | undefined;
    if (!current || current.status !== 'pending' || current.batchId) return null;
    const patch = { status: 'importing' as const, leaseToken: token, leaseExpiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) };
    tx.update(ref, { ...patch, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { ...current, ...patch };
  });
  if (!job) return;
  logger.info('automation import started', { jobId });
  try {
    if (job.automationPrincipalId) {
      if (job.createdByUid !== `automation-${job.automationPrincipalId}`) throw new Error('Identidad técnica inconsistente.');
      await authorizeMachineJob(job.createdByUid, job.clientId, job.jobType);
    } else await assertUserRoles(job.createdByUid, undefined, ['admin', 'operador']);
    if (!job.effectivePolicy || !job.budget) throw new AutomationAttentionError('Este trabajo anterior no tiene un presupuesto autorizado. Prepara un nuevo plan; los lotes existentes conservan su recuperación manual desde Catálogo.');
    const clientSnapshot = await db.collection('clients').doc(job.clientId).get();
    const client = clientSnapshot.data() as Client | undefined;
    if (!client || client.status === 'archived') throw new AutomationAttentionError('Cliente no disponible.');
    const preset = job.resolvedPreset ? { name: job.requestedPreset, config: job.resolvedPreset, modelId: job.modelId || null } : resolveAutomationPreset(job, client);
    if (!job.resolvedPreset && !job.photoProfile) {
      const legacyConfig = client.automation?.presets?.[preset.name];
      preset.config = { ...preset.config, photoProfile: undefined, ...normalizeProviderImageConfig(preset.config.provider!, legacyConfig?.imageConfig, legacyConfig?.aspectRatio || '3:4') };
    }
    const modelOptions = job.jobType === 'garment'
      ? job.modelOptions || await loadAutomationModelOptions(job.clientId, client, job.modelId || preset.config.modelId, preset.config.poseIds)
      : undefined;
    const inputImages = await importImagesForAutomationJob(job);
    const stillActive = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.data()?.leaseToken !== token || snapshot.data()?.status !== 'importing') return false;
      tx.update(ref, { inputImages, ...(modelOptions ? { modelOptions } : {}), requestedPreset: preset.name, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!stillActive) return;
    logger.info('automation import completed', { jobId, count: inputImages.length });
    const prepared = { ...job, inputImages, modelOptions };
    logger.info('automation generation started', { jobId, jobType: job.jobType });
    if (job.jobType === 'garment') await dispatchGarment(prepared, client, preset.config, modelOptions!);
    else await dispatchProduct(prepared, client, preset.config);
    await refreshAutomation(jobId);
  } catch (error) {
    const attention = error instanceof AutomationAttentionError;
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.data()?.leaseToken !== token || snapshot.data()?.batchId) return;
      tx.update(ref, {
        status: attention ? 'needs_attention' : 'failed',
        error: attention ? { code: 'configuration-required', message: error.message } : automationPublicError(error),
        failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), leaseToken: null, leaseExpiresAt: null,
      });
    });
    logger.warn('automation job failed', { jobId, code: attention ? 'configuration-required' : 'processing-failed' });
  }
};

export const refreshAutomation = async (jobId: string): Promise<AutomationJob | null> => {
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(jobId);
  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const job = snapshot.data() as AutomationJob | undefined;
    if (!job) return null;
    if (!job.batchId || !job.generationJobIds.length) return job;
    const snapshots = await tx.getAll(...job.generationJobIds.map((id) => db.collection('jobs').doc(id)));
    const jobs = snapshots.filter((snap) => snap.exists).map((snap) => ({ ...snap.data(), id: snap.id } as Job));
    const itemIssues = (job.items || []).filter((item) => item.issue);
    const items = [...itemIssues, ...[...new Set(jobs.map((scene) => scene.garmentId))].map((itemId) => {
      const scenes = jobs.filter((scene) => scene.garmentId === itemId);
      const previous = job.items?.find(item => item.itemId === itemId);
      return { ...previous, itemId, modelId: scenes[0].modelId, status: scenes.every((scene) => scene.status === 'completed') ? 'completed' as const : scenes.some((scene) => scene.status === 'failed') ? 'needs_attention' as const : 'processing' as const,
        scenes: scenes.map((scene) => ({ jobId: scene.id!, scene: scene.productScene || scene.poseImageId,
          status: scene.automationGate || scene.status, attempts: scene.generationAttemptCount || 0, verdict: scene.latestAutoReview?.verdict || null, reason: scene.lastError || null })) };
    })];
    const batchIds = job.batchIds || [job.batchId];
    const missing = jobs.length !== job.generationJobIds.length || jobs.some((scene) => scene.clientId !== job.clientId || scene.automationJobId !== job.id || !batchIds.includes(scene.batchId));
    const summary = missing ? { status: 'needs_attention' as const, progress: job.progress, outputImages: [] } : summarizeAutomation(jobs);
    if (summary.status === 'completed' && itemIssues.length) summary.status = 'needs_attention';
    const error = missing ? { code: 'missing-generation-job', message: 'Un job de generación fue eliminado.' }
      : summary.progress.failed ? { code: jobs.some((scene) => scene.automationGate === 'budget') ? 'automation-budget-paused' : 'generation-review-failed', message: jobs.find((scene) => scene.automationGate === 'budget')?.lastError || 'Hay imágenes fallidas o rechazadas. Revisa los jobs y sus intentos en el batch.' }
      : itemIssues.length ? { code: 'item-preparation-failed', message: `${itemIssues.length} artículo(s) requieren atención. Los demás continúan normalmente; revisa las incidencias por artículo.` } : null;
    const changed = job.status !== summary.status || JSON.stringify(job.error) !== JSON.stringify(error) || JSON.stringify(job.progress) !== JSON.stringify(summary.progress) || JSON.stringify(job.outputImages) !== JSON.stringify(summary.outputImages) || JSON.stringify(job.items) !== JSON.stringify(items);
    if (changed) tx.update(ref, {
      ...summary, items, error, updatedAt: FieldValue.serverTimestamp(),
      completedAt: summary.status === 'completed' ? FieldValue.serverTimestamp() : null,
      failedAt: summary.status === 'needs_attention' ? FieldValue.serverTimestamp() : null,
    });
    return { ...job, ...summary, items, error };
  });
  return result;
};

export const automationIntakeWorker = onDocumentWritten({
  document: 'automationJobs/{jobId}', database: APP_FIRESTORE_DATABASE_ID,
  timeoutSeconds: 540, memory: '1GiB', maxInstances: 5, concurrency: 1, secrets: [GEMINI_API_KEY],
}, async (event) => {
  if (event.data?.after.data()?.status === 'pending') await processAutomation(event.params.jobId);
});
export const automationGenerationProgress = onDocumentWritten({
  document: 'jobs/{jobId}', database: APP_FIRESTORE_DATABASE_ID,
}, async (event) => {
  const before = event.data?.before.data() as Job | undefined;
  const after = event.data?.after.data() as Job | undefined;
  const id = after?.automationJobId || before?.automationJobId;
  if (!id || (before?.status === after?.status && before?.currentOutputId === after?.currentOutputId)) return;
  const job = await refreshAutomation(id);
  if (after?.latestAutoReview?.verdict === 'rejected') logger.info('automation review failed', { jobId: id, generationJobId: event.params.jobId });
  if (after?.status === 'pending' && before?.status === 'processing') logger.info('automation retry', { jobId: id, generationJobId: event.params.jobId });
  if (after?.status === 'completed') logger.info('automation generation completed', { jobId: id, generationJobId: event.params.jobId });
  if (job && ['completed', 'needs_attention', 'failed'].includes(job.status)) logger.info(`automation job ${job.status}`, { jobId: id });
});
export const recoverAutomation = async (): Promise<void> => {
  await pruneExpiredMachineTokens();
  const db = getAppFirestore();
  // Single-field query: no new composite index required.
  const snapshots = await db.collection('automationJobs').where('status', 'in', ['pending', 'importing']).limit(100).get();
  for (const snapshot of snapshots.docs) {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(snapshot.ref);
      const job = current.data() as AutomationJob;
      if (job.status === 'pending') {
        tx.update(snapshot.ref, { updatedAt: FieldValue.serverTimestamp() });
      } else if (job.status === 'importing' && job.leaseExpiresAt?.toMillis() <= Date.now() && !job.batchId) {
        const retryCount = job.retryCount + 1;
        const system = await tx.get(db.collection('system_config').doc('main'));
        const global = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
        const exhausted = retryCount > Math.min(job.effectivePolicy?.maxOperationalRetries ?? MAX_INTAKE_ATTEMPTS - 1, global.maxOperationalRetries);
        tx.update(snapshot.ref, {
          status: exhausted ? 'failed' : 'pending', retryCount, leaseToken: null, leaseExpiresAt: null,
          error: exhausted ? { code: 'import-timeout', message: 'Se agotaron los intentos de importación.' } : null,
          failedAt: exhausted ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp(),
        });
        logger.warn('automation retry', { jobId: snapshot.id, retryCount, exhausted });
      }
    });
  }
};
export const recoverAutomationImports = onSchedule('every 5 minutes', recoverAutomation);
