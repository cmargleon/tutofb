import * as admin from 'firebase-admin';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { ConfigureMarketplaceTemplateRequest, DownloadMarketplaceExportRequest, MarketplaceExportScope, SaveMasterProductRequest, SpreadsheetTemplate, StoredMasterProduct } from '../../../shared/src/types';
import { PRODUCT_FIELDS, VARIANT_FIELDS } from '../../../shared/src/types';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { safePublicImageUrl, normalizeMarketplaceColumnKey } from '../../../shared/src/marketplaceExport/adapters';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { downloadMarketplaceExport, loadExportContext, previewMarketplaceExport, templateUsable } from '../spreadsheets/marketplaceExportService';
import { analyzeMarketplaceTemplate, assertTemplateDocumentLimits } from '../spreadsheets/marketplaceTemplates';

const options = { timeoutSeconds: 540, memory: '1GiB' as const, concurrency: 1 };
const rethrowTransactionConflict = (error: unknown): never => {
  const failure = error as { code?: number; message?: string };
  // Exhausted Firestore contention and the emulator's closed-transaction response
  // both require a fresh read, rather than exposing an internal callable error.
  if (failure.code === 10 || (failure.code === 3 && /transaction is invalid or closed/i.test(failure.message || '')))
    throw new HttpsError('aborted', 'La información cambió durante el guardado. Actualiza antes de reintentar.');
  throw error;
};
export const previewMarketplaceExports = onCall<MarketplaceExportScope>(options, async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  return previewMarketplaceExport(request.data, request.auth!.uid);
});
export const downloadMarketplaceExports = onCall<DownloadMarketplaceExportRequest>(options, async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  return downloadMarketplaceExport(request.data, request.auth!.uid);
});
const stringMap = (value: unknown, allowed?: readonly string[]): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 500) throw new HttpsError('invalid-argument', 'Valores de producto inválidos.');
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || /[\x00-\x1F]/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || (allowed && !allowed.includes(key)) || typeof entry !== 'string' || entry.length > 20000) throw new HttpsError('invalid-argument', `Campo inválido: ${key}.`);
    result[key] = entry.trim();
  }
  return result;
};
export const saveMasterProduct = onCall<SaveMasterProductRequest>(options, async request => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
  const context = await loadExportContext(request.data, request.auth!.uid);
  const product = context.products.find(p => p.id === validId(request.data.productId));
  if (!product) throw new HttpsError('not-found', 'Producto no pertenece a los lotes seleccionados.');
  const values = stringMap(request.data.values, PRODUCT_FIELDS);
  if (!Array.isArray(request.data.variants) || !request.data.variants.length || request.data.variants.length > 200) throw new HttpsError('invalid-argument', 'Configura entre 1 y 200 variantes.');
  const variants = request.data.variants.map(v => ({ id: validId(v.id), values: stringMap(v.values, VARIANT_FIELDS), attributes: stringMap(v.attributes || {}) }));
  if (new Set(variants.map(v => v.id)).size !== variants.length) throw new HttpsError('invalid-argument', 'Variantes duplicadas.');
  const marketplaces: StoredMasterProduct['marketplaces'] = {};
  for (const [channel, data] of Object.entries(request.data.marketplaces || {})) {
    if (!isMarketplaceId(channel) || !data) throw new HttpsError('invalid-argument', 'Marketplace no disponible.');
    // Disabled payloads are compared with persisted data inside the transaction.
    if (!context.client.marketplaces?.[channel]?.enabled) continue;
    const template = context.templates.find(t => t.id === data.templateId && templateUsable(t, channel, product.marketplaces[channel]?.templateId === t.id));
    const category = context.categories.find(c => c.id === data.categoryId && c.templateId === template?.id);
    if (!template || !category) throw new HttpsError('invalid-argument', 'Plantilla/categoría fuera del cliente o canal.');
    if (data.rows && (!Array.isArray(data.rows) || data.rows.length > 200)) throw new HttpsError('invalid-argument', 'Filas inválidas.');
    const rows = (data.rows || []).map(row => {
      if (!variants.some(v => v.id === row.id)) throw new HttpsError('invalid-argument', 'Variante de salida desconocida.');
      return { id: row.id, values: stringMap(row.values, category.columns.map(c => c.key)) };
    });
    const imageUrls = Object.fromEntries(Object.entries(stringMap(data.imageUrls || {})).filter(([, url]) => url));
    for (const [outputId, url] of Object.entries(imageUrls)) {
      const existing = product.marketplaces[channel]?.imageUrls?.[outputId];
      if (existing === url) continue; // Historical links remain separate; only currently approved outputs may be exported.
      const publishedUrls = Object.values(product.publishedImages?.[channel] || {}).map(image => image.url);
      if (request.data.authorizePublicImages !== true || !product.approvedImages.some(i => i.outputId === outputId) || !safePublicImageUrl(url, publishedUrls)) throw new HttpsError('invalid-argument', 'Autoriza explícitamente URLs públicas permanentes de fotografías aprobadas.');
    }
    let requirements: typeof data.requirements;
    if (data.requirements) {
      if (channel !== 'amazon') throw new HttpsError('invalid-argument', 'La exención configurada pertenece únicamente a Amazon.');
      const exemptions = stringMap(data.requirements.gtinExemptionByVariant || {});
      for (const [variantId, status] of Object.entries(exemptions)) if (!variants.some(v => v.id === variantId) || !['pending', 'approved'].includes(status)) throw new HttpsError('invalid-argument', 'Exención o variante inválida.');
      requirements = { gtinExemptionByVariant: exemptions as Record<string, 'pending' | 'approved'>, brandSnapshot: values.brand || '', categoryIdSnapshot: category.id! };
    }
    marketplaces[channel] = { templateId: template!.id!, categoryId: category.id!, rows, imageUrls, ...(requirements ? { requirements } : {}) };
  }
  const db = getAppFirestore();
  const clientRef = db.collection('clients').doc(context.scope.clientId);
  const ref = clientRef.collection('products').doc(product.id);
  if (!Number.isInteger(request.data.expectedRevision) || request.data.expectedRevision < 0) throw new HttpsError('invalid-argument', 'Revisión inválida.');
  const revision = await getAppFirestore().runTransaction(async tx => {
    const [snap, client] = await Promise.all([tx.get(ref), tx.get(clientRef)]);
    if (!client.exists || client.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    const current = snap.get('revision') || 0;
    if (current !== request.data.expectedRevision) throw new HttpsError('aborted', 'El producto cambió. Actualiza antes de guardar.');
    const templateSnapshots = await Promise.all(Object.entries(marketplaces).map(async ([channel, data]) => ({
      channel, snapshot: await tx.get(clientRef.collection('spreadsheetTemplates').doc(data!.templateId)),
    })));
    for (const { channel, snapshot } of templateSnapshots) {
      if (isMarketplaceId(channel) && client.get(`marketplaces.${channel}.enabled`)
        && (!snapshot.exists || !templateUsable({ ...snapshot.data(), id: snapshot.id } as SpreadsheetTemplate, channel, product.marketplaces[channel]?.templateId === snapshot.id)))
        throw new HttpsError('aborted', 'La plantilla cambió. Actualiza antes de guardar.');
    }
    const merged: StoredMasterProduct['marketplaces'] = { ...snap.get('marketplaces') };
    for (const [channel, incoming] of Object.entries(request.data.marketplaces || {})) {
      if (!isMarketplaceId(channel)) throw new HttpsError('invalid-argument', 'Marketplace no disponible.');
      if (!client.get(`marketplaces.${channel}.enabled`)) {
        if (!isDeepStrictEqual(incoming, merged[channel])) throw new HttpsError('invalid-argument', 'No puedes modificar un marketplace deshabilitado.');
        continue;
      }
      // If it was enabled after prevalidation, retry with a fresh channel context.
      if (!marketplaces[channel]) throw new HttpsError('aborted', 'Los canales del cliente cambiaron. Actualiza antes de guardar.');
      merged[channel] = marketplaces[channel];
    }
    const data: StoredMasterProduct = { clientId: context.scope.clientId, values, variants, marketplaces: merged, revision: current + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedByUid: request.auth!.uid };
    tx.set(ref, data); return current + 1;
  }).catch(rethrowTransactionConflict);
  return { success: true, revision };
});

/** Pending uploads activate in place; revisions of released/legacy templates are additive. */
export const configureMarketplaceTemplate = onCall<ConfigureMarketplaceTemplateRequest>(options, async request => {
  await assertCallableRoles(request, ['admin']);
  const { clientId, templateId, marketplaceId, operation } = request.data;
  if (!isMarketplaceId(marketplaceId) || !['new_product', 'existing_catalog', 'listing'].includes(operation)) throw new HttpsError('invalid-argument', 'Canal u operación inválidos.');
  const db = getAppFirestore(); const clientRef = db.collection('clients').doc(validId(clientId));
  const ref = clientRef.collection('spreadsheetTemplates').doc(validId(templateId));
  const [client, snapshot, cs] = await Promise.all([clientRef.get(), ref.get(), ref.collection('categories').get()]);
  if (!client.exists || client.get('status') === 'archived' || !snapshot.exists || snapshot.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente o plantilla no disponible.');
  const template = { ...snapshot.data(), id: snapshot.id } as SpreadsheetTemplate;
  if (template.exportConfig && template.exportConfig.marketplaceId !== marketplaceId) throw new HttpsError('invalid-argument', 'El marketplace de una versión no puede cambiar.');
  if (!template.storagePath.startsWith(`client_spreadsheets/${clientId}/`)) throw new HttpsError('permission-denied', 'Original fuera del cliente.');
  const [buffer] = await admin.storage().bucket().file(template.storagePath).download();
  const analyzed = await analyzeMarketplaceTemplate(buffer, marketplaceId, template, cs.docs.map(d => ({ ...d.data(), id: d.id })) as import('../../../shared/src/types').SpreadsheetTemplateCategory[], request.data.layouts);
  if (analyzed.template.exportConfig.validationStatus === 'incompatible') throw new HttpsError('failed-precondition', analyzed.template.exportConfig.validationMessages.join(' '));
  const mappings: typeof request.data.mappings = {};
  if (!request.data.mappings || typeof request.data.mappings !== 'object') throw new HttpsError('invalid-argument', 'Revisa las asociaciones.');
  for (const category of analyzed.categories) {
    const incoming = request.data.mappings[category.id!];
    if (!incoming || typeof incoming !== 'object') throw new HttpsError('invalid-argument', `Configura ${category.label}.`);
    mappings[category.id!] = {};
    for (const column of category.columns) {
      const m = incoming[column.key];
      if (!m || typeof m.source !== 'string' || m.source.length > 500 || !/^(?:|(?:product|variant|attribute|legacy|image|literal|assignment)\..+)$/.test(m.source) || !['text', 'number'].includes(m.dataType || 'text')) throw new HttpsError('invalid-argument', `Asociación inválida: ${column.label}.`);
      if (m.source.startsWith('product.') && !PRODUCT_FIELDS.includes(m.source.slice(8) as never)) throw new HttpsError('invalid-argument', 'Campo maestro desconocido.');
      if (m.source.startsWith('variant.') && !VARIANT_FIELDS.includes(m.source.slice(8) as never)) throw new HttpsError('invalid-argument', 'Campo de variante desconocido.');
      if ((column.required || m.required) && !m.source) throw new HttpsError('invalid-argument', `Asocia el campo obligatorio ${column.label}.`);
      if (m.dataType === 'number' && (/^variant\.(?:sku|spu|skc|gtin|asin|catalogId|parentSku)$/.test(m.source) || /(?:^|_)(?:sku|spu|skc|gtin|ean|upc|asin)(?:_|$)/.test(normalizeMarketplaceColumnKey(column.key)))) throw new HttpsError('invalid-argument', 'Los identificadores deben conservarse como texto.');
      mappings[category.id!][column.key] = { source: m.source, required: column.required || m.required === true, dataType: m.dataType || 'text', ...(m.valueMap ? { valueMap: stringMap(m.valueMap) } : {}) };
    }
  }
  assertTemplateDocumentLimits({ ...analyzed.template, mappings }, analyzed.categories);
  const pending = !!template.exportConfig && template.exportConfig.validationStatus !== 'compatible';
  // A stable destination serializes even two associations of an unchanged legacy source.
  const next = pending ? ref : !template.exportConfig
    ? clientRef.collection('spreadsheetTemplates').doc(`marketplace-${createHash('sha256').update(`${templateId}\0${marketplaceId}`).digest('hex').slice(0, 40)}`)
    : clientRef.collection('spreadsheetTemplates').doc();
  const predecessorId = pending ? template.exportConfig?.replacesTemplateId : template.exportConfig ? templateId : null;
  const predecessorRef = predecessorId ? clientRef.collection('spreadsheetTemplates').doc(validId(predecessorId)) : null;
  // Legacy templates can still be deleted by their original administration flow.
  // Give the additive export association its own protected copy of the original.
  const storagePath = template.exportConfig ? template.storagePath
    : `client_spreadsheets/${clientId}/${next.id}/${template.originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  if (!template.exportConfig) {
    const destination = admin.storage().bucket().file(storagePath);
    try {
      await admin.storage().bucket().file(template.storagePath).copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
      const [existing] = await destination.download();
      if (!existing.equals(buffer)) throw new HttpsError('aborted', 'El original de la asociación cambió. Revisa la plantilla.');
    }
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  const { id: _id, ...base } = analyzed.template;
  await db.runTransaction(async tx => {
    // Complete each read before the next: an aborted lock acquisition must not leave
    // parallel reads using a closed transaction while Firestore retries it.
    const currentClient = await tx.get(clientRef);
    const source = await tx.get(ref);
    const predecessor = predecessorRef ? predecessorRef.isEqual(ref) ? source : await tx.get(predecessorRef) : null;
    const sourceCategories = await tx.get(ref.collection('categories'));
    const ancestorIds = [...new Set<string>([
      ...(template.exportConfig?.legacyTemplateIds || []), ...(predecessor?.get('exportConfig.legacyTemplateIds') || []),
    ])].filter(id => id !== ref.id && id !== predecessorRef?.id);
    const ancestors = ancestorIds.length ? await tx.getAll(...ancestorIds.map(id => ref.parent.doc(validId(id)))) : [];
    const association = !template.exportConfig ? await tx.get(next) : null;
    const legacyAssociations = !template.exportConfig ? await tx.get(ref.parent.where('exportConfig.legacyTemplateIds', 'array-contains', templateId)) : null;
    if (!currentClient.exists || currentClient.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente no disponible.');
    if (!source.updateTime?.isEqual(snapshot.updateTime!) || source.get('status') === 'archived'
      || sourceCategories.size !== cs.size || sourceCategories.docs.some(d => { const before = cs.docs.find(c => c.id === d.id); return !before || !d.updateTime.isEqual(before.updateTime); }))
      throw new HttpsError('aborted', 'La plantilla cambió. Actualiza antes de activar.');
    if (association?.exists || legacyAssociations?.docs.some(d => d.get('exportConfig.marketplaceId') === marketplaceId))
      throw new HttpsError('aborted', 'La plantilla heredada ya está asociada. Revisa su versión de exportación.');
    if (predecessorRef && (!predecessor?.exists || predecessor.get('status') === 'archived'
      || predecessor.get('exportConfig.marketplaceId') !== marketplaceId || predecessor.get('exportConfig.validationStatus') !== 'compatible'))
      throw new HttpsError('aborted', 'La versión reemplazada ya no está vigente. Actualiza antes de activar.');
    const lineage = [...new Set([
      ...(template.exportConfig?.legacyTemplateIds || []),
      ...(predecessor?.get('exportConfig.legacyTemplateIds') || []),
      ...(predecessorId ? [predecessorId] : []),
      ...(!template.exportConfig ? [templateId] : []),
    ])].filter(id => id !== next.id);
    // Released export revisions reuse their protected immutable original.
    tx.set(next, { ...base, storagePath, status: 'active', createdAt: pending ? source.get('createdAt') : now, updatedAt: now,
      exportConfig: { ...analyzed.template.exportConfig, operation, mappings, validationStatus: 'compatible',
        validationMessages: ['Estructura y asociaciones verificadas por el administrador. Validación final de carga pendiente en el marketplace.'],
        version: (predecessor?.get('exportConfig.version') || 0) + 1, replacesTemplateId: predecessorId || null,
        legacyTemplateIds: lineage, confirmedAt: now } });
    for (const category of analyzed.categories) tx.set(next.collection('categories').doc(category.id!), { ...category, templateId: next.id, createdAt: pending ? source.get('createdAt') : now, updatedAt: now });
    // Older activations could leave a released ancestor current. Retire only
    // explicit ancestors in this lineage; never revive archived or legacy templates.
    for (const ancestor of ancestors) {
      if (ancestor.exists && ancestor.get('status') !== 'archived' && ancestor.get('exportConfig.marketplaceId') === marketplaceId
        && ancestor.get('exportConfig.validationStatus') === 'compatible')
        tx.update(ancestor.ref, { status: 'archived', archivedAt: now, archivedByUid: request.auth!.uid,
          'exportConfig.supersededByTemplateId': next.id, updatedAt: now });
    }
    if (predecessorRef) tx.update(predecessorRef, { status: 'archived', archivedAt: now, archivedByUid: request.auth!.uid,
      'exportConfig.supersededByTemplateId': next.id, updatedAt: now });
  }).catch(rethrowTransactionConflict);
  return { success: true, templateId: next.id };
});
export const archiveMarketplaceTemplate = onCall<{ clientId: string; templateId: string }>(async request => {
  await assertCallableRoles(request, ['admin']);
  const db = getAppFirestore(); const client = db.collection('clients').doc(validId(request.data.clientId));
  const ref = client.collection('spreadsheetTemplates').doc(validId(request.data.templateId));
  await db.runTransaction(async tx => {
    const [clientSnap, template] = await Promise.all([tx.get(client), tx.get(ref)]);
    if (!clientSnap.exists || clientSnap.get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente archivado.');
    if (!template.exists) throw new HttpsError('not-found', 'Plantilla no disponible.');
    tx.update(ref, { status: 'archived', archivedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), archivedByUid: request.auth!.uid,
      ...(template.get('exportConfig') ? { 'exportConfig.supersededByTemplateId': null } : {}) });
  }).catch(rethrowTransactionConflict);
  return { success: true };
});
