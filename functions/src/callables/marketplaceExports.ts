import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { ConfigureMarketplaceTemplateRequest, DownloadMarketplaceExportRequest, MarketplaceExportScope, SaveMasterProductRequest, SpreadsheetTemplate, StoredMasterProduct } from '../../../shared/src/types';
import { PRODUCT_FIELDS, VARIANT_FIELDS } from '../../../shared/src/types';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { safePublicImageUrl, normalizeMarketplaceColumnKey } from '../../../shared/src/marketplaceExport/adapters';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { downloadMarketplaceExport, loadExportContext, previewMarketplaceExport } from '../spreadsheets/marketplaceExportService';
import { analyzeMarketplaceTemplate, assertTemplateDocumentLimits } from '../spreadsheets/marketplaceTemplates';

const options = { timeoutSeconds: 540, memory: '1GiB' as const, concurrency: 1 };
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
    if (!isMarketplaceId(channel) || !data || !context.client.marketplaces?.[channel]?.enabled) throw new HttpsError('invalid-argument', 'Marketplace no disponible.');
    const template = context.templates.find(t => t.id === data.templateId && t.exportConfig?.marketplaceId === channel);
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
      if (request.data.authorizePublicImages !== true || !product.approvedImages.some(i => i.outputId === outputId) || !safePublicImageUrl(url)) throw new HttpsError('invalid-argument', 'Autoriza explícitamente URLs públicas permanentes de fotografías aprobadas.');
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
  const ref = getAppFirestore().collection('clients').doc(context.scope.clientId).collection('products').doc(product.id);
  const revision = await getAppFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref); const current = snap.get('revision') || 0;
    if (current !== request.data.expectedRevision) throw new HttpsError('aborted', 'El producto cambió. Actualiza antes de guardar.');
    const data: StoredMasterProduct = { clientId: context.scope.clientId, values, variants, marketplaces, revision: current + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedByUid: request.auth!.uid };
    tx.set(ref, data); return current + 1;
  });
  return { success: true, revision };
});

/** Activation and legacy association create a new immutable version; old documents remain intact. */
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
      if (!m || typeof m.source !== 'string' || m.source.length > 500 || !/^(?:|(?:product|variant|attribute|legacy|image|literal)\..+)$/.test(m.source) || !['text', 'number'].includes(m.dataType || 'text')) throw new HttpsError('invalid-argument', `Asociación inválida: ${column.label}.`);
      if (m.source.startsWith('product.') && !PRODUCT_FIELDS.includes(m.source.slice(8) as never)) throw new HttpsError('invalid-argument', 'Campo maestro desconocido.');
      if (m.source.startsWith('variant.') && !VARIANT_FIELDS.includes(m.source.slice(8) as never)) throw new HttpsError('invalid-argument', 'Campo de variante desconocido.');
      if ((column.required || m.required) && !m.source) throw new HttpsError('invalid-argument', `Asocia el campo obligatorio ${column.label}.`);
      if (m.dataType === 'number' && (/^variant\.(?:sku|spu|skc|gtin|asin|catalogId|parentSku)$/.test(m.source) || /(?:^|_)(?:sku|spu|skc|gtin|ean|upc|asin)(?:_|$)/.test(normalizeMarketplaceColumnKey(column.key)))) throw new HttpsError('invalid-argument', 'Los identificadores deben conservarse como texto.');
      mappings[category.id!][column.key] = { source: m.source, required: column.required || m.required === true, dataType: m.dataType || 'text', ...(m.valueMap ? { valueMap: stringMap(m.valueMap) } : {}) };
    }
  }
  assertTemplateDocumentLimits({ ...analyzed.template, mappings }, analyzed.categories);
  const next = clientRef.collection('spreadsheetTemplates').doc();
  const immutablePath = `client_spreadsheets/${clientId}/${next.id}/${template.originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await admin.storage().bucket().file(template.storagePath).copy(admin.storage().bucket().file(immutablePath));
  const now = admin.firestore.FieldValue.serverTimestamp();
  const { id: _id, ...base } = analyzed.template;
  const batch = db.batch();
  batch.set(next, { ...base, storagePath: immutablePath, status: 'active', createdAt: now, updatedAt: now, exportConfig: { ...analyzed.template.exportConfig, operation, mappings, validationStatus: 'compatible', validationMessages: ['Estructura y asociaciones verificadas por el administrador. Validación final de carga pendiente en el marketplace.'], version: (template.exportConfig?.version || 0) + 1, replacesTemplateId: templateId, legacyTemplateIds: [...new Set([templateId, ...(template.exportConfig?.legacyTemplateIds || [])])], confirmedAt: now } });
  for (const category of analyzed.categories) batch.set(next.collection('categories').doc(category.id!), { ...category, templateId: next.id, createdAt: now, updatedAt: now });
  // Archive only the superseded export version. Legacy generation templates remain usable.
  if (template.exportConfig) batch.update(ref, { status: 'archived', archivedAt: now, archivedByUid: request.auth!.uid, updatedAt: now });
  await batch.commit();
  return { success: true, templateId: next.id };
});
export const archiveMarketplaceTemplate = onCall<{ clientId: string; templateId: string }>(async request => {
  await assertCallableRoles(request, ['admin']);
  const db = getAppFirestore(); const client = db.collection('clients').doc(validId(request.data.clientId));
  if ((await client.get()).get('status') === 'archived') throw new HttpsError('failed-precondition', 'Cliente archivado.');
  const ref = client.collection('spreadsheetTemplates').doc(validId(request.data.templateId));
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Plantilla no disponible.');
  await ref.update({ status: 'archived', archivedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), archivedByUid: request.auth!.uid });
  return { success: true };
});
