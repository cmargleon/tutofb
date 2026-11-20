import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { FieldPath, type DocumentReference } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as xlsx from 'xlsx';
import { type OrganizerBaseProduct, type OrganizerCommercialVariant, type OrganizerPhoto, type OrganizerProductRow, type OrganizerVariant } from '../../../shared/src/types';
import { GEMINI_API_KEY, GOOGLE_PRIVATE_KEY } from '../config/runtime';
import { getSystemConfigDocRef, isOrganizerWatcherEnabled } from '../admin/systemConfig';
import { APP_FIRESTORE_DATABASE_ID, getAppFirestore } from '../firebase/appFirestore';
import { assertDelegatedStamp } from '../manglar/access';
import { ALGORITHM_VERSION, associatePhotos, associationIndex, candidatesIn, groupProductRows, identityFromFilename, normalize, productVariant, readWorkbook, type TabMapping } from './catalog';
import { digest, fileUrl, FOLDER, isImage, isWorkbook, OrganizerDrive, OrganizerDriveError, versionOf, type DriveEntry } from './drive';
import { appliesCatalog, assertLease, clientRef, configs, documents, runRef, whileLeased, writePages, type StoredConfig, type StoredRun } from './store';
import { analyze, OrganizerBudgetExhausted, reconcileReservations, type VisionPhoto } from './vision';
import { commercialIdentityOf, uncodedGroupName } from '../../../shared/src/organizerIdentity';
import { interpretStructure, rankCandidates, matchObservation } from './interpretation';
import { photoDecisionKey, planFile } from './planning';
import { automateNewPhotos } from './automation';
import { viewFromFileName } from './viewHints';
import { compare } from './fingerprint';
import { watch } from './watch';
import { associateByBaseCode, baseCodeVariantIssues, buildBaseCodeIndex, contentVersionOf } from './baseCode';
import { identityModeOf, resolveBaseVariants, selectVariantReferences } from './baseCodeVision';
import { scaledRunLimits } from './limits';

const sliceMs = 380_000;
const leaseMs = 560_000;
type RunFile = { entry: DriveEntry; added?: boolean; changed?: boolean; error?: string | null };
export type PhotoState = OrganizerPhoto & { hasConflict: boolean; version: string; contentVersion?: string; visionKey?: string | null; baseVisionKey?: string | null;
  /** Near-duplicate hash keyed by content version; persisted so automation never downloads a photo twice. */
  differenceHash?: { key: string; value: string | null };
  kind?: string; quality?: number; visualConfidence?: number; visualColor?: string; visualLabel?: string; algorithm: string; updatedAt: number };
const inventoryFingerprint = (files: RunFile[]) => digest(files.map(file => compare(file.entry)).sort());
const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 350) : 'Error de ejecución.';
const assetId = (file: DriveEntry) => digest([file.id, versionOf(file)]);
const clean = <T extends object>(data: T): T => JSON.parse(JSON.stringify(data));

async function inventory(drive: OrganizerDrive, config: StoredConfig, run: StoredRun, doc: DocumentReference, lease: string, deadline: number) {
  const folders = doc.collection('scanFolders');
  const files = doc.collection('files');
  if (!run.cursor) {
    const sources = await drive.originals(config.sourceIds);
    await whileLeased(doc, lease, tx => {
      for (const source of sources) tx.set(folders.doc(source.id), { entry: { ...source, path: [source.name], sourceId: source.id, ancestorIds: [] as string[] }, page: '', done: false });
      tx.update(doc, { cursor: 'started' });
    });
  }
  while (Date.now() < deadline) {
    const next = (await folders.where('done', '==', false).limit(1).get()).docs[0];
    if (!next) {
      await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'catalog', cursor: null }));
      return;
    }
    const data = next.data() as { entry: DriveEntry; page: string };
    const page = await drive.children(data.entry, data.page);
    await whileLeased(doc, lease, tx => {
      for (const file of page.files) {
        if (file.trashed || file.appProperties?.organizerTenant || !file.parents?.includes(data.entry.id)) continue;
        const entry = { ...file, path: [...data.entry.path, file.name], sourceId: data.entry.sourceId, ancestorIds: [...(data.entry.ancestorIds || []), data.entry.id] };
        tx.set(files.doc(file.id), { entry });
        if (file.mimeType === FOLDER) tx.set(folders.doc(file.id), { entry, page: '', done: false });
      }
      tx.update(next.ref, { page: page.nextPageToken || '', done: !page.nextPageToken });
    });
  }
}

async function loadRows(drive: OrganizerDrive, doc: DocumentReference, file: DriveEntry, mappings?: Map<string, TabMapping>) {
  await drive.assertSource(file);
  const cached = await doc.get();
  if (!cached.exists) {
    for await (const { tab, rows } of readWorkbook(drive, file, mappings)) {
      await writePages(doc.collection('rows'), rows.map(row => ({ id: digest([tab.id, row.line]), value: row })));
      await doc.collection('tabs').doc(tab.id).set(tab);
    }
    await drive.assertSource(file);
    await doc.set({ version: versionOf(file), fileId: file.id, parsedAt: Date.now() });
  }
  const rows: OrganizerProductRow[] = [];
  for await (const row of documents(doc.collection('rows'))) rows.push(row.data() as OrganizerProductRow);
  return { rows, tabs: (await doc.collection('tabs').get()).docs.map(tab => tab.data()) };
}
const getCatalogFiles = async (doc: DocumentReference) => {
  const files: RunFile[] = [];
  for await (const file of documents(doc.collection('files'))) files.push(file.data() as RunFile);
  return files;
};
async function catalog(drive: OrganizerDrive, root: DocumentReference, doc: DocumentReference, run: StoredRun, lease: string, deadline: number) {
  const files = await getCatalogFiles(doc);
  const fingerprint = inventoryFingerprint(files);
  const apply = appliesCatalog(run.mode);
  if (run.mode === 'generate' && run.photoIds.some(id => !files.some(file => file.entry.id === id && isImage(file.entry))))
    throw new Error('Una foto seleccionada no es una imagen original de los orígenes autorizados.');
  if (run.expectedFingerprint && run.expectedFingerprint !== fingerprint)
    throw new Error('Las fuentes cambiaron después de la simulación. Revisa un plan nuevo antes de aplicar.');
  if (run.createdBy === 'watcher' && run.fingerprint !== fingerprint) {
    await whileLeased(doc, lease, tx => {
      tx.update(doc, { status: 'cancelled', completedAt: Date.now(), updatedAt: Date.now(), lease: null, leaseUntil: 0,
        error: 'El origen cambió durante la ventana de agrupación. Se reprogramará el lote.' });
      tx.update(root, { observedFingerprint: fingerprint, observedAt: Date.now(), activeRunId: null, watcher: 'collecting' });
    });
    return;
  }
  const rows: OrganizerProductRow[] = [];
  const seenTabs = new Set<string>();
  const seenPhotos = new Set<string>();
  const counts: Record<string, number> = { files: files.length, folders: 0, new: 0, modified: 0, photos: 0, workbooks: 0,
    products: 0, variants: 0, skcs: 0, skus: 0, associated: 0, unassigned: 0, conflicts: 0, errors: 0 };
  const imported = doc.collection('imports');
  const workbookFiles = files.filter(file => isWorkbook(file.entry));
  for (const file of workbookFiles) {
    const audit = imported.doc(file.entry.id);
    if (!(await audit.get()).exists) {
      if (Date.now() > deadline) return;
      try {
        const cache = (apply ? root : doc).collection('workbooks').doc(digest([assetId(file.entry), ALGORITHM_VERSION]));
        await loadRows(drive, cache, file.entry);
        await audit.set({ cacheId: cache.id, error: null });
      } catch (error) {
        if (error instanceof OrganizerDriveError && (error.status >= 500 || error.status === 429)) throw error;
        await audit.set({ cacheId: null, error: message(error) });
        file.error = message(error);
        await doc.collection('files').doc(file.entry.id).update({ error: message(error) });
      }
    }
  }
  for (const file of files) {
    const current = file.entry;
    if (current.mimeType === FOLDER) counts.folders++;
    if (isWorkbook(current)) counts.workbooks++;
    if (isImage(current)) { counts.photos++; seenPhotos.add(current.id); }
  }
  for await (const audit of documents(imported)) {
    const item = audit.data();
    if (!item.cacheId) { counts.errors++; continue; }
    const cache = (apply ? root : doc).collection('workbooks').doc(item.cacheId);
    for await (const tab of documents(cache.collection('tabs'))) {
      seenTabs.add(tab.id);
      await (apply ? root : doc).collection('tabs').doc(tab.id).set(tab.data());
    }
    for await (const rowDoc of documents(cache.collection('rows'))) {
      rows.push(rowDoc.data() as OrganizerProductRow);
    }
  }
  if (apply && counts.errors) throw new Error('Hay fuentes de catálogo inaccesibles o ilegibles. Se conserva el catálogo anterior; corrige el acceso y vuelve a simular.');
  const priorVersions = new Map<string, string>();
  for await (const file of documents(root.collection('sourceFiles'))) priorVersions.set(file.id, file.data().fingerprint);
  const fileUpdates = files.map(file => {
    const before = priorVersions.get(file.entry.id);
    if (before === undefined) counts.new++;
    else if (before !== compare(file.entry)) counts.modified++;
    return { id: file.entry.id, value: { ...file, added: before === undefined, changed: before !== undefined && before !== compare(file.entry) } };
  });
  await writePages(doc.collection('files'), fileUpdates);
  const prior = new Map<string, OrganizerVariant>();
  for await (const item of documents(root.collection('products'))) prior.set(item.id, item.data() as OrganizerVariant);
  if (appliesCatalog(run.mode)) {
    const initial = groupProductRows(rows);
    const initialVariants = [...initial.groups].map(([id, entries]) => productVariant(id, entries, prior.get(id), initial.anchors.get(id)));
    const tabs = (await root.collection('tabs').get()).docs.filter(tab => seenTabs.has(tab.id)).map(tab => tab.data() as import('../../../shared/src/types').OrganizerTab);
    const structure = await interpretStructure(root, doc, lease, (await root.get()).data()!.model, files.map(file => file.entry), tabs, initialVariants, deadline);
    if (!structure.complete) return;
    for (const file of workbookFiles) {
      if (![...structure.mappings.keys()].some(key => tabs.some(tab => tab.id === key && tab.fileId === file.entry.id))) continue;
      const cache = root.collection('workbooks').doc(digest([assetId(file.entry), ALGORITHM_VERSION, [...structure.mappings]]));
      const interpreted = await loadRows(drive, cache, file.entry, structure.mappings);
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].fileId === file.entry.id) rows.splice(i, 1);
      rows.push(...interpreted.rows);
      await writePages(root.collection('tabs'), interpreted.tabs.map(tab => ({ id: String(tab.id), value: tab })));
    }
    const unresolved = new Set((await root.collection('tabs').get()).docs.filter(tab => seenTabs.has(tab.id) &&
      String(tab.data().issue || '').startsWith('Sin encabezados')).map(tab => tab.id));
    if ([...prior.values()].some(product => product.sourceTabs?.some(tab => unresolved.has(tab))))
      throw new Error('Cambió la estructura de una fuente conocida y no se pudo interpretar. Se conserva el catálogo anterior para revisión.');
  }
  const { groups: group, anchors } = groupProductRows(rows);
  const variants = [...group].map(([id, entries]) => productVariant(id, entries, prior.get(id), anchors.get(id)));
  const byIdentifier = new Map<string, Set<string>>();
  for (const variant of variants) for (const skc of variant.skcs) {
    const ids = byIdentifier.get(skc) || new Set<string>();
    ids.add(variant.id); byIdentifier.set(skc, ids);
  }
  for (const variant of variants) if (variant.skcs.some(skc => byIdentifier.get(skc)!.size > 1)) {
    variant.status = 'review';
    variant.issues.push('El SKC aparece en varias variantes incompatibles.');
  }
  const identityMode = identityModeOf((await root.get()).data() as StoredConfig | undefined);
  const baseIndex = identityMode === 'legacy' ? null : buildBaseCodeIndex(variants, rows);
  if (baseIndex) for (const variant of variants) {
    variant.baseDeclared = baseIndex.declared.has(variant.id);
    const extra = identityMode === 'baseCode' ? baseCodeVariantIssues(variant, baseIndex) : [];
    if (extra.length) { variant.issues = [...new Set([...variant.issues, ...extra])].slice(0, 25); variant.status = 'review'; }
  }
  const previousPhotos = new Map<string, PhotoState>();
  for await (const photo of documents(root.collection('photos'))) previousPhotos.set(photo.id, photo.data() as PhotoState);
  const photoFiles = files.filter(file => isImage(file.entry));
  const manual = new Map<string, string | null>();
  const decisions = new Map<string, FirebaseFirestore.DocumentData>();
  for await (const decision of documents(root.collection('decisions'))) {
    const value = decision.data();
    decisions.set(decision.id, value);
    const entry = photoFiles.find(file => file.entry.id === decision.id)?.entry;
    const decided = variants.filter(variant => (value.variantIds || [value.variantId].filter(Boolean)).includes(variant.id));
    // Base-code mode also honors path-independent decisions, so moving a file never expires a human review.
    const validKeys = entry ? [photoDecisionKey(entry, decided), ...(identityMode === 'baseCode' ? [photoDecisionKey(entry, decided, true)] : [])] : [];
    if (entry && validKeys.includes(value.contextKey) &&
      (value.variantIds || [value.variantId].filter(Boolean)).every((id: string) => group.has(id)))
      manual.set(decision.id, value.variantId);
  }
  type Association = ReturnType<typeof associatePhotos> extends Map<string, infer A> ? Omit<A, 'identityState'> & { identityState: PhotoState['identityState']; baseId?: string | null;
    baseCodeIdentity?: OrganizerPhoto['baseCodeIdentity'] } : never;
  const filenameIndex = associationIndex(variants);
  const associations: Map<string, Association> = identityMode === 'baseCode' && baseIndex
    ? associateByBaseCode(photoFiles.map(file => file.entry), baseIndex, manual)
    : associatePhotos(photoFiles.map(file => file.entry), filenameIndex, manual);
  const shadow = identityMode === 'shadow' && baseIndex ? associateByBaseCode(photoFiles.map(file => file.entry), baseIndex, manual) : null;
  const photoUpdates = photoFiles.map(({ entry }) => {
    const association = associations.get(entry.id)!;
    const old = previousPhotos.get(entry.id);
    const version = versionOf(entry);
    const contentVersion = contentVersionOf(entry);
    const sameVersion = old && version === old.version;
    // In base-code mode identity follows content: a move or a metadata-only change keeps the analysis.
    const sameContent = old && (identityMode === 'baseCode' ? (old.contentVersion || old.version) === contentVersion : sameVersion);
    const filenameHasCode = candidatesIn(entry.name, filenameIndex).length > 0;
    const visualMethod = filenameHasCode && old && ['gemini_evidencia', 'gemini_variante'].includes(old.method);
    const stillValid = identityMode === 'baseCode'
      ? association.identityState === 'base' && association.candidates.includes(old?.variantId || '')
      : old?.path.join('/') === entry.path.join('/');
    if (sameContent && visualMethod && !decisions.has(entry.id) && stillValid &&
      old.variantId && variants.some(variant => variant.id === old.variantId && variant.catalogFingerprint === prior.get(variant.id)?.catalogFingerprint))
      Object.assign(association, { variantId: old.variantId, variantIds: [old.variantId], identityState: 'variant', method: old.method, evidence: old.evidence, confidence: old.confidence, issue: old.issue });
    const preserveVision = sameContent && old.variantId === association.variantId;
    const ranked = rankCandidates({ ...entry, candidates: association.candidates }, variants)
      .filter(candidate => identityMode !== 'baseCode' || association.candidates.includes(candidate.id));
    const decision = decisions.get(entry.id);
    const staleDecision = decision && !manual.has(entry.id);
    if (manual.has(entry.id)) {
      association.variantIds = decision?.variantIds || (association.variantId ? [association.variantId] : []);
      association.identityState = association.variantIds.length > 1 ? 'shared' : association.variantId ? 'variant' : 'unresolved';
    }
    if (staleDecision) Object.assign(association, { variantId: null, variantIds: [], identityState: 'needs_review', method: 'revision_humana_caducada', issue: 'Cambió el contenido, la ruta o el catálogo de una decisión humana. Revisa su vigencia.' });
    if (association.variantId) counts.associated++;
    else counts.unassigned++;
    if (association.issue) counts.conflicts++;
    const value: PhotoState = { id: entry.id, name: entry.name, path: entry.path, sourceUrl: fileUrl(entry),
      copyUrl: null, ...association, hasConflict: Boolean(association.issue), version, algorithm: ALGORITHM_VERSION, updatedAt: Date.now(),
      candidates: identityMode === 'baseCode' || !filenameHasCode ? association.candidates : ranked.map(candidate => candidate.id), candidateDetails: filenameHasCode ? ranked : [], provisionalCode: identityFromFilename(entry)?.skc || null,
      contentVersion, baseId: association.baseId ?? null,
      ...(identityMode === 'baseCode' && association.baseCodeIdentity ? { baseCodeIdentity: association.baseCodeIdentity } : {}),
      ...(shadow ? { baseCodeIdentity: shadow.get(entry.id)!.baseCodeIdentity } : {}),
      concordance: preserveVision ? old.concordance ?? null : null, baseVisionKey: preserveVision ? old.baseVisionKey ?? null : null,
      ...(preserveVision && old.visualColor !== undefined ? { visualColor: old.visualColor, visualLabel: old.visualLabel || '' } : {}),
      referenceEligibleFor: manual.has(entry.id) ? decision?.referenceEligibleFor || (association.variantId ? [association.variantId] : []) : association.variantId ? [association.variantId] : [],
      reviewedBy: manual.has(entry.id) ? decision?.uid || old?.reviewedBy || null : null, view: preserveVision ? old.view : null, visionKey: preserveVision ? old.visionKey || null : null,
      kind: preserveVision ? old.kind || 'unknown' : 'unknown', quality: preserveVision ? old.quality || 0 : 0,
      visualConfidence: preserveVision ? old.visualConfidence || 0 : 0,
      ...(preserveVision && old.visualHint ? { visualHint: old.visualHint } : {}),
      ...(old?.differenceHash?.key === contentVersion ? { differenceHash: old.differenceHash } : {}) };
    return { id: entry.id, value };
  });
  const target = apply ? root : doc;
  // Changing a reference's content or identity invalidates the visible approval as well as wizard import.
  const newPhotos = new Map(photoUpdates.map(photo => [photo.id, photo.value]));
  for (const variant of variants) {
    const references = Object.values(variant.references).flat();
    const changed = (id: string) => identityMode === 'baseCode'
      ? (newPhotos.get(id)!.contentVersion || newPhotos.get(id)!.version) !== (previousPhotos.get(id)?.contentVersion || previousPhotos.get(id)?.version)
      : newPhotos.get(id)!.version !== previousPhotos.get(id)?.version;
    if (references.some(id => !newPhotos.has(id) || !newPhotos.get(id)!.variantIds?.includes(variant.id) || changed(id))) {
      variant.referenceState = 'pending'; variant.references = { front: [], back: [], main: [] };
    }
  }
  await writePages(doc.collection('plan'), files.filter(file => file.entry.mimeType !== FOLDER).map(({ entry }) => ({
    id: entry.id, value: planFile(entry, newPhotos.get(entry.id), variants),
  })));
  await writePages(target.collection('photos'), photoUpdates);
  await writePages(target.collection('products'), variants.map(value => ({ id: value.id, value })));
  if (apply) {
    for (const [id, rows] of group) {
      const provenance = root.collection('products').doc(id).collection('provenance');
      const keyed = rows.filter(row => row.line > 0).map(row => ({ id: digest([row.fileId, row.tabId ?? row.tab, row.line]), value: row }));
      await writePages(provenance, keyed);
      const keep = new Set(keyed.map(row => row.id));
      for await (const item of documents(provenance)) if (!keep.has(item.id)) await item.ref.delete();
    }
    const bases = new Map<string, OrganizerBaseProduct>();
    const commerce = new Map<string, OrganizerCommercialVariant>();
    // The master catalog binding lives in productAliases; keep its cached copy across catalog rebuilds.
    const priorBases = new Map<string, OrganizerBaseProduct>();
    if (identityMode !== 'legacy') for await (const item of documents(root.collection('baseProducts'))) priorBases.set(item.id, item.data() as OrganizerBaseProduct);
    for (const variant of variants) {
      const id = digest([variant.base]);
      const previousBase = priorBases.get(id);
      const base = bases.get(id) || { id, code: variant.base, name: variant.name, variants: [],
        ...(baseIndex ? { declared: Boolean(variant.baseDeclared), conflict: baseIndex.conflicts.get(variant.base) || null,
          catalogProductId: previousBase?.catalogProductId ?? null, catalogIssue: previousBase?.catalogIssue ?? null } : {}) };
      base.variants.push(variant.id);
      bases.set(id, base);
      for (const row of group.get(variant.id) || []) {
        if (!row.sku && !row.skc) continue;
        const id = digest([variant.id, row.skc, row.sku, normalize(row.size), normalize(row.pack)]);
        commerce.set(id, { id, variantId: variant.id, skc: row.skc, sku: row.sku, size: row.size, pack: row.pack });
      }
    }
    await writePages(root.collection('baseProducts'), [...bases].map(([id, value]) => ({ id, value })));
    await writePages(root.collection('commercial'), [...commerce].map(([id, value]) => ({ id, value })));
    for (const [collection, keep] of [['products', new Set(group.keys())], ['photos', seenPhotos], ['tabs', seenTabs],
      ['baseProducts', new Set(bases.keys())], ['commercial', new Set(commerce.keys())]] as const) {
      for await (const item of documents(root.collection(collection))) if (!keep.has(item.id)) await item.ref.delete();
    }
  }
  counts.products = new Set(variants.map(variant => variant.base)).size;
  counts.variants = variants.length;
  counts.skcs = new Set(variants.flatMap(variant => variant.skcs)).size;
  counts.skus = new Set(variants.flatMap(variant => variant.skus)).size;
  // Calls and budget scale with the photos this run analyzes (between the configured floor and the client caps),
  // so an unattended update of any size finishes without someone confirming an extension.
  const config = (await root.get()).data() as StoredConfig;
  const analyzed = run.photoIds.length || photoFiles.length;
  const scaled = apply ? scaledRunLimits(analyzed, config, { maxCalls: run.maxCalls, budgetUsd: run.budgetUsd }) : {};
  await whileLeased(doc, lease, tx => tx.update(doc, { fingerprint, counts, ...scaled, phase: apply ? 'vision' : 'report', cursor: null }));
}

async function vision(drive: OrganizerDrive, root: DocumentReference, doc: DocumentReference, config: StoredConfig, run: StoredRun, lease: string, deadline: number) {
  const photos = root.collection('photos');
  const variants = new Map<string, OrganizerVariant>();
  for await (const item of documents(root.collection('products'))) variants.set(item.id, item.data() as OrganizerVariant);
  const allVariants = [...variants.values()];
  const identityMode = identityModeOf(config);
  const contextKey = digest(allVariants.map(product => [product.id, product.catalogFingerprint || '']).sort());
  const analyzePhoto = async (item: FirebaseFirestore.QueryDocumentSnapshot) => {
    const photo = commercialIdentityOf(item.data() as PhotoState);
    const forced = run.photoIds.includes(photo.id) || Boolean(run.variantId && photo.variantIds?.includes(run.variantId));
    const selected = (!run.photoIds.length && !run.variantId) || forced;
    // Base-code mode keys pixel work to content, not location; variant choice has its own per-base key.
    const key = identityMode === 'baseCode'
      ? digest(['base-code-1', photo.contentVersion || photo.version, photo.name, config.model, config.escalationModel, config.minimumConfidence, ALGORITHM_VERSION])
      : digest([photo.version, photo.name, photo.path, photo.variantIds || [], contextKey, config.model, config.escalationModel, config.minimumConfidence, ALGORITHM_VERSION]);
    if (!(selected && (photo.visionKey !== key || (forced && run.mode !== 'generate')))) return;
    try {
      const file = (await doc.collection('files').doc(photo.id).get()).data() as RunFile;
      await drive.assertSource(file.entry);
      const input = [{ file: file.entry, candidateIds: photo.candidates }];
      let result = await analyze(drive, root, doc, lease, config.model, input, [], false);
      let view = result?.photos[0];
      if (view && view.confidence < config.minimumConfidence && config.escalationModel && config.escalationModel !== config.model) {
        const extra = await analyze(drive, root, doc, lease, config.escalationModel, input, [], false);
        if (extra && (extra.photos[0]?.confidence || 0) > view.confidence) { result = extra; view = extra.photos[0]; }
      }
      await drive.assertSource(file.entry);
      if (result && view) {
        const association = identityMode !== 'baseCode' && !photo.reviewedBy && photo.method !== 'revision_humana_caducada' && !photo.variantId && photo.identityState !== 'shared' && view.confidence >= config.minimumConfidence ?
          await matchObservation(root, doc, lease, config.model, photo, allVariants, result) : null;
        const variantId = association?.variantId || photo.variantId;
        const ids = variantId ? [variantId] : photo.variantIds || [];
        const evidence = association?.variantId ? [...photo.evidence, `Píxeles: ${result.label}`, ...(association.ranked[0]?.evidence || [])] : photo.evidence;
        const update = { kind: result.kind, quality: view.quality, visualConfidence: view.confidence, view: viewFromFileName(photo.name) ?? view.view, variantId, variantIds: ids, evidence,
          visualColor: result.color, visualLabel: result.label,
          referenceEligibleFor: photo.reviewedBy ? photo.referenceEligibleFor || (variantId ? [variantId] : []) : variantId ? [variantId] : [],
          identityState: ids.length > 1 ? 'shared' : variantId ? 'variant' : association?.baseId ? 'base' : photo.identityState || 'unresolved',
          baseId: association ? association.baseId : photo.baseId || null, visionKey: key, ...(association ? { candidates: association.ranked.map(candidate => candidate.id), candidateDetails: association.ranked } : {}),
          ...(association?.variantId ? { method: 'gemini_evidencia', confidence: view.confidence, issue: null, hasConflict: false } : {}),
          ...(association && !variantId ? { issue: `${association.baseId ? `Producto base ${association.baseId}; variante por confirmar. ` : ''}${'reason' in association && association.reason || photo.issue || 'Sin evidencia suficiente para asignar.'}`, hasConflict: true } : {}),
          ...(!variantId && result.label ? { visualHint: { groupId: uncodedGroupName(photo.name) ? digest([file.entry.sourceId, file.entry.parents?.[0], uncodedGroupName(photo.name)]) : digest([file.entry.parents?.[0], normalize(result.label), normalize(result.color), normalize(result.pack), result.kind]),
            label: result.label, color: result.color, pack: result.pack, kind: result.kind } } : {}) };
        await whileLeased(doc, lease, tx => tx.update(item.ref, update));
      } else await whileLeased(doc, lease, tx => tx.update(item.ref, { visionKey: key, hasConflict: true, issue: photo.issue || 'Análisis visual no resuelto; consulta el ledger antes de reintentar.' }));
    } catch (error) {
      if (error instanceof OrganizerBudgetExhausted) throw error;
      await whileLeased(doc, lease, tx => tx.update(item.ref, { hasConflict: true, issue: photo.issue || `Error de análisis visual: ${message(error)}` }));
    }
  };
  // Bounded parallelism keeps thousands of photos within a few slices without overrunning Drive or Gemini.
  const parallel = identityMode === 'baseCode' ? 4 : 1;
  let chunk: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const flush = async () => {
    if (!chunk.length) return;
    await Promise.all(chunk.map(analyzePhoto));
    const last = chunk.at(-1)!.id;
    chunk = [];
    await whileLeased(doc, lease, tx => tx.update(doc, { cursor: last }));
  };
  for await (const item of documents(photos, run.cursor)) {
    if (Date.now() > deadline) { await flush(); return; }
    chunk.push(item);
    if (chunk.length >= parallel) await flush();
  }
  await flush();
  if (identityMode === 'baseCode') {
    if (!await resolveBaseVariants(drive, root, doc, config, run, lease, deadline, allVariants)) return;
    await selectVariantReferences(root, doc, config, run, lease, variants);
    await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'automation', cursor: null }));
    return;
  }
  const byVariant = new Map<string, PhotoState[]>();
  for await (const item of documents(photos)) {
    const photo = commercialIdentityOf(item.data() as PhotoState);
    if (photo.issue) continue;
    const associated = photo.variantIds || (photo.variantId ? [photo.variantId] : []);
    for (const id of photo.referenceEligibleFor || (photo.variantId ? [photo.variantId] : [])) {
      if (!associated.includes(id)) continue;
      const set = byVariant.get(id) || [];
      set.push(photo); byVariant.set(id, set);
    }
  }
  for (const [id, product] of variants) {
    if (product.referenceState === 'approved' || product.referenceState === 'rejected') continue;
    const content = new Set<string>();
    const all = (byVariant.get(id) || []).filter(photo => photo.view && photo.view !== 'unknown' && (photo.visualConfidence || 0) >= config.minimumConfidence && (photo.quality || 0) >= config.minimumConfidence)
      .sort((a, b) => (b.quality || 0) - (a.quality || 0)).filter(photo => {
        const key = photo.duplicateOf || photo.id;
        if (content.has(key)) return false;
        content.add(key); return true;
      });
    const garments = all.filter(photo => photo.kind === 'garment');
    const objects = all.filter(photo => photo.kind === 'product');
    const choose = (set: PhotoState[], view?: VisionPhoto['view']) => set.filter(photo => !view || photo.view === view).slice(0, 2).map(photo => photo.id);
    const main = (choose(objects, 'front')[0] || choose(objects)[0]);
    const refs = { front: choose(garments, 'front'), back: choose(garments, 'back'), main: main ? [main] : [],
      complementary: choose(objects.filter(photo => photo.id !== main && photo.view !== 'front')) };
    const ok = garments.length ? Boolean(refs.front.length && refs.back.length) && !objects.length : Boolean(refs.main.length);
    const issue = garments.length && (!refs.front.length || !refs.back.length) ? 'Faltan vistas frontal o trasera.'
      : garments.length && objects.length ? 'Tipo de artículo contradictorio.' : 'Referencias insuficientes.';
    const issues = ok ? product.issues : [...new Set([...product.issues, issue])];
    await root.collection('products').doc(id).update({ references: refs, referenceState: ok ? 'suggested' : 'pending', issues,
      status: ok ? product.status : 'review' });
  }
  await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'automation', cursor: null }));
}

async function finish(root: DocumentReference, doc: DocumentReference, config: StoredConfig, run: StoredRun, lease: string) {
  const apply = appliesCatalog(run.mode);
  const data = appliesCatalog(run.mode) ? root : doc;
  const files = await getCatalogFiles(doc);
  const counts = { ...run.counts, associated: 0, unassigned: 0, conflicts: 0, errors: 0,
    selectedReferences: 0, missingReferences: 0, productsWithoutPhotos: 0, sharedPhotos: 0, humanReviewed: 0, identityNeedsReview: 0, inaccessibleSources: 0 };
  for (const file of files) {
    if (file.error) counts.errors++;
  }
  const products: OrganizerVariant[] = [];
  const photos: OrganizerPhoto[] = [];
  for await (const item of documents(data.collection('products'))) {
    const product = item.data() as OrganizerVariant;
    products.push(product);
    if (product.referenceState === 'suggested' || product.referenceState === 'approved') counts.selectedReferences++;
    else counts.missingReferences++;
    if (product.issues.length) counts.conflicts++;
  }
  for await (const item of documents(data.collection('photos'))) {
    const photo = item.data() as OrganizerPhoto;
    photos.push(photo);
    if (photo.variantId || photo.variantIds?.length) counts.associated++;
    else counts.unassigned++;
    if ((photo.variantIds?.length || 0) > 1) counts.sharedPhotos++;
    if (photo.reviewedBy) counts.humanReviewed++;
    if (photo.method === 'revision_humana_caducada') counts.identityNeedsReview++;
    if (photo.issue) counts.conflicts++;
  }
  counts.productsWithoutPhotos = products.filter(product => !photos.some(photo => photo.variantIds?.includes(product.id) || photo.variantId === product.id)).length;
  counts.inaccessibleSources = files.filter(file => isWorkbook(file.entry) && file.error).length;
  const reportPath = `organizers/${config.clientId}/runs/${run.id}/report.json`;
  const controlSheetPath = config.controlSheet ? `organizers/${config.clientId}/runs/${run.id}/control.xlsx` : null;
  {
    const ledger = [];
    for await (const entry of documents(doc.collection('ledger'))) ledger.push({ id: entry.id, ...entry.data() });
    const report = { id: run.id, clientId: config.clientId, status: 'completed', elapsedMs: Date.now() - run.createdAt, counts,
      budget: { limit: run.budgetUsd, estimated: run.estimatedUsd, uncertain: run.uncertainUsd, reserved: run.reservedUsd, calls: run.calls, alerts: run.alerts, ledger },
      generationHandoffs: (await doc.collection('generationHandoffs').get()).docs.map(item => item.data()),
      products, photos, files: files.map(file => ({ id: file.entry.id, path: file.entry.path, version: versionOf(file.entry), error: file.error || null })) };
    await admin.storage().bucket().file(reportPath).save(Buffer.from(JSON.stringify(report, null, 2)), {
      resumable: false, metadata: { contentType: 'application/json' },
    });
    if (config.controlSheet) {
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['Métrica', 'Valor'], ...Object.entries(counts),
        ['Gemini estimado USD', run.estimatedUsd], ['Costo incierto USD', run.uncertainUsd], ['Presupuesto USD', run.budgetUsd]]), 'Resumen');
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['Producto', 'Variante', 'SKC', 'SKU', 'Color', 'Tallas', 'Pack', 'FOTO IA', 'UPLOAD', 'PUBLICAR', 'Estado'],
        ...products.map(product => [product.name, product.visual, product.skcs.join(', '), product.skus.join(', '), product.color, product.sizes.join(', '), product.pack, product.documented.photo, product.documented.upload, product.documented.publish, product.status])]), 'Productos');
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['Archivo', 'Ruta', 'Variante', 'Original', 'Revisión'],
        ...photos.map(photo => [photo.name, photo.path.join('/'), photo.variantId || '', photo.sourceUrl, photo.issue || ''])]), 'Fotografías');
      await admin.storage().bucket().file(controlSheetPath!).save(xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
        resumable: false, metadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    }
  }
  if (apply) {
    await writePages(root.collection('sourceFiles'), files.map(file => ({ id: file.entry.id, value: { fingerprint: compare(file.entry), entry: file.entry } })));
    const seen = new Set(files.map(file => file.entry.id));
    for await (const prior of documents(root.collection('sourceFiles'))) if (!seen.has(prior.id)) await prior.ref.delete();
  }
  const now = Date.now();
  await whileLeased(doc, lease, tx => {
    tx.update(doc, { status: 'completed', completedAt: now, updatedAt: now, lease: null, leaseUntil: 0, counts, reportPath, controlSheetPath, reportUrl: null, controlSheetUrl: null });
    tx.update(root, { activeRunId: null, watcher: config.enabled ? 'idle' : 'disabled', watcherError: null, ...(apply ? {
      lastSyncAt: now, lastClassifiedAt: now, processedFingerprint: run.fingerprint,
    } : {}) });
  });
}

async function work(drive: OrganizerDrive, config: StoredConfig, deadline: number) {
  const root = clientRef(config.clientId);
  const doc = runRef(config.clientId, config.activeRunId!);
  const lease = randomUUID();
  const claimed = await getAppFirestore().runTransaction(async tx => {
    const [configDoc, runDoc] = await tx.getAll(root, doc);
    const run = runDoc.data() as StoredRun | undefined;
    if (!run || configDoc.data()?.activeRunId !== run.id || !['queued', 'running'].includes(run.status) || run.leaseUntil > Date.now()) return false;
    tx.update(doc, { status: 'running', lease, leaseUntil: Date.now() + leaseMs, updatedAt: Date.now(), error: null });
    return true;
  });
  if (!claimed) return;
  try {
    const initial = (await doc.get()).data() as StoredRun;
    if (initial.delegated) await assertDelegatedStamp(initial.delegated, config.clientId);
    await reconcileReservations(doc);
    while (Date.now() < deadline) {
      const run = (await doc.get()).data() as StoredRun;
      if (run.status === 'cancelled') return;
      assertLease(run, lease);
      switch (run.phase) {
        case 'inventory': await inventory(drive, config, run, doc, lease, deadline); break;
        case 'catalog': await catalog(drive, root, doc, run, lease, deadline); break;
        // Resume legacy runs through the read-only pipeline.
        case 'copy': await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'vision', cursor: null })); break;
        case 'vision': await vision(drive, root, doc, config, run, lease, deadline); break;
        case 'organize': await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'automation', cursor: null })); break;
        case 'automation': await automateNewPhotos(drive, root, doc, config, run, lease, deadline); break;
        case 'report': await finish(root, doc, config, run, lease); return;
      }
    }
    // The slice ran out of time: organizerRunContinuation picks the run up again right away.
    await whileLeased(doc, lease, (tx, run) => tx.update(doc, { status: 'queued', updatedAt: Date.now(), lease: null, leaseUntil: 0,
      chainedSlices: (run.chainedSlices || 0) + 1 }));
  } catch (error) {
    await whileLeased(doc, lease, tx => {
      const temporary = error instanceof OrganizerDriveError && (error.status === 429 || error.status >= 500);
      const status = error instanceof OrganizerBudgetExhausted ? 'budget_exhausted' : temporary ? 'queued' : 'failed';
      tx.update(doc, { status, updatedAt: Date.now(), lease: null, leaseUntil: 0, error: message(error),
 });
      // A failed run no longer blocks the organizer: it stays resumable, but new runs can start.
      tx.update(root, { watcher: 'error', watcherError: message(error), ...(status === 'failed' ? { activeRunId: null } : {}) });
    }).catch(() => undefined);
  } finally {
    await getAppFirestore().runTransaction(async tx => {
      const current = (await tx.get(doc)).data() as StoredRun | undefined;
      if (current?.lease === lease && ['paused', 'queued'].includes(current.status)) tx.update(doc, { lease: null, leaseUntil: 0 });
    });
  }
}

export const tickOrganizer = async (drive = new OrganizerDrive()) => {
  const deadline = Date.now() + sliceMs;
  const cursor = getAppFirestore().collection('system_config').doc('organizer_scheduler');
  const [position, settings] = await Promise.all([cursor.get(), getSystemConfigDocRef().get()]);
  const start = position.data()?.clientId as string | undefined;
  const watcherEnabled = isOrganizerWatcherEnabled(settings.data());
  const query = configs().orderBy(FieldPath.documentId());
  const snapshot = await (start ? query.startAfter(start) : query).limit(40).get();
  for (const item of snapshot.docs) {
    if (Date.now() > deadline) return;
    const config = item.data() as StoredConfig;
    try {
      const client = await getAppFirestore().collection('clients').doc(config.clientId).get();
      if (!client.exists || client.data()?.status === 'archived') continue;
      const activeRunId = config.activeRunId || (watcherEnabled ? (await watch(drive, config))?.id : undefined);
      if (activeRunId && Date.now() < deadline) {
        await work(drive, { ...config, activeRunId }, Math.min(deadline, Date.now() + 90_000));
      }
    } catch (error) {
      await item.ref.set(clean({ watcher: 'error', watcherError: message(error), lastPollAt: Date.now() }), { merge: true });
    } finally { await cursor.set({ clientId: item.id }); }
  }
  if (snapshot.size < 40) await cursor.set({ clientId: null });
};

/**
 * Base-code clients are watched and advanced every few minutes, so thousands of photos finish in
 * hours instead of waiting for the twice-daily tick. The lease in `work` prevents overlap with the
 * main scheduler. Legacy clients keep the original cadence.
 */
export const continueBaseCodeOrganizers = async (drive = new OrganizerDrive()) => {
  const deadline = Date.now() + sliceMs;
  const watcherEnabled = isOrganizerWatcherEnabled((await getSystemConfigDocRef().get()).data());
  const snapshot = await configs().where('identityMode', '==', 'baseCode').limit(100).get();
  const candidates = snapshot.docs.map(item => item.data() as StoredConfig);
  for (const [index, config] of candidates.entries()) {
    if (Date.now() > deadline) return;
    try {
      const client = await getAppFirestore().collection('clients').doc(config.clientId).get();
      if (!client.exists || client.data()?.status === 'archived') continue;
      const activeRunId = config.activeRunId || (watcherEnabled ? (await watch(drive, config))?.id : undefined);
      const share = Math.max(60_000, (deadline - Date.now()) / Math.max(1, candidates.length - index));
      if (activeRunId && Date.now() < deadline) await work(drive, { ...config, activeRunId }, Math.min(deadline, Date.now() + share));
    } catch (error) {
      await clientRef(config.clientId).set(clean({ watcher: 'error', watcherError: message(error), lastPollAt: Date.now() }), { merge: true });
    }
  }
};

export const organizerContinuation = onSchedule({ schedule: 'every 5 minutes', timeZone: 'America/Mexico_City', retryCount: 0, timeoutSeconds: 540,
  memory: '1GiB', maxInstances: 1, concurrency: 1, secrets: [GOOGLE_PRIVATE_KEY, GEMINI_API_KEY] }, () => continueBaseCodeOrganizers());

export const organizerManualRun = onDocumentCreated({
  document: 'organizers/{clientId}/runs/{runId}', database: APP_FIRESTORE_DATABASE_ID,
  timeoutSeconds: 540, memory: '1GiB', secrets: [GEMINI_API_KEY, GOOGLE_PRIVATE_KEY],
}, async event => {
  // Every human-started run (inventory, simulation, classification or generation) starts immediately.
  const config = (await clientRef(event.params.clientId).get()).data() as StoredConfig | undefined;
  if (config?.activeRunId === event.params.runId) await work(new OrganizerDrive(), config, Date.now() + sliceMs);
});

/**
 * Safety cap on slices chained without a human: 300 slices × ~380 s ≈ 32 h of work, far above the ~2 h that
 * 1000 photos need. A run beyond it keeps its progress and continues with the scheduler (12:00/18:00).
 */
export const MAX_CHAINED_SLICES = 300;

/** Whether a run transition should be worked right away instead of waiting for the scheduler. */
export function shouldContinueRun(before: Partial<StoredRun> | undefined, after: Partial<StoredRun> | undefined) {
  if (!before || !after || after.status !== 'queued') return false;
  // Resumed by an operator.
  if (['paused', 'failed', 'budget_exhausted'].includes(before.status || '')) return true;
  // A slice that ran out of time hands over to the next one, for automatic (watcher) and manual runs alike.
  // Drive throttling (queued with an error) waits for the scheduler.
  return before.status === 'running' && !after.error && (after.chainedSlices || 0) < MAX_CHAINED_SLICES;
}

export const organizerRunContinuation = onDocumentUpdated({
  document: 'organizers/{clientId}/runs/{runId}', database: APP_FIRESTORE_DATABASE_ID,
  timeoutSeconds: 540, memory: '1GiB', secrets: [GEMINI_API_KEY, GOOGLE_PRIVATE_KEY],
}, async event => {
  if (!shouldContinueRun(event.data?.before.data() as StoredRun | undefined, event.data?.after.data() as StoredRun | undefined)) return;
  const config = (await clientRef(event.params.clientId).get()).data() as StoredConfig | undefined;
  if (config?.activeRunId === event.params.runId) await work(new OrganizerDrive(), config, Date.now() + sliceMs);
});

export const organizerScheduler = onSchedule({ schedule: '0 12,18 * * *', timeZone: 'America/Mexico_City', retryCount: 0, timeoutSeconds: 540,
  memory: '1GiB', maxInstances: 1, concurrency: 1, secrets: [GOOGLE_PRIVATE_KEY, GEMINI_API_KEY] }, () => tickOrganizer());
