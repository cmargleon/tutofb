import { createHash } from 'node:crypto';
import type { MarketplaceExportScope } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

/**
 * State of the background preparation of a set of batches for the marketplace export. Server-only collection
 * (no client rule allows it). One document per client + sorted batch ids.
 */
export interface MarketplacePrecompute {
  clientId: string;
  batchIds: string[];
  uid: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  slices: number;
  /** Requested again while running: run one more pass after the current one. */
  rerun: boolean;
  lease: string | null;
  leaseUntil: number;
  error: string | null;
  counts?: { products: number; published: number; squares: number; failures: number };
  createdAt: number;
  updatedAt: number;
}
export const PRECOMPUTE_COLLECTION = 'marketplacePrecomputes';
/** A queued or running preparation older than this is considered abandoned for the panel. */
export const PRECOMPUTE_STALE_MS = 20 * 60_000;
export const precomputeRef = (clientId: string, batchIds: string[]) => getAppFirestore().collection(PRECOMPUTE_COLLECTION)
  .doc(createHash('sha256').update(JSON.stringify([clientId, [...new Set(batchIds)].sort()])).digest('hex'));

export async function enqueueMarketplacePrecompute(clientId: string, batchIds: string[], uid: string, now = Date.now()) {
  const ref = precomputeRef(clientId, batchIds);
  await getAppFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as MarketplacePrecompute | undefined;
    if (current?.status === 'running' && current.leaseUntil > now) { tx.update(ref, { rerun: true, updatedAt: now }); return; }
    if (current?.status === 'queued') return;
    const state: MarketplacePrecompute = { clientId, batchIds: [...new Set(batchIds)].sort(), uid, status: 'queued', slices: 0, rerun: false,
      lease: null, leaseUntil: 0, error: null, createdAt: current?.createdAt ?? now, updatedAt: now };
    tx.set(ref, state);
  });
  return ref.id;
}

/** Whether a background preparation covering any batch of `scope` is in progress (and not abandoned). */
export async function marketplacePrecomputeRunning(scope: Pick<MarketplaceExportScope, 'clientId' | 'batchIds'>, now = Date.now()) {
  if (!scope.batchIds.length) return false;
  for (let index = 0; index < scope.batchIds.length; index += 30) {
    const snapshot = await getAppFirestore().collection(PRECOMPUTE_COLLECTION)
      .where('batchIds', 'array-contains-any', scope.batchIds.slice(index, index + 30)).limit(50).get();
    if (snapshot.docs.some(doc => {
      const state = doc.data() as MarketplacePrecompute;
      return state.clientId === scope.clientId && ['queued', 'running'].includes(state.status) && now - state.updatedAt < PRECOMPUTE_STALE_MS;
    })) return true;
  }
  return false;
}
