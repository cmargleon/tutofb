import { getManglarContext } from '../manglar/context';
import { delegatedStamp } from '../manglar/access';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, AutomationPolicy, Job, ResumeAutomationRequest } from '../../../shared/src/types';
import { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy } from '../../../shared/src/automationPolicy';
import { getAppFirestore } from '../firebase/appFirestore';
import { canReadAutomation } from './domain';
import { authorizeMachineJob } from './machineAuth';

export const automationScenePatch = (policy: AutomationPolicy | undefined): Partial<Job> => policy ? {
  automationManaged: true, automationGate: null,
  autoReviewMaxAttempts: policy.maxReviewAttempts, maxRetries: policy.maxOperationalRetries,
} : {};
export const resumeAutomation = async (input: ResumeAutomationRequest, uid: string, role: string) => {
  if (!input || typeof input.jobId !== 'string' || !/^[\w-]{1,200}$/.test(input.jobId)) throw new HttpsError('invalid-argument', 'jobId inválido.');
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(input.jobId);
  const before = (await ref.get()).data() as AutomationJob | undefined;
  if (!before || !canReadAutomation(before, uid, role)) throw new HttpsError('not-found', 'Trabajo no encontrado.');
  if (role === 'automation') await authorizeMachineJob(uid, before.clientId, before.jobType);
  return db.runTransaction(async (tx) => {
    const [snapshot, system, client] = await tx.getAll(ref, db.collection('system_config').doc('main'), db.collection('clients').doc(before.clientId));
    const job = snapshot.data() as AutomationJob;
    if (!job.effectivePolicy || !job.budget) throw new HttpsError('failed-precondition', 'El trabajo no tiene un presupuesto reanudable.');
    let policy;
    try { policy = resolveAutomationPolicy(system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET, client.data()?.automation, { ...job.effectivePolicy, budgetUsd: input.budgetUsd ?? job.budget.limitUsd }); }
    catch (error) { throw new HttpsError('failed-precondition', (error as Error).message); }
    if (policy.budgetUsd < job.budget.spentUsd + job.budget.reservedUsd) throw new HttpsError('failed-precondition', 'El presupuesto no puede ser menor que el gasto comprometido.');
    if (!job.batchId) {
      if (!job.spendingPaused || !['failed', 'needs_attention'].includes(job.status)) throw new HttpsError('failed-precondition', 'La entrada no está detenida por presupuesto.');
      tx.update(ref, { ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}), effectivePolicy: policy, spendingPaused: false, 'budget.limitUsd': policy.budgetUsd, status: 'pending', error: null, leaseToken: null, leaseExpiresAt: null, updatedAt: FieldValue.serverTimestamp() });
      return { jobId: job.id, resumedScenes: 0 };
    }
    const scenes = await tx.getAll(...job.generationJobIds.map((id) => db.collection('jobs').doc(id)));
    let count = 0;
    for (const scene of scenes) {
      const data = scene.data() as Job;
      // Quality-exhausted scenes require the existing Catalog operator controls. Never reset their attempts here.
      if (data.automationManaged && data.status === 'failed' && data.automationGate === 'budget' && data.currentOutput?.autoReview?.verdict !== 'approved') {
        tx.update(scene.ref, { status: 'pending', automationGate: null, lastError: null, updatedAt: FieldValue.serverTimestamp() }); count++;
      }
    }
    tx.update(ref, { ...(getManglarContext()?.caller ? { manglarAuthorization: delegatedStamp(getManglarContext()!.caller!) } : {}), effectivePolicy: policy, spendingPaused: false, 'budget.limitUsd': policy.budgetUsd, status: 'processing', error: null, updatedAt: FieldValue.serverTimestamp() });
    return { jobId: job.id, resumedScenes: count };
  });
};
