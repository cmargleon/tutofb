import { assertDelegatedStamp } from '../manglar/access';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationJob, Job } from '../../../shared/src/types';
import { DEFAULT_AUTOMATION_BUDGET, effectiveMaxBudgetUsd, usd, validateAutomationBudget } from '../../../shared/src/automationPolicy';
import { getAppFirestore } from '../firebase/appFirestore';
import { authorizeMachineJob } from './machineAuth';

export class AutomationBudgetError extends HttpsError {
  constructor(message: string) { super('resource-exhausted', message); }
}
// Compatibility for callers that still import estimates from the automation ledger.
export { estimateGenerationHold, GEMINI_OPERATION_HOLD_USD } from '../costs/generationEstimates';
const operationId = (key: string) => createHash('sha256').update(key).digest('hex');

/** Firestore lock contention (gRPC ABORTED = 10). The SDK's own retries can run out when many workers hit one doc. */
export const isFirestoreContentionError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  return code === 10 || code === 'aborted' || code === 'ABORTED' || /^10 ABORTED|cross-transaction contention|too much contention/i.test(message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-runs a ledger transaction while Firestore reports contention, with capped exponential backoff and full
 * jitter so concurrent workers spread out. Runs inside the job's claim, so it never consumes job.retryCount.
 * Only contention is retried: budget decisions and every other error propagate unchanged. A retried body
 * re-reads the ledger, so the limitUsd check is always evaluated against committed state.
 */
export const withContentionRetry = async <T>(
  run: () => Promise<T>,
  { attempts = 8, baseMs = 200, maxMs = 6000, wait = sleep, random = Math.random }: {
    attempts?: number; baseMs?: number; maxMs?: number; wait?: (ms: number) => Promise<unknown>; random?: () => number;
  } = {},
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isFirestoreContentionError(error)) throw error;
      await wait(Math.round(random() * Math.min(maxMs, baseMs * 2 ** attempt)));
    }
  }
};

const PAUSED_MESSAGE = 'El gasto del pedido está detenido. Reanuda con presupuesto autorizado antes de iniciar nuevas operaciones pagadas.';
const EXHAUSTED_MESSAGE = 'Presupuesto insuficiente para la siguiente operación. Se detuvo el gasto del pedido y se conservaron sus imágenes.';
const EPSILON_USD = 0.0000001;

/** Raised when admissions kept colliding for every round; classified as firestore_contention (retryable). */
export class AutomationBudgetContentionError extends Error {
  readonly code = 10;
  constructor() { super('10 ABORTED: demasiadas reservas simultáneas del mismo pedido; se reintentará.'); }
}

/**
 * Reserves `holdUsd` of the automation job's budget for one paid operation and returns its operation id.
 *
 * One organizer automation job can own hundreds of photos, so dozens of workers reserve on the same
 * `automationJobs/{id}` document at once. A transaction that reads that document and then writes it makes every
 * worker take a read lock and try to upgrade it, which Firestore aborts as cross-transaction contention
 * (10 ABORTED). So the ledger is never read inside a transaction; it only receives FieldValue.increment writes:
 *
 * 1. Admission: a transaction reads only per-operation documents (operation, claimed job, client, config),
 *    creates the operation as `pending` and adds the hold to `budget.pendingUsd`.
 * 2. Verification: a strongly consistent read. Within limit (spent + reserved + pending, own hold included)
 *    → one atomic batch moves the hold from pending to reserved. Otherwise the hold is withdrawn and:
 *    - if approved holds alone (spent + reserved) leave no room for it, spending pauses (exhausted);
 *    - else only other unverified holds were in the way: retry after a jittered wait.
 *
 * Guarantee: an approval's read includes its own hold and every hold admitted before it (pending or reserved),
 * and approved holds stay counted until settled. So the last approval's read covers every approved hold, and
 * approvals never add up to more than limitUsd. Settlement keeps uncertain outcomes charged at their full hold.
 */
export const reserveAutomationOperation = async (
  automationId: string, key: string, kind: 'generation' | 'review' | 'classification', holdUsd: number,
  generation?: { id: string; claimToken: string | null },
  { rounds = 10, wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) }: { rounds?: number; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<string> => {
  if (!Number.isFinite(holdUsd) || holdUsd <= 0) throw new AutomationBudgetError('No se pudo acotar el costo de la operación.');
  const hold = usd(holdUsd);
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(automationId);
  const op = ref.collection('operations').doc(operationId(key));
  const snapshot = await ref.get();
  const owner = snapshot.data() as AutomationJob | undefined;
  if (owner?.spendingPaused) throw new AutomationBudgetError(PAUSED_MESSAGE);
  if (!owner?.effectivePolicy || !owner.budget) throw new AutomationBudgetError('El trabajo no tiene un presupuesto autorizado.');
  // No request with an uncertain bill is silently authorized. This applies to Gemini too.
  if (!owner.effectivePolicy.allowEstimatedCosts) throw new AutomationBudgetError('Se requiere allowEstimatedCosts explícito: las tarifas disponibles son estimadas, no un máximo contractual del proveedor.');
  if (kind === 'classification' && !owner.effectivePolicy.authorizeClassification) throw new AutomationBudgetError('La clasificación pagada requiere authorizeClassification explícito.');
  if (owner.automationPrincipalId) await authorizeMachineJob(owner.createdByUid, owner.clientId, owner.jobType);
  if (owner.manglarAuthorization) await assertDelegatedStamp(owner.manglarAuthorization, owner.clientId);
  const policy = owner.effectivePolicy;
  const reads = [op, db.collection('system_config').doc('main'), db.collection('clients').doc(owner.clientId),
    ...(generation ? [db.collection('jobs').doc(generation.id)] : [])];

  for (let round = 1; ; round += 1) {
    // 1. Admission (no ledger read).
    const clientMaxUsd = await withContentionRetry(() => db.runTransaction(async (tx) => {
      const [existing, systemSnap, client, current] = await tx.getAll(...reads);
      const global = validateAutomationBudget(systemSnap.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET);
      if (!client.exists || client.data()?.status === 'archived' || client.data()?.automation?.enabled === false) throw new AutomationBudgetError('Cliente no disponible para automatización.');
      if (generation) {
        const job = current?.data() as Job | undefined;
        if (!job || job.clientId !== owner.clientId || job.automationJobId !== automationId || job.automationManaged !== true
          || job.status !== 'processing' || job.claimToken !== generation.claimToken) throw new AutomationBudgetError('La reserva del worker expiró.');
        const maxAttempts = Math.min(policy.maxReviewAttempts, global.maxReviewAttempts, client.data()?.automation?.maxReviewAttempts ?? global.maxReviewAttempts);
        const maxRetries = Math.min(policy.maxOperationalRetries, global.maxOperationalRetries, client.data()?.automation?.maxOperationalRetries ?? global.maxOperationalRetries);
        if ((kind === 'generation' && (job.generationAttemptCount || 0) >= maxAttempts) || job.retryCount > maxRetries) throw new AutomationBudgetError('Los nuevos límites impiden otro intento.');
      }
      if (existing.exists) throw new AutomationBudgetError('Operación ya reservada o registrada; requiere reconciliación antes de repetir.');
      tx.create(op, { key, kind, holdUsd: hold, state: 'pending', recordedUsd: null, providerConfirmedUsd: null,
        createdAt: FieldValue.serverTimestamp(), clientId: owner.clientId });
      tx.update(ref, { 'budget.pendingUsd': FieldValue.increment(hold), updatedAt: FieldValue.serverTimestamp() });
      return effectiveMaxBudgetUsd(global, client.data()?.automation);
    }));

    // 2. Verification against committed state, own hold included.
    const ledger = (await ref.get()).data() as AutomationJob;
    const budget = ledger.budget!;
    const limitUsd = Math.min(budget.limitUsd, clientMaxUsd);
    const approved = budget.spentUsd + Math.max(0, budget.reservedUsd);
    const withPending = approved + Math.max(0, budget.pendingUsd || 0);
    const paused = ledger.spendingPaused === true;
    const batch = db.batch();
    if (!paused && withPending <= limitUsd + EPSILON_USD) {
      batch.update(op, { state: 'reserved', reservedAt: FieldValue.serverTimestamp() });
      batch.update(ref, { 'budget.pendingUsd': FieldValue.increment(-hold), 'budget.reservedUsd': FieldValue.increment(hold), updatedAt: FieldValue.serverTimestamp() });
      await withContentionRetry(() => batch.commit());
      return op.id;
    }
    // Withdraw this hold. Deleting the operation lets a later round reuse its id.
    const exhausted = !paused && approved + hold > limitUsd + EPSILON_USD;
    batch.delete(op);
    batch.update(ref, { 'budget.pendingUsd': FieldValue.increment(-hold), ...(exhausted ? { spendingPaused: true } : {}), updatedAt: FieldValue.serverTimestamp() });
    await withContentionRetry(() => batch.commit());
    if (paused) throw new AutomationBudgetError(PAUSED_MESSAGE);
    if (exhausted) throw new AutomationBudgetError(EXHAUSTED_MESSAGE);
    if (round >= rounds) throw new AutomationBudgetContentionError();
    await wait(Math.round(Math.random() * Math.min(4000, 100 * 2 ** round)));
  }
};

export const settleAutomationOperation = async (
  automationId: string, id: string, recordedUsd: number | null,
): Promise<void> => {
  if (recordedUsd !== null && (!Number.isFinite(recordedUsd) || recordedUsd < 0)) {
    throw new HttpsError('invalid-argument', 'El costo registrado debe ser finito y no negativo.');
  }
  const db = getAppFirestore();
  const ref = db.collection('automationJobs').doc(automationId);
  const op = ref.collection('operations').doc(id);
  // Reads only the operation; the shared ledger is moved with increments, so settlements never contend on it.
  await withContentionRetry(() => db.runTransaction(async (tx) => {
    const operation = await tx.get(op);
    const data = operation.data();
    if (!data || data.state !== 'reserved') return;
    // Unknown outcomes retain their entire exposure. Do not release money on a timeout.
    const charged = usd(recordedUsd === null ? data.holdUsd : recordedUsd);
    tx.update(op, { state: recordedUsd === null ? 'uncertain' : 'recorded', recordedUsd,
      committedUsd: charged, providerConfirmedUsd: null, settledAt: FieldValue.serverTimestamp() });
    tx.update(ref, { 'budget.reservedUsd': FieldValue.increment(-data.holdUsd),
      'budget.spentUsd': FieldValue.increment(charged), 'budget.recordedUsd': FieldValue.increment(recordedUsd ?? 0),
      'budget.uncertainUsd': FieldValue.increment(recordedUsd === null ? charged : 0),
      updatedAt: FieldValue.serverTimestamp() });
  }));
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
