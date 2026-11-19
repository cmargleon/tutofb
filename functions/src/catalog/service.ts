import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ApplyCatalogImportRequest, CatalogGenerationLink, MasterProduct, StoredMasterProduct } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { catalogDigest, duplicateIssue, manualEvidence, mergeCatalogSource, normalizeCatalogSearch } from './model';
import { assertCatalogSize, catalogRevision, catalogStringMap } from './validation';

export const catalogClientRef = (clientId: string) => getAppFirestore().collection('clients').doc(validId(clientId));
export const sourceFingerprint = (p: MasterProduct) => catalogDigest(p);
export async function possibleCatalogDuplicates(clientId: string, product: Pick<MasterProduct, 'id' | 'values' | 'variants'>) {
  const skus = [...new Set([product.values.sku, ...product.variants.map(v => v.values.sku)].filter((s): s is string => Boolean(s)))].slice(0, 30);
  const found = new Map<string, string>();
  if (!skus.length) return found;
  const matches = await catalogClientRef(clientId).collection('products').where('catalog.searchKeys', 'array-contains-any', skus.map(normalizeCatalogSearch)).limit(101).get();
  for (const snap of matches.docs) {
      const data = snap.data() as StoredMasterProduct;
      const sku = skus.find(sku => [data.values.sku, ...data.variants.map(v => v.values.sku)].includes(sku));
      if (sku && snap.id !== product.id && !data.catalog?.redirectTo) found.set(snap.id, sku);
  }
  return found;
}
/** Explicit per-source incorporation; no SKU/name/image based linking, no production-wide migration. */
export async function incorporateCatalogSource(uid: string, input: ApplyCatalogImportRequest, source: MasterProduct, sourceKey = 'batch',
  options: { allowNewVariants?: boolean } = {}) {
  const clientRef = catalogClientRef(validId(input.clientId));
  const productId = validId(input.productId); const legacyId = validId(input.legacyProductId);
  catalogRevision(input.expectedRevision);
  if (source.clientId !== input.clientId || source.id !== legacyId || !source.batchIds.includes(input.batchId)) throw new HttpsError('permission-denied', 'Fuente fuera del cliente o lote.');
  if (sourceFingerprint(source) !== input.fingerprint) throw new HttpsError('aborted', 'La fuente cambió. Revisa la previsualización.');
  const variantMap = catalogStringMap(input.variantMap || {});
  for (const [from, to] of Object.entries(variantMap)) { validId(from); validId(to); if (!source.variants.some(v => v.id === from)) throw new HttpsError('invalid-argument', 'Variante de origen desconocida.'); }
  const productRef = clientRef.collection('products').doc(productId);
  const aliasRef = clientRef.collection('productAliases').doc(legacyId);
  const linkId = catalogDigest([input.batchId, legacyId]);
  const linkRef = productRef.collection('generationLinks').doc(linkId);
  const duplicates = await possibleCatalogDuplicates(input.clientId, { ...source, id: productId });
  return getAppFirestore().runTransaction(async tx => {
    const [snap, alias, link, client, legacy] = await Promise.all([tx.get(productRef), tx.get(aliasRef), tx.get(linkRef), tx.get(clientRef), tx.get(clientRef.collection('products').doc(legacyId))]);
    if (!client.exists || client.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const movingAutomaticSource = alias.exists && alias.get('productId') === legacyId && productId !== legacyId && input.confirmAssociation === true;
    if (alias.exists && alias.get('productId') !== productId && !movingAutomaticSource) throw new HttpsError('failed-precondition', 'La fuente ya está asociada a otra ficha.');
    if (productId !== legacyId && input.confirmAssociation !== true && alias.get('productId') !== productId) throw new HttpsError('failed-precondition', 'Confirma explícitamente la asociación comercial.');
    const current = snap.data() as StoredMasterProduct | undefined;
    if (current?.catalog?.redirectTo || (current && current.clientId !== input.clientId)) throw new HttpsError('failed-precondition', 'Producto no disponible.');
    if (productId !== legacyId && !current) throw new HttpsError('not-found', 'Selecciona una ficha existente para asociar.');
    const persistedMap = link.get('variantMap') || {};
    const mapping = { ...persistedMap, ...Object.fromEntries(source.variants.map(v => [v.id, variantMap[v.id] || persistedMap[v.id] || v.id])), ...variantMap };
    if (new Set(source.variants.map(v => mapping[v.id])).size !== source.variants.length) throw new HttpsError('invalid-argument', 'No puedes fusionar dos variantes de origen en una sola variante.');
    const fingerprints = { ...link.get('sourceFingerprints') };
    if (fingerprints[sourceKey] === input.fingerprint && catalogDigest(link.get('variantMap')) === catalogDigest(mapping)) return { productId, revision: current?.revision || 0 };
    if ((current?.revision || 0) !== input.expectedRevision) throw new HttpsError('aborted', 'La ficha cambió. Recarga antes de incorporar.');
    // An organizer base-code binding adds unmatched variants instead of requiring a manual variant map.
    if (current && productId !== legacyId && !options.allowNewVariants && source.variants.some(v => !current.variants.some(row => row.id === mapping[v.id]))) throw new HttpsError('invalid-argument', 'Asocia cada variante de origen a una variante existente de la ficha.');
    if (productId !== legacyId && legacy.exists && !legacy.get('catalog.redirectTo')) {
      if (input.expectedSourceRevision !== legacy.get('revision')) throw new HttpsError('aborted', 'La ficha de origen cambió. Repite la previsualización.');
      if (legacy.get('catalog.version') === 1) {
        const [priorLinks, publications] = await Promise.all([tx.get(legacy.ref.collection('generationLinks').limit(2)), tx.get(legacy.ref.collection('marketplaceImages').limit(1))]);
        if (legacy.get('catalog.manuallyConfirmed') || legacy.get('catalog.status') !== 'draft' || legacy.get('updatedByUid') !== 'catalog-source-sync' || priorLinks.size !== 1 || priorLinks.docs[0].get('batchId') !== input.batchId || Object.keys(legacy.get('marketplaces') || {}).length || publications.size || legacy.get('catalog.selectedImages')?.length)
          throw new HttpsError('failed-precondition', 'La fuente tiene una ficha confirmada o varias generaciones. Revisa la incidencia; no se fusiona automáticamente.');
      }
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const incoming = { ...source };
    if (productId !== legacyId && legacy.exists && !legacy.get('catalog.redirectTo')) {
      const old = legacy.data() as StoredMasterProduct;
      incoming.values = { ...source.values, ...old.values };
      incoming.evidence = { ...source.evidence, ...Object.fromEntries(Object.entries(old.values).map(([field, value]) => [field, old.catalog?.evidence[field] || manualEvidence(value!)])) };
      if (old.variants.length && !old.organizerOverrides) incoming.variants = old.variants;
    }
    const merged = mergeCatalogSource(current, incoming, `batches/${input.batchId}`, mapping);
    if (uid !== 'catalog-source-sync') merged.catalog.manuallyConfirmed = true;
    merged.catalog.createdAt = current?.catalog?.createdAt || now;
    merged.catalog.thumbnailPath ||= source.approvedImages[0]?.storagePath || source.originalImages[0]?.storagePath || '';
    for (const [other, sku] of duplicates) if (other !== legacyId && !merged.catalog.issues.some(i => i.id === duplicateIssue(other, sku).id)) merged.catalog.issues.push(duplicateIssue(other, sku));
    if (source.organizer?.source.issue) {
      const issue = { id: catalogDigest(['identity', legacyId]), kind: 'identity' as const, field: 'identity', current: '', incoming: source.organizer.source.issue, reference: legacyId };
      if (!merged.catalog.issues.some(i => i.id === issue.id)) merged.catalog.issues.push(issue);
    }
    const data: StoredMasterProduct = { ...merged, clientId: input.clientId, marketplaces: current?.marketplaces || {}, revision: input.expectedRevision + 1, updatedAt: now, updatedByUid: uid };
    assertCatalogSize(data);
    const generation: CatalogGenerationLink = { id: linkId, clientId: input.clientId, batchId: input.batchId, legacyProductId: legacyId, garmentId: source.garmentId,
      draftIds: [...new Set<string>([...(link.get('draftIds') || []), ...source.legacyDrafts.flatMap(d => d.id || [])])], organizerReferences: [...new Set<string>([...(link.get('organizerReferences') || []), ...(source.organizer ? Object.keys(source.organizer.source.origins) : [])])], variantMap: mapping };
    if (snap.exists) tx.update(productRef, { ...data }); else tx.set(productRef, data);
    // merge keeps routing metadata (e.g. an organizer base-code binding) across later source events.
    tx.set(aliasRef, { clientId: input.clientId, productId, legacyProductId: legacyId }, { merge: true });
    tx.set(linkRef, { ...generation, sourceFingerprints: { ...fingerprints, [sourceKey]: input.fingerprint }, updatedAt: now });
    if (productId !== legacyId && legacy.exists) tx.set(legacy.ref, { catalog: { redirectTo: productId, listed: false } }, { merge: true });
    return { productId, revision: data.revision };
  });
}
