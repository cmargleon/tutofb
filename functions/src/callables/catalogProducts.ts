import { FieldPath, type Query } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import type { ApplyCatalogImportRequest, CatalogBatchPageRequest, CatalogGenerationImagesRequest, CatalogGenerationLink, CatalogImportRequest, CatalogPageRequest, CatalogProductRequest, SaveCatalogProductRequest, StoredMasterProduct } from '../../../shared/src/types';
import { CATALOG_STATUSES } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { assertCatalogAccess, catalogProduct, incorporateCatalogSource, loadCatalogBatch, possibleCatalogDuplicates, saveCatalogRecord, sourceFingerprint } from '../catalog/service';
import { catalogPageSize } from '../catalog/validation';
import { duplicateIssue, normalizeCatalogSearch } from '../catalog/model';

const options = { timeoutSeconds: 120, memory: '512MiB' as const };
/** Stable wire timestamps (Admin Timestamp JSON is not the frontend TimestampLike contract). */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && typeof item._seconds === 'number'
    ? item._seconds * 1000 + Math.floor((item._nanoseconds || 0) / 1e6) : item));
}
const authorize = async (request: CallableRequest<{ clientId: string }>) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  return assertCatalogAccess(request.auth!.uid, request.data?.clientId);
};
export const listCatalogProducts = onCall<CatalogPageRequest>(options, async request => {
  const ref = await authorize(request); const input = request.data; const size = catalogPageSize(input.pageSize);
  let query: Query = ref.collection('products');
  if (input.status !== undefined) {
    if (!CATALOG_STATUSES.includes(input.status)) throw new HttpsError('invalid-argument', 'Estado inválido.');
    query = query.where('catalog.status', '==', input.status);
  }
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 100)) throw new HttpsError('invalid-argument', 'Búsqueda inválida.');
  const search = normalizeCatalogSearch(input.search || '');
  if (search) query = query.where('catalog.searchKeys', 'array-contains', search);
  query = query.orderBy(FieldPath.documentId());
  if (input.cursor) query = query.startAfter(validId(input.cursor));
  // Bounded lookahead skips retained alias records without a collection scan or a legacy backfill.
  const page = await query.limit(size + 26).get();
  const visible = page.docs.filter(s => !s.get('catalog.redirectTo'));
  const docs = visible.slice(0, size);
  const products = docs.map(s => {
    if (s.get('clientId') !== input.clientId) throw new HttpsError('permission-denied', 'Producto fuera del cliente.');
    return catalogProduct(s.id, s.data() as StoredMasterProduct);
  });
  const more = visible.length > size || page.size === size + 26;
  return wire({ products, nextCursor: more ? (docs.at(-1)?.id || page.docs.at(-1)!.id) : null });
});
export const getCatalogProduct = onCall<CatalogProductRequest>(options, async request => {
  const ref = (await authorize(request)).collection('products').doc(validId(request.data.productId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ficha no disponible.');
  if (snap.get('clientId') !== request.data.clientId) throw new HttpsError('permission-denied', 'Producto fuera del cliente.');
  if (snap.get('catalog.redirectTo')) throw new HttpsError('failed-precondition', `Abre la ficha ${snap.get('catalog.redirectTo')}.`);
  let query: Query = ref.collection('generationLinks').orderBy(FieldPath.documentId());
  if (request.data.cursor) query = query.startAfter(validId(request.data.cursor));
  const page = await query.limit(21).get(); const docs = page.docs.slice(0, 20);
  const product = catalogProduct(snap.id, snap.data() as StoredMasterProduct);
  // Also detect concurrent creations and old records that predate duplicate incidents; reads stay pure.
  for (const [other, sku] of await possibleCatalogDuplicates(request.data.clientId, product)) {
    const issue = duplicateIssue(other, sku);
    if (!product.catalog!.issues.some(i => i.id === issue.id)) product.catalog!.issues.push(issue);
  }
  return wire({ product, links: docs.map(d => d.data() as CatalogGenerationLink), nextCursor: page.size > 20 ? docs.at(-1)!.id : null });
});
export const saveCatalogProduct = onCall<SaveCatalogProductRequest>(options, async request => {
  await authorize(request); return saveCatalogRecord(request.auth!.uid, request.data);
});
export const listCatalogLegacyBatches = onCall<CatalogBatchPageRequest>(options, async request => {
  await authorize(request); const size = catalogPageSize(request.data.pageSize);
  let query: Query = getAppFirestore().collection('batches').where('clientId', '==', request.data.clientId).orderBy(FieldPath.documentId());
  if (request.data.cursor) query = query.startAfter(validId(request.data.cursor));
  const page = await query.limit(size + 1).get(); const docs = page.docs.slice(0, size);
  return wire({ batches: docs.map(d => ({ id: d.id, createdAt: d.get('createdAt') || null })), nextCursor: page.size > size ? docs.at(-1)!.id : null });
});
export const previewCatalogImport = onCall<CatalogImportRequest>(options, async request => {
  const ref = await authorize(request); const products = await loadCatalogBatch(request.data.clientId, request.data.batchId);
  const candidates = [];
  for (const product of products) {
    const [alias, duplicates] = await Promise.all([ref.collection('productAliases').doc(product.id).get(), possibleCatalogDuplicates(request.data.clientId, product)]);
    const current = await ref.collection('products').doc(alias.get('productId') || product.id).get();
    candidates.push({ product, fingerprint: sourceFingerprint(product), linkedProductId: alias.get('productId') || null, possibleDuplicateIds: [...duplicates.keys()], currentRevision: current.get('revision') || 0 });
  }
  return wire({ candidates });
});
export const applyCatalogImport = onCall<ApplyCatalogImportRequest>(options, async request => {
  await authorize(request);
  const products = await loadCatalogBatch(request.data.clientId, request.data.batchId);
  const source = products.find(p => p.id === validId(request.data.legacyProductId));
  if (!source) throw new HttpsError('not-found', 'Producto no pertenece al lote.');
  return incorporateCatalogSource(request.auth!.uid, request.data, source);
});
export const getCatalogGenerationImages = onCall<CatalogGenerationImagesRequest>(options, async request => {
  const ref = await authorize(request);
  const product = await ref.collection('products').doc(validId(request.data.productId)).get();
  if (!product.exists || product.get('clientId') !== request.data.clientId) throw new HttpsError('not-found', 'Producto no disponible.');
  const link = await product.ref.collection('generationLinks').doc(validId(request.data.linkId)).get();
  if (!link.exists || link.get('clientId') !== request.data.clientId) throw new HttpsError('not-found', 'Generación no disponible.');
  const products = await loadCatalogBatch(request.data.clientId, link.get('batchId'));
  return wire({ products: products.filter(p => p.id === link.get('legacyProductId')) });
});
