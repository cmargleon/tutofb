import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { APP_FIRESTORE_DATABASE_ID, getAppFirestore } from '../firebase/appFirestore';
import { FAL_KEY, GEMINI_API_KEY } from '../config/runtime';
import { processModelBaseOperation } from './marketplaceSets';

export const processModelMarketplaceBase = onDocumentWritten({
  document: 'models/{modelId}/baseOperations/{operationId}', database: APP_FIRESTORE_DATABASE_ID,
  secrets: [FAL_KEY, GEMINI_API_KEY], timeoutSeconds: 540, memory: '1GiB', concurrency: 4, maxInstances: 5, retry: true,
}, async event => {
  if (event.data?.after.get('executionMode') !== 'background' || event.data.after.get('status') !== 'queued') return;
  await processModelBaseOperation(event.params.modelId, event.params.operationId, event.data.after.get('attemptNumber'));
});

/** Timeout is ambiguous: never repay a provider automatically after losing its response. */
export const recoverModelMarketplaceBases = onSchedule('every 10 minutes', async () => {
  const db = getAppFirestore();
  // Single-field collection-group index; no compound index is required.
  const snapshots = await db.collectionGroup('baseOperations').where('status', 'in', ['queued', 'generating', 'verifying']).get();
  for (const snapshot of snapshots.docs) {
    if (!snapshot.get('spec')) continue; // Historical operations are left untouched.
    await db.runTransaction(async tx => {
      const current = await tx.get(snapshot.ref);
      if (!['queued', 'generating', 'verifying'].includes(current.get('status')) || Date.now() - (current.get('updatedAt')?.toMillis() || Date.now()) < 15 * 60_000) return;
      tx.update(snapshot.ref, { status: 'needs_attention', claimToken: null, error: 'Operación interrumpida. Revisa el historial y verifica la imagen conservada; no se repetirá el cobro automáticamente.' });
    });
  }
});
