import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Batch, Client, DownloadMarketplaceExportRequest, DownloadMarketplaceExportResponse, Job, MasterProduct, MarketplaceExportPreview, MarketplaceExportScope, ProductDraft, SpreadsheetTemplate, SpreadsheetTemplateCategory, StoredMasterProduct } from '../../../shared/src/types';
import { MARKETPLACE_ADAPTERS } from '../../../shared/src/marketplaceExport/adapters';
import { MARKETPLACES, isMarketplaceId, type MarketplaceId } from '../../../shared/src/marketplaces';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { projectMasterProducts } from './masterProducts';
import { inspectWorkbookPackage, patchWorkbookCells, assertPatchableCells, rangeContains, type SheetPatch, type CellPatch, xmlAttrs, validationAccepts } from './ooxmlWorkbook';
import { sanitizeSpreadsheetFileName } from './batchSpreadsheetExport';

export function normalizeExportScope(input: MarketplaceExportScope): MarketplaceExportScope {
  const clientId = validId(input?.clientId);
  if (!Array.isArray(input?.batchIds) || !input.batchIds.length || input.batchIds.length > 20) throw new HttpsError('invalid-argument', 'Selecciona entre 1 y 20 lotes.');
  return { clientId, batchIds: [...new Set(input.batchIds.map(validId))].sort() };
}
export async function loadExportContext(input: MarketplaceExportScope, uid: string) {
  const scope = normalizeExportScope(input); await assertHumanClientAccess(uid, scope.clientId);
  const db = getAppFirestore(); const clientRef = db.collection('clients').doc(scope.clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) throw new HttpsError('not-found', 'Cliente no disponible.');
  const client = { ...clientSnapshot.data(), id: clientSnapshot.id } as Client;
  if (client.status === 'archived') throw new HttpsError('failed-precondition', 'El cliente está archivado.');
  const batches: Batch[] = []; const jobs: Job[] = []; const drafts: ProductDraft[] = [];
  for (const id of scope.batchIds) {
    const ref = db.collection('batches').doc(id); const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get('clientId') !== scope.clientId) throw new HttpsError('permission-denied', 'Lote fuera del cliente seleccionado.');
    await assertHumanClientAccess(uid, snapshot.get('clientId'));
    batches.push({ ...snapshot.data(), id: snapshot.id } as Batch);
    const [js, ds] = await Promise.all([db.collection('jobs').where('batchId', '==', id).limit(1001).get(), ref.collection('productDrafts').limit(1001).get()]);
    if (js.size > 1000 || ds.size > 1000) throw new HttpsError('resource-exhausted', 'El lote supera el límite de exportación.');
    jobs.push(...js.docs.map(d => ({ ...d.data(), id: d.id } as Job)));
    drafts.push(...ds.docs.map(d => ({ ...d.data(), id: d.id } as ProductDraft)));
  }
  let products = projectMasterProducts(scope.clientId, batches, jobs, drafts);
  if (products.reduce((sum, product) => sum + product.variants.length, 0) > 2000) throw new HttpsError('resource-exhausted', 'Selecciona hasta 2000 variantes por descarga.');
  if (products.length > 500) throw new HttpsError('resource-exhausted', 'Exporta hasta 500 productos por descarga.');
  const stored: Record<string, StoredMasterProduct> = {};
  if (products.length) for (const d of await db.getAll(...products.map(p => clientRef.collection('products').doc(p.id)))) if (d.exists) stored[d.id] = d.data() as StoredMasterProduct;
  products = projectMasterProducts(scope.clientId, batches, jobs, drafts, stored);
  const ts = await clientRef.collection('spreadsheetTemplates').limit(201).get();
  if (ts.size > 200) throw new HttpsError('resource-exhausted', 'El cliente supera 200 versiones de plantilla; contacta al administrador.');
  const templates = ts.docs.map(d => ({ ...d.data(), id: d.id } as SpreadsheetTemplate));
  const categories = (await Promise.all(ts.docs.map(d => d.ref.collection('categories').get()))).flatMap(s => s.docs.map(d => ({ ...d.data(), id: d.id } as SpreadsheetTemplateCategory)));
  for (const category of categories) if (templates.some(template => template.id === category.templateId && template.exportConfig)) category.validationMode = 'template';
  // A deterministic projection reuses the old template only after an administrator explicitly associates it.
  for (const p of products) for (const t of [...templates].sort((a, b) => (b.exportConfig?.version || 0) - (a.exportConfig?.version || 0))) {
    if (!t.exportConfig || !templateUsable(t, t.exportConfig.marketplaceId) || p.marketplaces[t.exportConfig.marketplaceId]) continue;
    const legacy = p.legacyDrafts.find(d => d.templateId === t.id || d.templateId === t.exportConfig?.replacesTemplateId || t.exportConfig?.legacyTemplateIds?.includes(d.templateId));
    if (legacy && t.categoryIds.includes(legacy.categoryId)) p.marketplaces[t.exportConfig.marketplaceId] = { templateId: t.id!, categoryId: legacy.categoryId };
  }
  return { scope, client, products, templates, categories };
}
type Context = Awaited<ReturnType<typeof loadExportContext>>;
export const templateUsable = (t: SpreadsheetTemplate, channel: MarketplaceId) => t.status !== 'archived' && t.exportConfig?.marketplaceId === channel && t.exportConfig.validationStatus === 'compatible';
export function previewExportContext(context: Context): MarketplaceExportPreview {
  const { client, products, templates, categories } = context;
  const channels = MARKETPLACES.filter(m => client.marketplaces?.[m.id]?.enabled).map(({ id }) => {
    const available = templates.filter(t => templateUsable(t, id));
    const issues = products.flatMap(p => {
      const data = p.marketplaces[id]; const template = available.find(t => t.id === data?.templateId);
      const category = categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
      if (!template || !category) return [{ marketplaceId: id, productId: p.id, productName: p.values.name || p.garmentId, code: !available.length ? 'template' : 'category', message: !available.length ? 'Falta plantilla compatible activa.' : 'Selecciona plantilla y categoría para este producto.' }];
      return MARKETPLACE_ADAPTERS[id].prepare(p, template, category).issues;
    });
    if (!products.length) issues.push({ marketplaceId: id, productId: '', productName: '', code: 'products', message: 'El lote no contiene productos recuperables.' });
    if (!available.length && !issues.length) issues.push({ marketplaceId: id, productId: '', productName: '', code: 'template', message: 'Falta plantilla compatible activa.' });
    return { marketplaceId: id, compatibleTemplates: available.length, ready: issues.length === 0, issues };
  });
  return { clientName: client.name, products, templates, categories, channels };
}
/** Read-only validation; never serializes or saves a workbook. */
export async function validateTemplateCoordinates(context: Context, channel: MarketplaceId) {
  const groups = new Map<string, Array<{ product: MasterProduct; category: SpreadsheetTemplateCategory; rows: ReturnType<typeof MARKETPLACE_ADAPTERS[MarketplaceId]['prepare']>['rows'] }>>();
  for (const product of context.products) {
    const data = product.marketplaces[channel]; const template = context.templates.find(t => t.id === data?.templateId && templateUsable(t, channel));
    const category = context.categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
    if (!template || !category) throw new Error('Plantilla o categoría no disponible.');
    const adapted = MARKETPLACE_ADAPTERS[channel].prepare(product, template, category);
    if (adapted.issues.length) throw new Error(adapted.issues.map(i => `${i.productName}: ${i.message}`).join('\n'));
    const list = groups.get(template.id!) || []; list.push({ product, category, rows: adapted.rows }); groups.set(template.id!, list);
  }
  const plans: Array<{ template: SpreadsheetTemplate; buffer: Buffer; patches: SheetPatch[] }> = [];
  const seenSkus = new Map<string, string>();
  for (const [templateId, entries] of groups) {
    const template = context.templates.find(t => t.id === templateId)!;
    if (!template.storagePath.startsWith(`client_spreadsheets/${context.scope.clientId}/`)) throw new Error('Ruta de plantilla fuera del cliente.');
    const [buffer] = await admin.storage().bucket().file(template.storagePath).download();
    if (plans.reduce((size, plan) => size + plan.buffer.length, 0) + buffer.length > 64 * 1024 * 1024) throw new Error('Las plantillas seleccionadas superan 64 MB; selecciona menos lotes.');
    if (createHash('sha256').update(buffer).digest('hex') !== template.templateFingerprint) throw new Error('El original cambió; importa una nueva versión.');
    const inspection = await inspectWorkbookPackage(buffer);
    if (inspection.warnings.length) throw new Error(inspection.warnings.join(' '));
    const patches: SheetPatch[] = [];
    const cellMaps = new Map<string, Map<string, CellPatch>>();
    const existingCells = new Map(inspection.sheets.map(sheet => [sheet.name, new Map([...sheet.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m => [xmlAttrs(m[0].match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r, m[0]]))]));
    // Blank sample/product values on every operative sheet, preserving formulas and all auxiliary sheets.
    for (const category of context.categories.filter(c => c.templateId === templateId)) {
      const sheet = inspection.sheets.find(s => s.name === category.sheetName);
      if (!sheet) throw new Error('Hoja operativa ausente.');
      const cells = [...sheet.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].flatMap(m => {
        const address = xmlAttrs(m[0].match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r;
        const parts = address?.match(/^([A-Z]+)([1-9]\d*)$/);
        return parts && Number(parts[2]) >= category.rowStart && category.columns.some(c => c.letter === parts[1]) && !/<f(?:\s|>)/.test(m[0]) && /<(?:v|is)\b/.test(m[0]) ? [{ address, value: '' }] : [];
      });
      cellMaps.set(sheet.name, new Map(cells.map(cell => [cell.address, cell])));
      if (cells.length) patches.push({ sheetName: sheet.name, cells: [], styleRow: category.rowStart });
    }
    const rowNumbers = new Map<string, number>();
    for (const { category, rows } of entries) {
      const sheet = inspection.sheets.find(s => s.name === category.sheetName);
      if (!sheet) throw new Error('Hoja no disponible.');
      let patch = patches.find(s => s.sheetName === category.sheetName);
      if (!patch) { patch = { sheetName: category.sheetName, cells: [], styleRow: category.rowStart }; patches.push(patch); }
      for (const row of rows) {
        const skuColumn = category.columns.find(column => template.exportConfig?.mappings[category.id!]?.[column.key]?.source === 'variant.sku');
        const sku = skuColumn ? row.values[skuColumn.key] : '';
        if (sku && seenSkus.has(sku)) throw new Error(`SKU duplicado entre productos o variantes: ${sku}.`);
        if (sku) seenSkus.set(sku, row.variantId);
        const rowNumber = rowNumbers.get(sheet.name) || category.rowStart;
        for (const column of category.columns) {
          const value = row.values[column.key] || ''; const address = `${column.letter}${rowNumber}`;
          // Formula columns belong to the template, not to the exported product data.
          const formulaCell = existingCells.get(sheet.name)?.get(address);
          if (formulaCell && /<f(?:\s|>)/.test(formulaCell)) { if (value) throw new Error(`No se puede escribir sobre la fórmula ${address}.`); continue; }
          const applicable = sheet.validations.filter(v => v.ranges.some(r => rangeContains(r, address)));
          const sameColumn = sheet.validations.filter(v => v.ranges.some(r => rangeContains(r, `${column.letter}${category.rowStart}`)));
          if (value && sameColumn.length && !applicable.length) throw new Error(`${sheet.name}!${address}: fuera del rango de validación original; divide la exportación.`);
          const valuesByLetter = Object.fromEntries(category.columns.map(c => [c.letter, row.values[c.key] || '']));
          for (const v of applicable) if (value && !validationAccepts(inspection, v, address, value, valuesByLetter)) throw new Error(`${sheet.name}!${address}: validación no resuelta o valor inválido.`);
          cellMaps.get(sheet.name)!.set(address, { address, value, type: template.exportConfig?.mappings[category.id!]?.[column.key]?.dataType });
        }
        rowNumbers.set(sheet.name, rowNumber + 1);
      }
    }
    for (const patch of patches) patch.cells = [...cellMaps.get(patch.sheetName)!.values()];
    if (patches.reduce((sum, patch) => sum + patch.cells.length, 0) > 200000) throw new Error('El libro supera 200000 celdas de salida. Selecciona menos productos.');
    assertPatchableCells(inspection, patches);
    plans.push({ template, buffer, patches });
  }
  return plans;
}
export async function previewMarketplaceExport(input: MarketplaceExportScope, uid: string) {
  const context = await loadExportContext(input, uid); const preview = previewExportContext(context);
  for (const channel of preview.channels.filter(c => c.ready)) try { await validateTemplateCoordinates(context, channel.marketplaceId); } catch (e) {
    channel.ready = false; channel.issues.push({ marketplaceId: channel.marketplaceId, code: 'workbook_validation', message: (e as Error).message });
  }
  return preview;
}
export async function downloadMarketplaceExport(input: DownloadMarketplaceExportRequest, uid: string): Promise<DownloadMarketplaceExportResponse> {
  const scope = normalizeExportScope(input); const requestId = validId(input?.requestId);
  if (!Array.isArray(input.marketplaceIds) || !input.marketplaceIds.length || input.marketplaceIds.length > 4 || !input.marketplaceIds.every(isMarketplaceId)) throw new HttpsError('invalid-argument', 'Destinos inválidos.');
  const channels = [...new Set(input.marketplaceIds)].sort();
  const context = await loadExportContext(scope, uid);
  if (channels.some(id => !context.client.marketplaces?.[id]?.enabled)) throw new HttpsError('permission-denied', 'Marketplace deshabilitado.');
  const db = getAppFirestore(); const key = createHash('sha256').update(`${uid}:${scope.clientId}:${requestId}`).digest('hex');
  const ref = db.collection('marketplaceExportRequests').doc(key);
  const signature = JSON.stringify({ ...scope, channels });
  const cached = await db.runTransaction(async tx => {
    const previous = await tx.get(ref); const data = previous.data();
    if (data && data.signature !== signature) throw new HttpsError('invalid-argument', 'La solicitud ya fue utilizada con otros destinos.');
    if (data?.result && data.expiresAt.toMillis() > Date.now()) return data.result as DownloadMarketplaceExportResponse;
    if (data?.leaseUntil?.toMillis() > Date.now()) throw new HttpsError('aborted', 'La descarga ya está preparándose.');
    tx.set(ref, { clientId: scope.clientId, uid, signature, result: admin.firestore.FieldValue.delete(), leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 600000), expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000) }, { merge: true });
    return null;
  });
  if (cached) return cached;
  try {
    const files: Array<{ name: string; buffer: Buffer }> = []; const failures: DownloadMarketplaceExportResponse['failures'] = []; const exportedMarketplaces: MarketplaceId[] = [];
    const preview = previewExportContext(context);
    for (const channel of channels) {
      try {
        const readiness = preview.channels.find(c => c.marketplaceId === channel)!;
        if (!readiness.ready) throw new Error(readiness.issues.map(i => `${i.productName || channel}: ${i.message}`).join('\n'));
        const plans = await validateTemplateCoordinates(context, channel);
        const channelFiles = [];
        for (const plan of plans) {
          channelFiles.push({ name: `${sanitizeSpreadsheetFileName(context.client.name).slice(0, 35)}-${sanitizeSpreadsheetFileName(scope.batchIds[0]).slice(0, 30)}${scope.batchIds.length > 1 ? `-y-${scope.batchIds.length - 1}-lotes` : ''}-${channel}-${sanitizeSpreadsheetFileName(plan.template.name).slice(0, 35)}-${plan.patches.filter(p => p.cells.some(c => c.value)).map(p => sanitizeSpreadsheetFileName(p.sheetName)).join('-').slice(0, 45)}-v${plan.template.exportConfig!.version}-${plan.template.id!}.xlsx`, buffer: await patchWorkbookCells(plan.buffer, plan.patches) });
          if ([...files, ...channelFiles].reduce((size, file) => size + file.buffer.length, 0) > 64 * 1024 * 1024) throw new Error('Los archivos superan 64 MB; selecciona menos destinos o lotes.');
        }
        files.push(...channelFiles); exportedMarketplaces.push(channel);
      } catch (e) { failures.push({ marketplaceId: channel, message: (e as Error).message.slice(0, 12000) }); }
    }
    const expiresAt = Date.now() + 15 * 60000;
    let result: DownloadMarketplaceExportResponse = { fileName: null, downloadUrl: null, expiresAt, failures, exportedMarketplaces };
    if (files.length) {
      let buffer = files[0].buffer; let fileName = files[0].name;
      if (files.length > 1) { const zip = new JSZip(); files.forEach(file => zip.file(file.name, file.buffer)); buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); fileName = `${sanitizeSpreadsheetFileName(context.client.name)}-marketplaces-${requestId.slice(0, 12)}.zip`; }
      if (buffer.length > 64 * 1024 * 1024) throw new HttpsError('resource-exhausted', 'La descarga supera 64 MB; selecciona menos lotes.');
      const path = `client_spreadsheet_exports/${scope.clientId}/${key}/${fileName}`;
      const file = admin.storage().bucket().file(path);
      await ref.update({ artifactPath: path, artifactPaths: admin.firestore.FieldValue.arrayUnion(path) });
      await file.save(buffer, { contentType: files.length > 1 ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', metadata: { cacheControl: 'private,no-store', metadata: { marketplaceTemporary: 'true', expiresAt: String(expiresAt) } } });
      const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAt, responseDisposition: `attachment; filename="${fileName}"` });
      result = { ...result, fileName, downloadUrl: url };
    }
    await ref.update({ result, leaseUntil: admin.firestore.Timestamp.fromMillis(0), expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt) });
    return result;
  } catch (error) { await ref.update({ leaseUntil: admin.firestore.Timestamp.fromMillis(0) }); throw error; }
}
