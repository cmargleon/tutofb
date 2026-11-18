import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ApplyCatalogImportRequest, Batch, CatalogGenerationLink, CatalogProduct, Client, Job, MasterProduct, ProductDraft, SaveCatalogProductRequest, StoredMasterProduct } from '../../../shared/src/types';
import { CATALOG_STATUSES } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { validId } from '../manglar/access';
import { jobMasterProductId, projectMasterProducts } from '../spreadsheets/masterProducts';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { isApprovedProductPhoto } from '../../../shared/src/productWorkflow';
import { applyOrganizerSource, loadOrganizerProducts } from '../spreadsheets/organizerProducts';
import { catalogDigest, catalogMetadata, duplicateIssue, manualEvidence, mergeCatalogSource, normalizeCatalogSearch } from './model';
import { assertCatalogSize, catalogRevision, catalogStringMap, catalogValues, catalogVariants } from './validation';

export const catalogClientRef = (clientId: string) => getAppFirestore().collection('clients').doc(validId(clientId));
export async function assertCatalogAccess(uid: string, clientId: string) {
  validId(clientId); await assertHumanClientAccess(uid, clientId);
  const ref = catalogClientRef(clientId); const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Cliente no disponible.');
  if (snap.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente archivado.');
  return ref;
}
export function catalogProduct(id: string, data: StoredMasterProduct): CatalogProduct {
  return { ...data, id, catalog: catalogMetadata(data, data.catalog?.createdAt || data.updatedAt) };
}
/** Read-only, bounded projection. Never calls preview/autofill, publishes images or persists a migration. */
export async function loadCatalogBatch(clientId: string, batchId: string) {
  const db = getAppFirestore(); const clientRef = catalogClientRef(clientId);
  const [client, batchSnap] = await Promise.all([clientRef.get(), db.collection('batches').doc(validId(batchId)).get()]);
  if (!client.exists || client.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
  if (!batchSnap.exists || batchSnap.get('clientId') !== clientId) throw new HttpsError('permission-denied', 'Lote fuera del cliente.');
  const batch = { ...batchSnap.data(), id: batchSnap.id } as Batch;
  const [js, ds] = await Promise.all([db.collection('jobs').where('batchId', '==', batchId).limit(1001).get(), batchSnap.ref.collection('productDrafts').limit(1001).get()]);
  if (js.size > 1000 || ds.size > 1000) throw new HttpsError('resource-exhausted', 'El lote supera 1000 trabajos/borradores.');
  const jobs = js.docs.map(d => ({ ...d.data(), id: d.id } as Job));
  const drafts = ds.docs.map(d => ({ ...d.data(), id: d.id } as ProductDraft));
  if ([...jobs, ...drafts].some(item => item.clientId !== clientId)) throw new HttpsError('permission-denied', 'Referencias fuera del cliente.');
  const products = projectMasterProducts(clientId, [batch], jobs, drafts);
  const commerce = await loadOrganizerProducts({ ...client.data(), id: clientId } as Client, [batch], jobs);
  for (const p of products) {
    const link = batch.automationJobId && commerce.get(`automationJobs/${batch.automationJobId}/organizerCommerce/${p.garmentId}`);
    if (link) applyOrganizerSource(p, link);
  }
  return products;
}
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
export async function saveCatalogRecord(uid: string, input: SaveCatalogProductRequest) {
  const clientRef = await assertCatalogAccess(uid, input.clientId);
  const id = validId(input.productId); const expected = catalogRevision(input.expectedRevision);
  const values = catalogValues(input.values); const variants = catalogVariants(input.variants); const attributes = catalogStringMap(input.attributes);
  if (!CATALOG_STATUSES.includes(input.status)) throw new HttpsError('invalid-argument', 'Estado de ficha inválido.');
  const verified = input.verifiedGtinVariantIds || [];
  if (!Array.isArray(verified) || verified.some(id => !variants.some(v => v.id === id && /^\d{8,14}$/.test(v.values.gtin || '')))) throw new HttpsError('invalid-argument', 'GTIN verificado inválido.');
  if (input.resolveIssueIds && (!Array.isArray(input.resolveIssueIds) || input.resolveIssueIds.length > 200 || input.resolveIssueIds.some(id => typeof id !== 'string'))) throw new HttpsError('invalid-argument', 'Incidencias inválidas.');
  const duplicates = await possibleCatalogDuplicates(input.clientId, { id, values, variants });
  const ref = clientRef.collection('products').doc(id);
  return getAppFirestore().runTransaction(async tx => {
    const [snap, client] = await Promise.all([tx.get(ref), tx.get(clientRef)]);
    if (!client.exists || client.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const current = snap.data() as StoredMasterProduct | undefined;
    if (current?.clientId && current.clientId !== input.clientId) throw new HttpsError('permission-denied', 'Producto fuera del cliente.');
    if (current?.catalog?.redirectTo) throw new HttpsError('failed-precondition', 'Abre la ficha canónica asociada.');
    if ((current?.revision || 0) !== expected) {
      // Creation is retryable with the same caller-generated ID and identical commercial payload.
      if (expected === 0 && current?.revision === 1 && current.updatedByUid === uid && catalogDigest([current.values, current.variants, current.catalog?.attributes, current.catalog?.status]) === catalogDigest([values, variants, attributes, input.status])) return { productId: id, revision: 1 };
      throw new HttpsError('aborted', 'La ficha cambió. Recarga antes de guardar.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const catalog = catalogMetadata({ values, variants, catalog: current?.catalog }, now);
    catalog.status = input.status; catalog.attributes = attributes; catalog.manuallyConfirmed = true;
    if (input.selectedImages !== undefined) {
      if (!Array.isArray(input.selectedImages) || input.selectedImages.length > 100) throw new HttpsError('invalid-argument', 'Selecciona hasta 100 imágenes.');
      const unique = new Set<string>();
      for (const selection of input.selectedImages) {
        const link = await tx.get(ref.collection('generationLinks').doc(validId(selection.linkId)));
        const job = await tx.get(getAppFirestore().collection('jobs').doc(validId(selection.jobId)));
        validId(selection.outputId);
        const output = job.exists && resolveApprovedJobOutput(job.data() as Job);
        const batch = link.exists && await tx.get(getAppFirestore().collection('batches').doc(validId(link.get('batchId'))));
        if (!link.exists || link.get('clientId') !== input.clientId || job.get('clientId') !== input.clientId || job.get('batchId') !== link.get('batchId') || !batch || batch.get('clientId') !== input.clientId || jobMasterProductId({ ...batch.data(), id: batch.id } as Batch, job.data() as Job) !== link.get('legacyProductId') || !output || output.id !== selection.outputId || !isApprovedProductPhoto(job.data() as Job, output)) throw new HttpsError('failed-precondition', 'Solo puedes seleccionar fotografías aprobadas y vinculadas a esta ficha.');
        if (unique.has(selection.outputId)) throw new HttpsError('invalid-argument', 'Imagen duplicada.');
        unique.add(selection.outputId);
      }
      catalog.selectedImages = input.selectedImages.map(s => ({ linkId: s.linkId, jobId: s.jobId, outputId: s.outputId }));
    }
    const evidence = { ...catalog.evidence };
    for (const [key, value] of Object.entries(values)) evidence[key] = manualEvidence(value!);
    for (const variant of variants) {
      for (const [key, value] of Object.entries(variant.values)) evidence[`variant.${variant.id}.${key}`] = { ...manualEvidence(value!), ...(key === 'gtin' ? { verified: verified.includes(variant.id) } : {}) };
      for (const [key, value] of Object.entries(variant.attributes || {})) evidence[`attribute.${variant.id}.${key}`] = manualEvidence(value);
    }
    for (const [key, value] of Object.entries(attributes)) evidence[`attribute.${key}`] = manualEvidence(value);
    catalog.evidence = evidence;
    catalog.issues = catalog.issues.filter(i => !input.resolveIssueIds?.includes(i.id));
    for (const [other, sku] of duplicates) {
      const issue = duplicateIssue(other, sku);
      if (!catalog.issues.some(i => i.id === issue.id)) catalog.issues.push(issue);
    }
    catalog.issues = catalog.issues.slice(-200);
    const data: StoredMasterProduct = { clientId: input.clientId, values, variants, marketplaces: current?.marketplaces || {}, revision: expected + 1, updatedAt: now, updatedByUid: uid, catalog };
    assertCatalogSize(data);
    // merge preserves marketplace publications, organizer overrides and future fields.
    if (snap.exists) tx.update(ref, { ...data }); else tx.set(ref, data);
    return { productId: id, revision: data.revision };
  });
}

/** Explicit per-source incorporation; no SKU/name/image based linking, no production-wide migration. */
export async function incorporateCatalogSource(uid: string, input: ApplyCatalogImportRequest, source: MasterProduct, sourceKey = 'batch') {
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
    if (current && productId !== legacyId && source.variants.some(v => !current.variants.some(row => row.id === mapping[v.id]))) throw new HttpsError('invalid-argument', 'Asocia cada variante de origen a una variante existente de la ficha.');
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
    tx.set(aliasRef, { clientId: input.clientId, productId, legacyProductId: legacyId });
    tx.set(linkRef, { ...generation, sourceFingerprints: { ...fingerprints, [sourceKey]: input.fingerprint }, updatedAt: now });
    if (productId !== legacyId && legacy.exists) tx.set(legacy.ref, { catalog: { redirectTo: productId } }, { merge: true });
    return { productId, revision: data.revision };
  });
}
