import { assertOrganizerWorkflowAccess, readProductWorkflow } from '../organizer/productWorkflow';
import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Batch, Client, DownloadMarketplaceExportRequest, DownloadMarketplaceExportResponse, Job, MasterProduct, MarketplaceExportIssue, MarketplaceExportPreview, MarketplaceExportPreviewRequest, MarketplaceExportScope, ProductDraft, SpreadsheetTemplate, SpreadsheetTemplateCategory, StoredMasterProduct } from '../../../shared/src/types';
import { canUseSpreadsheetTemplate } from '../../../shared/src/types';
import { isMarketplaceSquareField, marketplaceSquareCandidates, MARKETPLACE_ADAPTERS } from '../../../shared/src/marketplaceExport/adapters';
import { MARKETPLACES, isMarketplaceId, type MarketplaceId } from '../../../shared/src/marketplaces';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { getAppFirestore } from '../firebase/appFirestore';
import { validId } from '../manglar/access';
import { getManglarContext } from '../manglar/context';
import { applyStoredMasterProduct, jobMasterProductId, projectMasterProducts } from './masterProducts';
import { inspectWorkbookPackage, patchWorkbookCells, assertPatchableCells, rangeContains, type SheetPatch, type CellPatch, xmlAttrs, validationAccepts } from './ooxmlWorkbook';
import { applySharedSheinBrands, isSharedSheinPath, loadSharedSheinTemplates, sheinCategoryCode } from './sharedSheinCatalog';
import { repairSheinWorkbook } from './sheinWorkbook';
import { sanitizeSpreadsheetFileName } from './batchSpreadsheetExport';
import { applyMarketplacePublication, attachMarketplacePublications, publishMarketplaceImage } from './marketplaceImages';
import { applyOrganizerSource, applyOrganizerVariantOverrides, assignOrganizerImages, loadOrganizerProducts } from './organizerProducts';
import { applyMarketplaceAutofill, resolveMarketplaceCategories, resolveMarketplaceCopy } from './marketplaceAutofill';
import { getGeminiGarmentViewClassificationModel } from '../config/runtime';
import { digest } from '../organizer/drive';
import { catalogDigest } from '../catalog/model';
import { prepareMarketplaceSquares, type MarketplaceSquareRequest } from './marketplaceSquares';
import { enqueueMarketplacePrecompute, marketplacePrecomputeRunning } from './marketplacePrecomputeState';

export const MAX_CATALOG_EXPORT_PRODUCTS = 50;
/**
 * Export limits, sized for one Drive update of ~1000 photos (≈500 articles, ≈3000 jobs, several batches) and
 * measured on the shared SHEIN workbook (83 columns): 6000 rows = 498 000 cells assemble in ~22 s with ~680 MB
 * RSS, within the 1 GiB / 540 s of previewMarketplaceExports and downloadMarketplaceExports.
 */
export const EXPORT_LIMITS = { batches: 50, jobs: 12_000, jobsPerBatch: 6000, products: 2000, variants: 6000, cells: 500_000 } as const;
const PAGE = 500;
/** Reads a query in pages ordered by id, failing past `max` documents instead of loading an unbounded set. */
export async function readPaged(query: FirebaseFirestore.Query, max: number, message: string) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    const ordered = query.orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    const page = await (last ? ordered.startAfter(last) : ordered).get();
    docs.push(...page.docs);
    if (docs.length > max) throw new HttpsError('resource-exhausted', message);
    if (page.size < PAGE) return docs;
    last = page.docs.at(-1);
  }
}
/** A catalog product that has no generation yet still exports the data stored in its master record. */
export function standaloneCatalogProduct(id: string, stored: StoredMasterProduct): MasterProduct {
  const thumbnail = stored.catalog?.thumbnailPath;
  return { id, clientId: stored.clientId, garmentId: id, batchIds: [], values: { ...stored.values }, evidence: { ...stored.catalog?.evidence },
    variants: stored.variants?.length ? stored.variants : [{ id, values: {} }], legacyDrafts: [],
    originalImages: thumbnail ? [{ storagePath: thumbnail, fileName: stored.values.name || id }] : [],
    approvedImages: [], generatedImages: [], pendingImages: 0, marketplaces: {}, revision: 0 };
}
/**
 * One export row per canonical product, so a SKU is never written twice. When a master record has several
 * generations (legacy projections), the one with most approved photos is exported: its images, jobs and
 * publications stay tied to the garment and batch they belong to, which image publication verifies.
 */
export function mergeCatalogProjections(products: MasterProduct[]) {
  const kept = new Map<string, MasterProduct>();
  for (const product of products) {
    const key = product.canonicalProductId || product.id;
    const current = kept.get(key);
    if (!current || product.approvedImages.length > current.approvedImages.length) kept.set(key, product);
  }
  return [...kept.values()];
}
/** Human file stem: batches for a batch export, the product (or product count) for a catalog export. */
export function exportFileStem(scope: MarketplaceExportScope, products: MasterProduct[]) {
  if (scope.catalogProductIds) {
    const first = sanitizeSpreadsheetFileName(products[0]?.values.name || products[0]?.id || 'producto').slice(0, 30);
    return products.length > 1 ? `${first}-y-${products.length - 1}-productos` : first;
  }
  return `${sanitizeSpreadsheetFileName(scope.batchIds[0]).slice(0, 30)}${scope.batchIds.length > 1 ? `-y-${scope.batchIds.length - 1}-lotes` : ''}`;
}
export function normalizeExportScope(input: MarketplaceExportScope): MarketplaceExportScope {
  const clientId = validId(input?.clientId);
  if (input?.catalogProductIds !== undefined) {
    const ids = input.catalogProductIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CATALOG_EXPORT_PRODUCTS) throw new HttpsError('invalid-argument', `Selecciona entre 1 y ${MAX_CATALOG_EXPORT_PRODUCTS} productos.`);
    if (input.batchIds !== undefined && (!Array.isArray(input.batchIds) || input.batchIds.length)
      || input.masterProductId !== undefined || input.organizerContext !== undefined || input.includeOrganizerRun !== undefined)
      throw new HttpsError('invalid-argument', 'La exportación desde el catálogo se define solo por productos.');
    return { clientId, batchIds: [], catalogProductIds: [...new Set(ids.map(validId))].sort() };
  }
  if (!Array.isArray(input?.batchIds) || !input.batchIds.length || input.batchIds.length > EXPORT_LIMITS.batches) throw new HttpsError('invalid-argument', `Selecciona entre 1 y ${EXPORT_LIMITS.batches} lotes.`);
  const batchIds = [...new Set(input.batchIds.map(validId))].sort();
  const masterProductId = input.masterProductId === undefined ? undefined : validId(input.masterProductId);
  if (input.organizerContext === undefined) return { clientId, batchIds, ...(masterProductId ? { masterProductId } : {}),
    ...(input.includeOrganizerRun === true && batchIds.length === 1 && !masterProductId ? { includeOrganizerRun: true } : {}) };
  const origin = input.organizerContext;
  if (origin?.clientId !== clientId || batchIds.length !== 1 || !masterProductId)
    throw new HttpsError('invalid-argument', 'La exportación desde la ficha requiere un cliente, producto y lote vinculados.');
  return { clientId, batchIds, masterProductId,
    organizerContext: { clientId, baseProductId: validId(origin.baseProductId), variantId: validId(origin.variantId) },
  };
}
/** Every batch created by the same Organizer update as `batchId` (one per item type), bounded to the export limit. */
export async function organizerRunBatchIds(clientId: string, batchId: string) {
  const db = getAppFirestore();
  const batch = await db.collection('batches').doc(batchId).get();
  const automationJobId = batch.get('clientId') === clientId ? batch.get('automationJobId') as string | undefined : undefined;
  const runId = automationJobId && (await db.collection('automationJobs').doc(automationJobId).get()).get('metadata.organizerRunId');
  if (typeof runId !== 'string' || !runId) return [batchId];
  // A large update is split into several automation jobs (one batch each); all of them form one export.
  const siblings = await db.collection('automationJobs').where('clientId', '==', clientId).where('metadata.organizerRunId', '==', runId).limit(EXPORT_LIMITS.batches).get();
  const ids = siblings.docs.flatMap(doc => [doc.get('batchId'), ...(doc.get('batchIds') || [])]).filter((id): id is string => typeof id === 'string' && Boolean(id));
  return [...new Set([batchId, ...ids])].sort().slice(0, EXPORT_LIMITS.batches);
}
/** `getAll` in pages, so thousands of references never form one oversized request. */
async function getAllPaged(refs: FirebaseFirestore.DocumentReference[]) {
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let index = 0; index < refs.length; index += PAGE) snapshots.push(...await getAppFirestore().getAll(...refs.slice(index, index + PAGE)));
  return snapshots;
}
export async function loadExportContext(input: MarketplaceExportScope, uid: string) {
  const scope = normalizeExportScope(input); await assertHumanClientAccess(uid, scope.clientId);
  if (scope.includeOrganizerRun) scope.batchIds = (await organizerRunBatchIds(scope.clientId, scope.batchIds[0])).map(validId);
  const db = getAppFirestore(); const clientRef = db.collection('clients').doc(scope.clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) throw new HttpsError('not-found', 'Cliente no disponible.');
  const client = { ...clientSnapshot.data(), id: clientSnapshot.id } as Client;
  if (client.status === 'archived') throw new HttpsError('failed-precondition', 'El cliente está archivado.');
  let itemIds: Set<string> | undefined;
  if (scope.organizerContext) {
    const root = await assertOrganizerWorkflowAccess(uid, scope.clientId);
    const product = await readProductWorkflow(root, scope.organizerContext.variantId, scope.organizerContext.baseProductId, scope.batchIds[0]);
    const [generation] = product.generations;
    if (generation.masterProductIds.length !== 1 || generation.masterProductIds[0] !== scope.masterProductId)
      throw new HttpsError('not-found', 'El producto comercial no pertenece a la variante y lote solicitados.');
    itemIds = new Set(generation.itemIds);
  }
  // Catalog exports resolve their batches from each product's generation links (bounded by the same 20-batch limit).
  let selection: { legacyIds: Set<string>; productIds: Set<string>; standalone: MasterProduct[] } | undefined;
  if (scope.catalogProductIds) {
    const snapshots = await db.getAll(...scope.catalogProductIds.map(id => clientRef.collection('products').doc(id)));
    const legacyIds = new Set<string>(); const derived = new Set<string>(); const standalone: MasterProduct[] = [];
    for (const snapshot of snapshots) {
      if (!snapshot.exists || snapshot.get('clientId') !== scope.clientId) throw new HttpsError('not-found', 'Producto del catálogo no disponible.');
      const redirect = snapshot.get('catalog.redirectTo');
      if (redirect) throw new HttpsError('failed-precondition', `La ficha ${snapshot.id} fue reemplazada por ${redirect}. Actualiza el catálogo.`);
      const links = await snapshot.ref.collection('generationLinks').limit(21).get();
      if (links.size > 20) throw new HttpsError('resource-exhausted', `${snapshot.get('values.name') || snapshot.id} tiene más de 20 generaciones. Expórtalo desde sus lotes.`);
      if (!links.size) { standalone.push(standaloneCatalogProduct(snapshot.id, snapshot.data() as StoredMasterProduct)); continue; }
      for (const link of links.docs) {
        if (link.get('clientId') !== scope.clientId) throw new HttpsError('permission-denied', 'Generación fuera del cliente.');
        derived.add(validId(link.get('batchId'))); legacyIds.add(validId(link.get('legacyProductId')));
      }
    }
    if (derived.size > EXPORT_LIMITS.batches) throw new HttpsError('resource-exhausted', `Los productos elegidos suman más de ${EXPORT_LIMITS.batches} lotes. Selecciona menos productos.`);
    scope.batchIds = [...derived].sort();
    selection = { legacyIds, productIds: new Set(scope.catalogProductIds), standalone };
  }
  const batches: Batch[] = []; const jobs: Job[] = []; const drafts: ProductDraft[] = [];
  for (const id of scope.batchIds) {
    const ref = db.collection('batches').doc(id); const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get('clientId') !== scope.clientId) throw new HttpsError('permission-denied', 'Lote fuera del cliente seleccionado.');
    await assertHumanClientAccess(uid, snapshot.get('clientId'));
    batches.push({ ...snapshot.data(), id: snapshot.id } as Batch);
    const tooLarge = `El lote supera ${EXPORT_LIMITS.jobsPerBatch} trabajos o fichas por exportación.`;
    const [jobDocs, draftDocs] = await Promise.all([readPaged(db.collection('jobs').where('batchId', '==', id), EXPORT_LIMITS.jobsPerBatch, tooLarge),
      readPaged(ref.collection('productDrafts'), EXPORT_LIMITS.jobsPerBatch, tooLarge)]);
    const js = { docs: jobDocs }; const ds = { docs: draftDocs };
    const include = (data: FirebaseFirestore.QueryDocumentSnapshot) => !itemIds || itemIds.has(data.get('garmentId'));
    if (itemIds && js.docs.some(job => !include(job) && job.get('clientId') === scope.clientId &&
        jobMasterProductId(batches.at(-1)!, job.data() as Job) === scope.masterProductId))
      throw new HttpsError('failed-precondition', 'El producto comercial comparte trabajos con otro artículo del lote. Abre la exportación del lote para revisar sus variantes.');
    jobs.push(...js.docs.filter(include).map(d => ({ ...d.data(), id: d.id } as Job)));
    drafts.push(...ds.docs.filter(include).map(d => ({ ...d.data(), id: d.id } as ProductDraft)));
    if (jobs.length > EXPORT_LIMITS.jobs) throw new HttpsError('resource-exhausted', `Exporta hasta ${EXPORT_LIMITS.jobs} trabajos por descarga.`);
  }
  const projected = projectMasterProducts(scope.clientId, batches, jobs, drafts);
  let products = selection
    ? [...projected.filter(product => selection.legacyIds.has(product.id) || selection.productIds.has(product.id)), ...selection.standalone]
    : scope.masterProductId ? projected.filter(product => product.id === scope.masterProductId) : projected;
  if (scope.masterProductId && !products.length) throw new HttpsError('not-found', 'Producto no pertenece a los lotes seleccionados.');
  if (products.length > EXPORT_LIMITS.products) throw new HttpsError('resource-exhausted', `Exporta hasta ${EXPORT_LIMITS.products} productos por descarga.`);
  const stored: Record<string, StoredMasterProduct> = {};
  for (const d of await getAllPaged(products.map(p => clientRef.collection('products').doc(p.id)))) if (d.exists) stored[d.id] = d.data() as StoredMasterProduct;
  const aliases = await getAllPaged(products.map(p => clientRef.collection('productAliases').doc(p.id)));
  const targets = [...new Set(aliases.flatMap(alias => alias.get('productId') && alias.get('productId') !== alias.id ? [validId(alias.get('productId'))] : []))];
  const canonical = new Map<string, StoredMasterProduct>();
  for (const target of await getAllPaged(targets.map(id => clientRef.collection('products').doc(id)))) {
    if (target.exists) canonical.set(target.id, target.data() as StoredMasterProduct);
  }
  const variantMaps = new Map<string, Record<string, string>>();
  const mapRefs = products.flatMap(product => {
    const targetId = aliases.find(alias => alias.id === product.id)?.get('productId');
    return targetId && canonical.has(targetId) ? product.batchIds.map(batchId => ({ legacyId: product.id, batchId,
      ref: clientRef.collection('products').doc(targetId).collection('generationLinks').doc(catalogDigest([batchId, product.id])) })) : [];
  });
  if (mapRefs.length) {
    const snapshots = await getAllPaged(mapRefs.map(entry => entry.ref));
    snapshots.forEach((snapshot, index) => variantMaps.set(`${mapRefs[index].legacyId}:${mapRefs[index].batchId}`, snapshot.get('variantMap') || {}));
  }
  const byBatch = new Map(batches.map(batch => [batch.id!, batch]));
  const commerce = await loadOrganizerProducts(client, batches, jobs);
  const jobsByProduct = new Map<string, Job[]>();
  for (const job of jobs) {
    const id = jobMasterProductId(byBatch.get(job.batchId)!, job);
    const group = jobsByProduct.get(id) || [];
    group.push(job);
    jobsByProduct.set(id, group);
  }
  for (const product of products) {
    const scenes = jobsByProduct.get(product.id) || [];
    const scene = scenes[0];
    const automationId = scene && byBatch.get(scene.batchId)?.automationJobId;
    const link = automationId && commerce.get(`automationJobs/${automationId}/organizerCommerce/${scene.garmentId}`);
    if (link) {
      applyOrganizerSource(product, link);
      link.organizer.revision = digest([link.organizer.source, link.organizer.category, product.values, product.variants]);
    }
    const saved = stored[product.id];
    if (saved) {
      applyStoredMasterProduct(product, saved);
      if (link && saved.organizerOverrides && !saved.catalog) {
        product.variants = applyOrganizerVariantOverrides(product.variants, saved.organizerOverrides);
        link.organizer.confirmedIdentity = saved.organizerOverrides.confirmedIdentity === true;
      }
    }
    const targetId = aliases.find(alias => alias.id === product.id)?.get('productId');
    const master = targetId && canonical.get(targetId);
    if (master) {
      if (master.clientId !== scope.clientId) throw new HttpsError('permission-denied', 'Ficha fuera del cliente.');
      // Historical export identity/publications and channel overrides stay on the legacy record.
      product.canonicalProductId = targetId;
      product.values = { ...product.values, ...master.values };
      product.variants = master.variants;
      product.evidence = { ...product.evidence, ...master.catalog?.evidence };
      product.revision = master.revision;
      const mappings = Object.assign({}, ...product.batchIds.map(batchId => variantMaps.get(`${product.id}:${batchId}`) || {})) as Record<string, string>;
      for (const channel of MARKETPLACES) {
        const data = product.marketplaces[channel.id];
        if (data?.rows) product.marketplaces[channel.id] = { ...data, rows: data.rows.map(row => ({ ...row, id: mappings[row.id] || row.id })) };
      }
      if (product.photoAssignments) product.photoAssignments = product.photoAssignments.map(assignment => {
        const job = scenes.find(job => job.id === assignment.jobId);
        const map = variantMaps.get(`${product.id}:${job?.batchId}`) || mappings;
        return { ...assignment, variantId: map[assignment.variantId] || assignment.variantId };
      });
    }
    if (link) assignOrganizerImages(product, scenes, byBatch, client);
  }
  if (selection) {
    // A generation re-associated to another master record no longer belongs to the requested product.
    products = mergeCatalogProjections(products.filter(product => selection.productIds.has(product.canonicalProductId || product.id)));
    const missing = [...selection.productIds].filter(id => !products.some(product => (product.canonicalProductId || product.id) === id));
    if (missing.length) throw new HttpsError('failed-precondition', `No se encontraron las generaciones de ${missing.join(', ')}. Revisa sus lotes en el catálogo.`);
  }
  if (products.reduce((sum, product) => sum + product.variants.length, 0) > EXPORT_LIMITS.variants) throw new HttpsError('resource-exhausted', `Selecciona hasta ${EXPORT_LIMITS.variants} variantes por descarga.`);
  const ts = await clientRef.collection('spreadsheetTemplates').limit(201).get();
  if (ts.size > 200) throw new HttpsError('resource-exhausted', 'El cliente supera 200 versiones de plantilla; contacta al administrador.');
  const templates = ts.docs.map(d => ({ ...d.data(), id: d.id } as SpreadsheetTemplate));
  const shared = client.marketplaces?.shein?.enabled
    ? await loadSharedSheinTemplates(products.flatMap(product => product.marketplaces.shein?.templateId || []))
    : [];
  templates.push(...shared.map(d => ({ ...d.data(), id: d.id }) as SpreadsheetTemplate));
  const categories = (await Promise.all([...ts.docs, ...shared].map(d => d.ref.collection('categories').get()))).flatMap(s => s.docs.map(d => ({ ...d.data(), id: d.id } as SpreadsheetTemplateCategory)));
  for (const category of categories) if (templates.some(template => template.id === category.templateId && template.exportConfig)) category.validationMode = 'template';
  // A deterministic projection reuses the old template only after an administrator explicitly associates it.
  for (const p of products) for (const t of [...templates].sort((a, b) => (b.exportConfig?.version || 0) - (a.exportConfig?.version || 0))) {
    if (!t.exportConfig || !templateUsable(t, t.exportConfig.marketplaceId) || p.marketplaces[t.exportConfig.marketplaceId]) continue;
    const legacy = p.legacyDrafts.find(d => d.templateId === t.id || d.templateId === t.exportConfig?.replacesTemplateId || t.exportConfig?.legacyTemplateIds?.includes(d.templateId));
    if (legacy && t.categoryIds.includes(legacy.categoryId)) p.marketplaces[t.exportConfig.marketplaceId] = { templateId: t.id!, categoryId: legacy.categoryId };
  }
  await attachMarketplacePublications(products, MARKETPLACES.filter(channel => client.marketplaces?.[channel.id]?.enabled).map(channel => channel.id));
  return { scope, client, products, templates, categories, jobsByProduct, batches };
}
type Context = Awaited<ReturnType<typeof loadExportContext>>;
export const templateUsable = (t: SpreadsheetTemplate, channel: MarketplaceId, historicallyLinked = false) =>
  canUseSpreadsheetTemplate(t, historicallyLinked)
  && t.exportConfig?.marketplaceId === channel && t.exportConfig.validationStatus === 'compatible';
type AnalysisLimits = { deadline?: number; retryFailed?: boolean };
function suggestCategories(context: Context, channels: MarketplaceId[], uid: string, analyze = false, apiKey?: string, limits: AnalysisLimits = {}) {
  const inputs = context.products.flatMap(product => {
    if (product.organizer?.source.issue && !product.organizer.confirmedIdentity) return [];
    return channels.flatMap(channel => {
      const assigned = product.marketplaces[channel];
      if (assigned?.categoryId) return [];
      const eligible = context.templates.filter(template => templateUsable(template, channel)
        && (!assigned?.templateId || assigned.templateId === template.id));
      eligible.sort((a, b) => Number(isSharedSheinPath(b)) - Number(isSharedSheinPath(a)) || b.categoryIds.length - a.categoryIds.length
        || (b.exportConfig?.version || 0) - (a.exportConfig?.version || 0) || a.id!.localeCompare(b.id!));
      const options = eligible.flatMap(template =>
        context.categories.filter(category => category.templateId === template.id
          && template.categoryIds.includes(category.id!) && template.exportConfig?.mappings[category.id!])
          .map(category => ({ id: `${template.id}/${category.id}`, templateId: template.id!, categoryId: category.id!, label: category.label,
            identity: channel === 'shein' ? sheinCategoryCode(category.sheetName) || category.id : category.id })));
      const identities = new Set<string | undefined>();
      const candidates = options.filter(candidate => {
        if (identities.has(candidate.identity)) return false;
        identities.add(candidate.identity);
        return true;
      }).map(({ identity: _identity, ...candidate }) => candidate);
      if (!candidates.length || candidates.length > 100) return [];
      candidates.sort((a, b) => a.id.localeCompare(b.id));
      return [{ product, channel, candidates, jobs: context.jobsByProduct.get(product.id) || [], batches: context.batches }];
    });
  });
  return resolveMarketplaceCategories(inputs, { model: getGeminiGarmentViewClassificationModel(), uid, analyze, apiKey, ...limits });
}
async function resolveMarketplaceAutofill(context: Context, channels: MarketplaceId[], uid: string, apiKey?: string, analyze = false, limits: AnalysisLimits = {}) {
  const products = context.products.filter(product => !product.organizer?.source.issue || product.organizer.confirmedIdentity);
  const inputs = products.flatMap(product => {
    return channels.flatMap(channel => {
      const channelData = product.marketplaces[channel];
      const template = context.templates.find(t => t.id === channelData?.templateId && templateUsable(t, channel, true));
      const category = context.categories.find(c => c.templateId === template?.id && c.id === channelData?.categoryId);
      return template && category ? [{ channel, product, template, category, jobs: context.jobsByProduct.get(product.id) || [], batches: context.batches }] : [];
    });
  });
  const options = { model: getGeminiGarmentViewClassificationModel(), uid, apiKey, analyze, ...limits };
  const [choices, listing] = await Promise.all([
    applyMarketplaceAutofill(inputs, options),
    resolveMarketplaceCopy(channels.length ? products.map(product => ({
      product, jobs: context.jobsByProduct.get(product.id) || [], batches: context.batches,
    })) : [], options),
  ]);
  for (const { product, copy } of listing.suggestions) {
    Object.assign(product.values, copy);
    for (const [field, value] of Object.entries(copy)) {
      product.evidence[field] = { source: 'ai', original: value, normalized: value, confidence: null };
    }
  }
  return { pending: choices.pending || listing.pending, incomplete: choices.incomplete || listing.incomplete };
}
export function previewExportContext(context: Context): MarketplaceExportPreview {
  const { client, products, templates, categories } = context;
  const channels = MARKETPLACES.filter(m => client.marketplaces?.[m.id]?.enabled).map(({ id }) => {
    // Readiness is scoped to these products, including their linked history even
    // when no current version remains available for new assignments.
    const available = templates.filter(t => templateUsable(t, id, products.some(p => p.marketplaces[id]?.templateId === t.id)));
    const issues = products.flatMap<MarketplaceExportIssue>(p => {
      const data = p.marketplaces[id]; const template = templates.find(t => t.id === data?.templateId && templateUsable(t, id, true));
      const category = categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
      const issue = (code: string, message: string) => ({ marketplaceId: id, productId: p.id, productName: p.values.name || p.garmentId, code, message });
      const sourceIssues = p.organizer?.source.issue && !p.organizer.confirmedIdentity ? [issue('organizer_identity', p.organizer.source.issue)] : [];
      if (!template || !category) {
        const decision = p.organizer?.category;
        const reason = decision?.marketplaceId === id && !decision.templateId ? decision.reason : null;
        return [...sourceIssues, issue(!available.length ? 'template' : 'category', reason ||
          (!available.length ? 'Falta plantilla compatible activa.' : 'Selecciona plantilla y categoría para este producto.'))];
      }
      return [...sourceIssues, ...MARKETPLACE_ADAPTERS[id].prepare(p, template, category).issues];
    });
    if (!products.length) issues.push({ marketplaceId: id, productId: '', productName: '', code: 'products', message: 'El lote no contiene productos recuperables.' });
    if (!available.length && !issues.length) issues.push({ marketplaceId: id, productId: '', productName: '', code: 'template', message: 'Falta plantilla compatible activa.' });
    return { marketplaceId: id, compatibleTemplates: available.length, ready: issues.every(issue => issue.blocking === false), issues };
  });
  return { clientName: client.name, products, templates, categories, channels };
}
/**
 * A destination is exported when it is ready, or — when the operator chose to skip pending products — with only the products
 * that have no blocking requirement. Destination-level problems (no template) still fail, and so does an empty result.
 */
type SkippedProduct = { productId: string; productName: string; reasons: string[] };
export function splitBlockedProducts(context: Context, readiness: MarketplaceExportPreview['channels'][number], skip: boolean): { context: Context | null; skipped: SkippedProduct[] } {
  if (readiness.ready) return { context, skipped: [] };
  const blocking = readiness.issues.filter(issue => issue.blocking !== false);
  if (!skip || blocking.some(issue => !issue.productId)) return { context: null, skipped: [] };
  const reasons = new Map<string, SkippedProduct>();
  for (const issue of blocking) {
    const productId = issue.productId!;
    const entry: SkippedProduct = reasons.get(productId) || { productId, productName: issue.productName || '', reasons: [] };
    if (entry.reasons.length < 5) entry.reasons.push(issue.message);
    reasons.set(productId, entry);
  }
  const products = context.products.filter(product => !reasons.has(product.id));
  if (!products.length) return { context: null, skipped: [...reasons.values()] };
  return { context: { ...context, products }, skipped: [...reasons.values()] };
}
/** Read-only validation; never serializes or saves a workbook. */
export async function validateTemplateCoordinates(context: Context, channel: MarketplaceId, allowPendingImageUrls = false) {
  const groups = new Map<string, Array<{ product: MasterProduct; template: SpreadsheetTemplate; category: SpreadsheetTemplateCategory; rows: ReturnType<typeof MARKETPLACE_ADAPTERS[MarketplaceId]['prepare']>['rows'] }>>();
  const pendingImages: Array<{ product: MasterProduct; image: MasterProduct['approvedImages'][number] }> = [];
  const squares: MarketplaceSquareRequest[] = [];
  for (const product of context.products) {
    const data = product.marketplaces[channel]; const template = context.templates.find(t => t.id === data?.templateId && templateUsable(t, channel, true));
    const category = context.categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
    if (!template || !category) throw new Error('Plantilla o categoría no disponible.');
    const squareColumn = category.columns.find(column => isMarketplaceSquareField(channel, column.key));
    if (squareColumn) for (const variant of product.variants) {
      if (!marketplaceSquareCandidates(product, variant.id).length || product.marketplaceSquares?.[variant.id]?.url) continue;
      if (!allowPendingImageUrls) throw new Error(`${product.values.name || product.garmentId}: falta el enlace de la foto cuadrada.`);
      squares.push({ product, variantId: variant.id, column: squareColumn });
    }
    const adapted = MARKETPLACE_ADAPTERS[channel].prepare(product, template, category);
    const blocking = adapted.issues.filter(issue => issue.blocking !== false);
    if (blocking.length) throw new Error(blocking.map(i => `${i.productName}: ${i.message}`).join('\n'));
    if (adapted.pendingImageOutputIds.length) {
      if (!allowPendingImageUrls) throw new Error(`${product.values.name || product.garmentId}: faltan enlaces de las fotos aprobadas.`);
      const outputIds = new Set(adapted.pendingImageOutputIds);
      for (const image of product.approvedImages) if (outputIds.delete(image.outputId)) pendingImages.push({ product, image });
    }
    // Shared SHEIN categories published from the same official workbook are filled in that single workbook (one upload file).
    const groupKey = channel === 'shein' && isSharedSheinPath(template) ? `shared:${template.storagePath}` : template.id!;
    const list = groups.get(groupKey) || []; list.push({ product, template, category, rows: adapted.rows }); groups.set(groupKey, list);
  }
  const plans: Array<{ template: SpreadsheetTemplate; buffer: Buffer; patches: SheetPatch[] }> = [];
  const seenSkus = new Map<string, string>();
  const originals = new Map<string, Buffer>();
  for (const entries of groups.values()) {
    const groupTemplates = [...new Map(entries.map(entry => [entry.template.id!, entry.template])).values()];
    const template = groupTemplates.length === 1 ? groupTemplates[0]
      : { ...groupTemplates[0], name: `SHEIN · ${groupTemplates.length} categorías` };
    const templateIds = new Set(groupTemplates.map(item => item.id!));
    const sharedShein = channel === 'shein' && isSharedSheinPath(template);
    if (!sharedShein && !template.storagePath.startsWith(`client_spreadsheets/${context.scope.clientId}/`)) throw new Error('Ruta de plantilla fuera del cliente.');
    const original = originals.get(template.storagePath) || (await admin.storage().bucket().file(template.storagePath).download())[0];
    originals.set(template.storagePath, original);
    if (createHash('sha256').update(original).digest('hex') !== template.templateFingerprint) throw new Error('El original cambió; importa una nueva versión.');
    let buffer = channel === 'shein' && !sharedShein ? await repairSheinWorkbook(original) : original;
    if (sharedShein) buffer = await applySharedSheinBrands(buffer, entries.flatMap(entry => entry.rows.map(row => row.values.brand_code)));
    if (plans.reduce((size, plan) => size + plan.buffer.length, 0) + buffer.length > 64 * 1024 * 1024) throw new Error('Las plantillas seleccionadas superan 64 MB; selecciona menos lotes.');
    const inspection = await inspectWorkbookPackage(buffer);
    if (inspection.warnings.length) throw new Error(inspection.warnings.join(' '));
    const patches: SheetPatch[] = [];
    const cellMaps = new Map<string, Map<string, CellPatch>>();
    const existingCells = new Map(inspection.sheets.map(sheet => [sheet.name, new Map([...sheet.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m => [xmlAttrs(m[0].match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r, m[0]]))]));
    // Blank sample/product values on every operative sheet, preserving formulas and all auxiliary sheets.
    for (const category of context.categories.filter(c => templateIds.has(c.templateId))) {
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
    for (const { category, rows, template: entryTemplate } of entries) {
      const sheet = inspection.sheets.find(s => s.name === category.sheetName);
      if (!sheet) throw new Error('Hoja no disponible.');
      let patch = patches.find(s => s.sheetName === category.sheetName);
      if (!patch) { patch = { sheetName: category.sheetName, cells: [], styleRow: category.rowStart }; patches.push(patch); }
      for (const row of rows) {
        const skuColumn = category.columns.find(column => entryTemplate.exportConfig?.mappings[category.id!]?.[column.key]?.source === 'variant.sku');
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
          cellMaps.get(sheet.name)!.set(address, { address, value, type: isMarketplaceSquareField(channel, column.key) ? 'text' : entryTemplate.exportConfig?.mappings[category.id!]?.[column.key]?.dataType });
        }
        rowNumbers.set(sheet.name, rowNumber + 1);
      }
    }
    for (const patch of patches) patch.cells = [...cellMaps.get(patch.sheetName)!.values()];
    if (patches.reduce((sum, patch) => sum + patch.cells.length, 0) > EXPORT_LIMITS.cells) throw new Error(`El libro supera ${EXPORT_LIMITS.cells} celdas de salida. Selecciona menos productos.`);
    assertPatchableCells(inspection, patches);
    plans.push({ template, buffer, patches });
  }
  return { plans, pendingImages, squares };
}
/** Runs `work` over `items` with bounded concurrency; false when the deadline left items unprocessed. */
export async function inParallel<T>(items: T[], size: number, deadline: number, work: (item: T) => Promise<void>) {
  let index = 0;
  let complete = true;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      if (Date.now() > deadline) { complete = false; return; }
      await work(items[index++]);
    }
  }));
  return complete;
}
/**
 * Private background preparation of an export (categories, Gemini autofill and SHEIN squares), run
 * when a batch finishes. Results are cached privately (marketplaceAutofill and square crops), so a later
 * slice — and the export panel — reuse it. Failed analyses stay failed until an operator retries them.
 */
export async function precomputeMarketplaceExport(input: MarketplaceExportScope, uid: string, apiKey: string, deadline: number) {
  const context = await loadExportContext(input, uid);
  const enabled = MARKETPLACES.filter(({ id }) => context.client.marketplaces?.[id]?.enabled).map(({ id }) => id);
  const counts = { products: context.products.length, published: 0, squares: 0, failures: 0 };
  if (!enabled.length || !context.products.length) return { pending: false, counts };
  const limits = { deadline };
  const classification = await suggestCategories(context, enabled, uid, true, apiKey, limits);
  const autofill = await resolveMarketplaceAutofill(context, enabled, uid, apiKey, true, limits);
  if (classification.pending || autofill.pending || Date.now() > deadline) return { pending: true, counts };
  const squares = enabled.includes('shein') ? context.products.flatMap(product => {
    const data = product.marketplaces.shein;
    const template = context.templates.find(t => t.id === data?.templateId && templateUsable(t, 'shein', true));
    const category = context.categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
    const column = category?.columns.find(c => isMarketplaceSquareField('shein', c.key));
    return column ? product.variants.filter(variant => marketplaceSquareCandidates(product, variant.id).length && !product.marketplaceSquares?.[variant.id]?.url)
      .map(variant => ({ product, variantId: variant.id, column })) : [];
  }) : [];
  const squaresDone = await inParallel([...new Set(squares.map(square => square.product))], 4, deadline, async product => {
    try { await prepareMarketplaceSquares(squares.filter(square => square.product === product), uid, { apiKey, publish: false }); counts.squares++; }
    catch (error) { counts.failures++; console.warn('Marketplace precompute square failed', { productId: product.id, message: (error as Error).message?.slice(0, 200) }); }
  });
  // Public copies require an explicit operator authorization in download/publishMarketplaceImages.
  return { pending: !squaresDone, counts };
}
/** Without `analyzeAutofill` only cached Gemini choices are used, so the panel opens at once and reports pending analyses. */
export async function previewMarketplaceExport(input: MarketplaceExportPreviewRequest, uid: string, apiKey?: string) {
  const context = await loadExportContext(input, uid);
  const enabled = MARKETPLACES.filter(({ id }) => context.client.marketplaces?.[id]?.enabled).map(({ id }) => id);
  // While the background preparation of these batches runs, opening the panel never starts its own analyses.
  const background = await marketplacePrecomputeRunning(context.scope);
  const retryFailed = input?.retryFailedAutofill === true;
  const analyze = (input?.analyzeAutofill === true || retryFailed) && !background;
  const classification = await suggestCategories(context, enabled, uid, analyze, apiKey, { retryFailed });
  const squareRequests = enabled.includes('shein') ? context.products.flatMap(product => {
    const data = product.marketplaces.shein;
    const template = context.templates.find(t => t.id === data?.templateId && templateUsable(t, 'shein', true));
    const category = context.categories.find(c => c.templateId === template?.id && c.id === data?.categoryId);
    const column = category?.columns.find(c => isMarketplaceSquareField('shein', c.key));
    return column ? product.variants.map(variant => ({ product, variantId: variant.id, column })) : [];
  }) : [];
  const [autofill, squares] = await Promise.all([
    resolveMarketplaceAutofill(context, enabled, uid, apiKey, analyze, { retryFailed }),
    prepareMarketplaceSquares(squareRequests, uid, { apiKey: analyze ? apiKey : undefined }),
  ]);
  const preview = previewExportContext(context);
  if (autofill.incomplete || squares.incomplete) preview.autofillIncomplete = true;
  if (classification.pending || autofill.pending || squares.pending && !analyze) preview.autofillPending = true;
  if (background) preview.autofillBackground = true;
  for (const channel of preview.channels.filter(c => c.ready)) try { await validateTemplateCoordinates(context, channel.marketplaceId, true); } catch (e) {
    channel.ready = false; channel.issues.push({ marketplaceId: channel.marketplaceId, code: 'workbook_validation', message: (e as Error).message });
  }
  return preview;
}
export async function downloadMarketplaceExport(input: DownloadMarketplaceExportRequest, uid: string, apiKey?: string): Promise<DownloadMarketplaceExportResponse> {
  const scope = normalizeExportScope(input); const requestId = validId(input?.requestId);
  if (!Array.isArray(input.marketplaceIds) || !input.marketplaceIds.length || input.marketplaceIds.length > 4 || !input.marketplaceIds.every(isMarketplaceId)) throw new HttpsError('invalid-argument', 'Destinos inválidos.');
  const channels = [...new Set(input.marketplaceIds)].sort();
  const context = await loadExportContext(scope, uid);
  if (channels.some(id => !context.client.marketplaces?.[id]?.enabled)) throw new HttpsError('permission-denied', 'Marketplace deshabilitado.');
  const db = getAppFirestore(); const key = createHash('sha256').update(`${uid}:${scope.clientId}:${requestId}`).digest('hex');
  const ref = db.collection('marketplaceExportRequests').doc(key);
  const signature = JSON.stringify({ ...scope, channels, ...(input.skipBlockedProducts === true ? { skipBlockedProducts: true } : {}) });
  const cached = await db.runTransaction(async tx => {
    const previous = await tx.get(ref); const data = previous.data();
    if (data && data.signature !== signature) throw new HttpsError('invalid-argument', 'La solicitud ya fue utilizada con otros destinos.');
    if (data?.result && data.expiresAt.toMillis() > Date.now()) return data.result as DownloadMarketplaceExportResponse;
    if (data?.leaseUntil?.toMillis() > Date.now()) throw new HttpsError('aborted', 'La descarga ya está preparándose.');
    tx.set(ref, { clientId: scope.clientId, uid, signature, result: admin.firestore.FieldValue.delete(), leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 600000), expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000) }, { merge: true });
    return null;
  });
  if (cached) return cached;
  // Publication stops early enough to assemble and upload the workbook within the 540 s of the callable.
  const publishDeadline = Date.now() + 360_000;
  try {
    const files: Array<{ name: string; buffer: Buffer }> = []; const failures: DownloadMarketplaceExportResponse['failures'] = []; const exportedMarketplaces: MarketplaceId[] = [];
    const skippedProducts: NonNullable<DownloadMarketplaceExportResponse['skippedProducts']> = [];
    await suggestCategories(context, channels, uid);
    await resolveMarketplaceAutofill(context, channels, uid);
    const preview = previewExportContext(context);
    for (const channel of channels) {
      try {
        const readiness = preview.channels.find(c => c.marketplaceId === channel)!;
        const split = splitBlockedProducts(context, readiness, input.skipBlockedProducts === true);
        if (!split.context) {
          skippedProducts.push(...split.skipped.map(item => ({ ...item, marketplaceId: channel })));
          throw new Error(readiness.issues.filter(i => i.blocking !== false).map(i => `${i.productName || channel}: ${i.message}`).join('\n'));
        }
        let channelContext = split.context;
        const skipped = [...split.skipped];
        // With skipBlockedProducts, a product whose marketplace images cannot be prepared is left out instead of failing the file.
        const dropProduct = (product: MasterProduct, error: unknown) => {
          if (input.skipBlockedProducts !== true) throw error;
          channelContext = { ...channelContext, products: channelContext.products.filter(item => item.id !== product.id) };
          skipped.push({ productId: product.id, productName: product.values.name || product.garmentId, reasons: [(error as Error).message.slice(0, 500)] });
          if (!channelContext.products.length) throw error;
        };
        let { plans, pendingImages, squares } = await validateTemplateCoordinates(channelContext, channel, true);
        if (pendingImages.length || squares.length) {
          // Background preparation keeps crops private. Publish missing URLs only under this request’s authorization.
          if (input.authorizePublicImages !== true) throw new Error('Autoriza la publicación de las fotos aprobadas al descargar desde el Catálogo.');
          await assertHumanClientAccess(uid, scope.clientId);
          const squareProducts = [...new Set(squares.map(square => square.product))];
          const squaresDone = await inParallel(squareProducts, 4, publishDeadline, async product => {
            try { await prepareMarketplaceSquares(squares.filter(square => square.product === product), uid, { apiKey, publish: true }); }
            catch (error) { dropProduct(product, error); }
          });
          const imagesDone = await inParallel(pendingImages, 8, publishDeadline, async ({ product, image }) => {
            if (!channelContext.products.includes(product)) return;
            try {
              applyMarketplacePublication(product, await publishMarketplaceImage(product, image, channel, uid));
            } catch (error) {
              console.error('Marketplace export image publication failed', { clientId: product.clientId, outputId: image.outputId, marketplaceId: channel, error });
              const detail = error instanceof HttpsError ? ` ${error.message}` : '';
              dropProduct(product, new Error(`${product.values.name || product.garmentId}: no se pudo preparar el enlace de una foto aprobada.${detail} Vuelve a intentar la descarga.`));
            }
          });
          if (!squaresDone || !imagesDone) {
            // MCP work must retain the exact approved operation budget. The regular
            // background queue has its own lifecycle and cannot inherit that approval.
            if (!getManglarContext()?.budgetId)
              await enqueueMarketplacePrecompute(scope.clientId, context.scope.batchIds, uid).catch(() => undefined);
            throw new Error('Las fotos para el marketplace todavía se están preparando en segundo plano. Vuelve a descargar en unos minutos.');
          }
          ({ plans } = await validateTemplateCoordinates(channelContext, channel));
        }
        const channelFiles = [];
        for (const plan of plans) {
          channelFiles.push({ name: `${sanitizeSpreadsheetFileName(context.client.name).slice(0, 35)}-${exportFileStem(context.scope, context.products)}-${channel}-${sanitizeSpreadsheetFileName(plan.template.name).slice(0, 35)}-${plan.patches.filter(p => p.cells.some(c => c.value)).map(p => sanitizeSpreadsheetFileName(p.sheetName)).join('-').slice(0, 45)}-v${plan.template.exportConfig!.version}-${plan.template.id!}.xlsx`, buffer: await patchWorkbookCells(plan.buffer, plan.patches) });
          if ([...files, ...channelFiles].reduce((size, file) => size + file.buffer.length, 0) > 64 * 1024 * 1024) throw new Error('Los archivos superan 64 MB; selecciona menos destinos o lotes.');
        }
        files.push(...channelFiles); exportedMarketplaces.push(channel); skippedProducts.push(...skipped.map(item => ({ ...item, marketplaceId: channel })));
      } catch (e) { failures.push({ marketplaceId: channel, message: (e as Error).message.slice(0, 12000) }); }
    }
    const expiresAt = Date.now() + 15 * 60000;
    let result: DownloadMarketplaceExportResponse = { fileName: null, downloadUrl: null, expiresAt, failures, exportedMarketplaces, ...(skippedProducts.length ? { skippedProducts } : {}) };
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
