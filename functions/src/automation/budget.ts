import { assertDelegatedStamp } from '../manglar/access';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, Job, Provider, ProviderImageConfig } from '../../../shared/src/types';
import { DEFAULT_AUTOMATION_BUDGET, remainingAutomationBudget, usd, validateAutomationBudget } from '../../../shared/src/automationPolicy';
import { getProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { getAppFirestore } from '../firebase/appFirestore';
import { authorizeMachineJob } from './machineAuth';

export class AutomationBudgetError extends HttpsError {
  constructor(message: string) { super('resource-exhausted', message); }
}
// Rate-card values in the shared module are estimates, especially token-priced GPT models.
// Never describe these holds as a provider-enforced spending guarantee.
export const estimateGenerationHold = (provider: Provider, config: ProviderImageConfig, references: number) => {
  const estimate = getProviderCostUsd(provider, config, references);
  const fixed = ['fal-seedream', 'fal-banana-pro', 'fal-nano-banana-2', 'fal-seedream-5', 'fal-seedream-5-flash'].includes(provider);
  return { estimateUsd: estimate, holdUsd: fixed ? estimate : Math.max(0.5, estimate * 4), fixed };
};
export const GEMINI_OPERATION_HOLD_USD = 0.05;
const operationId = (key: string) => createHash('sha256').update(key).digest('hex');

export const reserveAutomationOperation = async (
  automationId: string, key: string, kind: 'generation' | 'review' | 'classification', holdUsd: number,
  generation?: { id: string; claimToken: string | null },
): Promise<string> => {
  if (!Number.isFinite(holdUsd) || holdUsd <= 0) throw new AutomationBudgetError('No se pudo acotar el costo de la operación.');
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(automationId);
  const op = ref.collection('operations').doc(operationId(key));
  const snapshot = await ref.get();
  const owner = snapshot.data() as AutomationJob | undefined;
  if (owner?.automationPrincipalId) await authorizeMachineJob(owner.createdByUid, owner.clientId, owner.jobType);
  if (owner?.manglarAuthorization) await assertDelegatedStamp(owner.manglarAuthorization, owner.clientId);
  const reserved = await db.runTransaction(async (tx) => {
    const [jobSnap, existing, systemSnap] = await tx.getAll(ref, op, db.collection('system_config').doc('main'));
    const job = jobSnap.data() as AutomationJob | undefined;
    if (job?.spendingPaused) throw new AutomationBudgetError('El gasto del pedido está detenido. Reanuda con presupuesto autorizado antes de iniciar nuevas operaciones pagadas.');
    if (!job?.effectivePolicy || !job.budget) throw new AutomationBudgetError('El trabajo no tiene un presupuesto autorizado.');
    const global = validateAutomationBudget(systemSnap.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET);
    const client = await tx.get(db.collection('clients').doc(job.clientId));
    if (!client.exists || client.data()?.status === 'archived' || client.data()?.automation?.enabled === false) throw new AutomationBudgetError('Cliente no disponible para automatización.');
    if (generation) {
      const current = (await tx.get(db.collection('jobs').doc(generation.id))).data() as Job | undefined;
      if (!current || current.clientId !== job.clientId || current.automationJobId !== automationId || current.automationManaged !== true
        || current.status !== 'processing' || current.claimToken !== generation.claimToken) throw new AutomationBudgetError('La reserva del worker expiró.');
      const maxAttempts = Math.min(job.effectivePolicy.maxReviewAttempts, global.maxReviewAttempts, client.data()?.automation?.maxReviewAttempts ?? global.maxReviewAttempts);
      const maxRetries = Math.min(job.effectivePolicy.maxOperationalRetries, global.maxOperationalRetries, client.data()?.automation?.maxOperationalRetries ?? global.maxOperationalRetries);
      if ((kind === 'generation' && (current.generationAttemptCount || 0) >= maxAttempts) || current.retryCount > maxRetries) throw new AutomationBudgetError('Los nuevos límites impiden otro intento.');
    }
    // No request with an uncertain bill is silently authorized. This applies to Gemini too.
    if (!job.effectivePolicy.allowEstimatedCosts) throw new AutomationBudgetError('Se requiere allowEstimatedCosts explícito: las tarifas disponibles son estimadas, no un máximo contractual del proveedor.');
    if (kind === 'classification' && !job.effectivePolicy.authorizeClassification) throw new AutomationBudgetError('La clasificación pagada requiere authorizeClassification explícito.');
    if (existing.exists) throw new AutomationBudgetError('Operación ya reservada o registrada; requiere reconciliación antes de repetir.');
    const limitUsd = Math.min(job.budget.limitUsd, global.maxBudgetUsd);
    if (remainingAutomationBudget({ ...job.budget, limitUsd }) + 0.0000001 < holdUsd) {
      tx.update(ref, { spendingPaused: true, updatedAt: FieldValue.serverTimestamp() });
      return false;
    }
    tx.create(op, { key, kind, holdUsd: usd(holdUsd), state: 'reserved', recordedUsd: null, providerConfirmedUsd: null,
      createdAt: FieldValue.serverTimestamp(), clientId: job.clientId });
    tx.update(ref, { 'budget.reservedUsd': usd(job.budget.reservedUsd + holdUsd), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!reserved) throw new AutomationBudgetError('Presupuesto insuficiente para la siguiente operación. Se detuvo el gasto del pedido y se conservaron sus imágenes.');
  return op.id;
};

export const settleAutomationOperation = async (
  automationId: string, id: string, recordedUsd: number | null, confirmedFixedRate = false,
): Promise<void> => {
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(automationId);
  const op = ref.collection('operations').doc(id);
  await db.runTransaction(async (tx) => {
    const [snap, operation] = await tx.getAll(ref, op);
    const job = snap.data() as AutomationJob;
    const data = operation.data();
    if (!data || data.state !== 'reserved') return;
    // Unknown outcomes retain their entire exposure. Do not release money on a timeout.
    const charged = confirmedFixedRate && recordedUsd !== null ? recordedUsd : Math.max(data.holdUsd, recordedUsd || 0);
    tx.update(op, { state: recordedUsd === null ? 'uncertain' : 'recorded', recordedUsd,
      committedUsd: charged, providerConfirmedUsd: null, settledAt: FieldValue.serverTimestamp() });
    tx.update(ref, { 'budget.reservedUsd': usd(Math.max(0, job.budget!.reservedUsd - data.holdUsd)),
      'budget.spentUsd': usd(job.budget!.spentUsd + charged), 'budget.recordedUsd': usd(job.budget!.recordedUsd + (recordedUsd || 0)),
      updatedAt: FieldValue.serverTimestamp() });
  });
};

export const pauseAutomationGeneration = async (job: Job, message: string): Promise<void> => {
  const ref = getAppFirestore().collection('jobs').doc(job.id!);
  await getAppFirestore().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current?.claimToken !== job.claimToken || current?.status !== 'processing') return;
    tx.update(ref, { status: 'failed', automationGate: 'budget', lastError: message,
      claimToken: null, claimedBy: null, claimExpiresAt: null, timeoutAt: null, updatedAt: FieldValue.serverTimestamp() });
  });
};
