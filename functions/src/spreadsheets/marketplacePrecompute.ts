import { randomUUID } from 'node:crypto';
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { AutomationJob, Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { APP_FIRESTORE_DATABASE_ID, getAppFirestore } from '../firebase/appFirestore';
import { GEMINI_API_KEY } from '../config/runtime';
import { precomputeMarketplaceExport } from './marketplaceExportService';
import { enqueueMarketplacePrecompute, PRECOMPUTE_COLLECTION, type MarketplacePrecompute } from './marketplacePrecomputeState';

/** Safety cap on chained slices (40 × ~400 s ≈ 4.5 h); a preparation beyond it is left as failed for review. */
export const MAX_PRECOMPUTE_SLICES = 40;
const SLICE_MS = 400_000;
const LEASE_MS = 560_000;

/** A finished automation prepares its export in the background (only for clients with an enabled marketplace). */
export async function onAutomationFinished(before: Partial<AutomationJob> | undefined, after: Partial<AutomationJob> | undefined) {
  if (!after?.batchId || !after.clientId || !after.createdByUid || before?.status === after.status) return null;
  if (!['completed', 'needs_attention'].includes(after.status || '')) return null;
  // Machine principals have no human client access; their exports keep the on-demand path.
  if (after.createdByUid.startsWith('automation-')) return null;
  const client = (await getAppFirestore().collection('clients').doc(after.clientId).get()).data() as Client | undefined;
  if (!client || client.status === 'archived' || !MARKETPLACES.some(channel => client.marketplaces?.[channel.id]?.enabled)) return null;
  return enqueueMarketplacePrecompute(after.clientId, after.batchIds?.length ? after.batchIds : [after.batchId], after.createdByUid);
}

/** One slice of a queued preparation. Progress lives in the caches, so a new slice continues where this one stopped. */
export async function runMarketplacePrecompute(id: string, apiKey: string, run = precomputeMarketplaceExport) {
  const db = getAppFirestore();
  const ref = db.collection(PRECOMPUTE_COLLECTION).doc(id);
  const lease = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const state = (await tx.get(ref)).data() as MarketplacePrecompute | undefined;
    if (!state || state.status !== 'queued' || state.leaseUntil > Date.now()) return null;
    if (state.slices >= MAX_PRECOMPUTE_SLICES) {
      tx.update(ref, { status: 'failed', error: `La preparación superó ${MAX_PRECOMPUTE_SLICES} tramos; revisa el lote.`, updatedAt: Date.now() });
      return null;
    }
    tx.update(ref, { status: 'running', lease, leaseUntil: Date.now() + LEASE_MS, slices: state.slices + 1, rerun: false, updatedAt: Date.now() });
    return state;
  });
  if (!claimed) return;
  const finish = (update: Partial<MarketplacePrecompute>) => db.runTransaction(async tx => {
    const state = (await tx.get(ref)).data() as MarketplacePrecompute | undefined;
    if (state?.lease !== lease) return;
    // Pending work (or a new request while running) hands over to the next slice through this same trigger.
    const again = update.status === 'completed' && state.rerun;
    tx.update(ref, { ...update, ...(again ? { status: 'queued' } : {}), lease: null, leaseUntil: 0, updatedAt: Date.now() });
  });
  try {
    const result = await run({ clientId: claimed.clientId, batchIds: claimed.batchIds }, claimed.uid, apiKey, Date.now() + SLICE_MS);
    await finish({ status: result.pending ? 'queued' : 'completed', counts: result.counts, error: null });
  } catch (error) {
    console.warn('Marketplace precompute failed', { id, message: error instanceof Error ? error.message.slice(0, 300) : 'Error' });
    await finish({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'Error de preparación.' });
  }
}

/** Abandoned slices (crashed instance) return to the queue; called by the existing 5-minute recovery schedule. */
export async function requeueExpiredMarketplacePrecomputes(now = Date.now()) {
  const db = getAppFirestore();
  const running = await db.collection(PRECOMPUTE_COLLECTION).where('status', '==', 'running').limit(50).get();
  for (const doc of running.docs) await db.runTransaction(async tx => {
    const state = (await tx.get(doc.ref)).data() as MarketplacePrecompute | undefined;
    if (state?.status === 'running' && state.leaseUntil <= now) tx.update(doc.ref, { status: 'queued', lease: null, leaseUntil: 0, updatedAt: now });
  });
}

export const marketplacePrecomputeOnAutomation = onDocumentUpdated({
  document: 'automationJobs/{jobId}', database: APP_FIRESTORE_DATABASE_ID,
}, async event => {
  await onAutomationFinished(event.data?.before.data() as AutomationJob | undefined, event.data?.after.data() as AutomationJob | undefined);
});

export const marketplacePrecomputeWorker = onDocumentWritten({
  document: `${PRECOMPUTE_COLLECTION}/{id}`, database: APP_FIRESTORE_DATABASE_ID,
  timeoutSeconds: 540, memory: '1GiB', maxInstances: 5, secrets: [GEMINI_API_KEY],
}, async event => {
  if (event.data?.after.data()?.status !== 'queued') return;
  await runMarketplacePrecompute(event.params.id, GEMINI_API_KEY.value());
});
