import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Batch, Client, Job, ProductDraft, StoredMasterProduct } from '../../../shared/src/types';
import { applyOrganizerSource, loadOrganizerProducts } from '../spreadsheets/organizerProducts';
import { getAppFirestore, APP_FIRESTORE_DATABASE_ID } from '../firebase/appFirestore';
import { jobMasterProductId, projectMasterProducts } from '../spreadsheets/masterProducts';
import { catalogClientRef, incorporateCatalogSource, sourceFingerprint } from './service';
import { mapVariantsByCode } from './organizerBinding';

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
  // Organizer generations carry the client's Excel (name, SKU/SKC per size, price, brand...): the master record starts from it,
  // not from the file name and a single visual placeholder variant.
  if (batch.automationJobId && kind === 'job') {
    const client = await db.collection('clients').doc(item.clientId).get();
    const commerce = await loadOrganizerProducts({ ...client.data(), id: client.id } as Client, [batch], [item]);
    const link = commerce.get(`automationJobs/${batch.automationJobId}/organizerCommerce/${item.garmentId}`);
    if (link && !link.organizer.source.issue) applyOrganizerSource(product, link);
  }
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
  // Generations routed by an organizer base-code binding map variants by exact SKU/SKC and add the rest.
  const organizerBound = alias.get('origin') === 'organizer' && productId !== legacyId && Boolean(data);
  const persisted = Object.fromEntries(Object.entries(link.get('variantMap') || {}).filter(([id]) => product.variants.some(v => v.id === id))) as Record<string, string>;
  try {
    await incorporateCatalogSource('catalog-source-sync', { clientId: item.clientId, batchId: item.batchId, legacyProductId: legacyId, productId,
      expectedRevision: data?.revision || 0, fingerprint, confirmAssociation: false,
      variantMap: organizerBound ? { ...mapVariantsByCode(product.variants, data!.variants), ...persisted } : persisted,
    }, product, `${kind}:${id}`, { allowNewVariants: organizerBound });
  } catch (error) {
    // Explicit associations can require mapping newly discovered variants: leave the source intact.
    if (['failed-precondition', 'invalid-argument'].includes((error as { code?: string }).code || '')) {
      console.warn('catalog_source_needs_review', { clientId: item.clientId, legacyId, code: (error as { code: string }).code, message: (error as Error).message });
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
