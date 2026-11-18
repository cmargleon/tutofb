import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Batch, Job, ProductDraft, StoredMasterProduct } from '../../../shared/src/types';
import { getAppFirestore, APP_FIRESTORE_DATABASE_ID } from '../firebase/appFirestore';
import { jobMasterProductId, projectMasterProducts } from '../spreadsheets/masterProducts';
import { catalogClientRef, incorporateCatalogSource, sourceFingerprint } from './service';

/** Only future source events are incorporated. Deployment never walks or backfills production. */
export async function syncCatalogSource(kind: 'job' | 'draft', id: string, batchId?: string) {
  const db = getAppFirestore();
  const snap = await (kind === 'job' ? db.collection('jobs').doc(id) : db.collection('batches').doc(batchId!).collection('productDrafts').doc(id)).get();
  if (!snap.exists) return;
  const item = { ...snap.data(), id: snap.id } as Job & ProductDraft;
  if (!item.clientId || !item.batchId || !item.garmentId) return;
  const batchSnap = await db.collection('batches').doc(item.batchId).get();
  if (!batchSnap.exists || batchSnap.get('clientId') !== item.clientId) return;
  const batch = { ...batchSnap.data(), id: batchSnap.id } as Batch;
  // A draft and a job enrich the same stable legacy identity; new photographs never rekey it.
  const product = projectMasterProducts(item.clientId, [batch], kind === 'job' ? [item] : [], kind === 'draft' ? [item] : [])[0];
  if (!product) return;
  // Sync only this source event, not the whole batch history. Retries read the current document.
  const fingerprint = sourceFingerprint(product);
  const legacyId = jobMasterProductId(batch, item);
  const clientRef = catalogClientRef(item.clientId);
  const alias = await clientRef.collection('productAliases').doc(legacyId).get();
  const productId = alias.get('productId') || legacyId;
  const current = await clientRef.collection('products').doc(productId).get();
  const linkId = (await import('./model')).catalogDigest([item.batchId, legacyId]);
  const link = await current.ref.collection('generationLinks').doc(linkId).get();
  const data = current.data() as StoredMasterProduct | undefined;
  try {
    await incorporateCatalogSource('catalog-source-sync', { clientId: item.clientId, batchId: item.batchId, legacyProductId: legacyId, productId,
      expectedRevision: data?.revision || 0, fingerprint, confirmAssociation: false,
      variantMap: Object.fromEntries(Object.entries(link.get('variantMap') || {}).filter(([id]) => product.variants.some(v => v.id === id))) as Record<string, string>,
    }, product, `${kind}:${id}`);
  } catch (error) {
    // Explicit associations can require mapping newly discovered variants: leave the source intact.
    if (['failed-precondition', 'invalid-argument'].includes((error as { code?: string }).code || '')) {
      console.warn('catalog_source_needs_review', { clientId: item.clientId, legacyId, code: (error as { code: string }).code });
      return;
    }
    throw error;
  }
}
export const syncCatalogJob = onDocumentWritten({ document: 'jobs/{jobId}', database: APP_FIRESTORE_DATABASE_ID, retry: true }, async event => {
  if (!event.data?.after.exists) return;
  const pick = (value: FirebaseFirestore.DocumentSnapshot) => {
    const d = value.data(); return d && [d.clientId, d.batchId, d.garmentId, d.garmentName, d.garmentFilePath, d.photoTask?.productId, d.photoTask?.variantId];
  };
  // Output/review changes remain in jobs; the catalog resolves them live when opening a generation.
  if (JSON.stringify(pick(event.data.before)) === JSON.stringify(pick(event.data.after))) return;
  await syncCatalogSource('job', event.params.jobId);
});
export const syncCatalogDraft = onDocumentWritten({ document: 'batches/{batchId}/productDrafts/{draftId}', database: APP_FIRESTORE_DATABASE_ID, retry: true }, async event => {
  if (!event.data?.after.exists) return;
  const pick = (value: FirebaseFirestore.DocumentSnapshot) => { const d = value.data(); return d && [d.rows, d.inferredValues, d.garmentName, d.categoryId]; };
  if (JSON.stringify(pick(event.data.before)) === JSON.stringify(pick(event.data.after))) return;
  await syncCatalogSource('draft', event.params.draftId, event.params.batchId);
});
