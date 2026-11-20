import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot, Query, Transaction } from 'firebase-admin/firestore';
import type { Batch, Job, OrganizerLinkCandidates, OrganizerLinkPreview, OrganizerLinkResult, OrganizerPhoto, OrganizerProductRow, OrganizerVariant, StoredMasterProduct } from '../../../shared/src/types';
import { commercialIdentityOf, uncodedGroupName } from '../../../shared/src/organizerIdentity';
import { freeCommercialVariants, pendingCommercialGroup } from '../../../shared/src/organizerLink';
import { getAppFirestore } from '../firebase/appFirestore';
import { baseAliasId, chooseBindingTarget, organizerDraftProduct } from '../catalog/organizerBinding';
import { catalogDigest } from '../catalog/model';
import { assertCatalogSize } from '../catalog/validation';
import { jobMasterProductId } from '../spreadsheets/masterProducts';
import { photoDecisionKey } from './planning';
import { checkedId } from './store';
import { identityModeOf } from './baseCodeVision';
import { digest, versionOf, type DriveEntry } from './drive';
import { resolveCommercialRows } from './commerce';
import { mergeLinkedProduct } from './linkMerge';

// Reads are bounded and run inside the same transaction as confirmation: no partial merges or stale candidate claims.
const MAX_RECORDS = 5000;
async function bounded(query: Query, tx?: Transaction) {
  const result = tx ? await tx.get(query.limit(MAX_RECORDS + 1)) : await query.limit(MAX_RECORDS + 1).get();
  if (result.size > MAX_RECORDS) throw new HttpsError('resource-exhausted', 'El catálogo supera el límite de revisión de vínculo.');
  return result.docs;
}
const read = (ref: FirebaseFirestore.DocumentReference, tx?: Transaction) => tx ? tx.get(ref) : ref.get();
const signature = (docs: DocumentSnapshot[]) => docs.map(doc => [doc.ref.path, doc.updateTime ? [doc.updateTime.seconds, doc.updateTime.nanoseconds] : null]);
const dataPhoto = (doc: DocumentSnapshot) => ({ ...doc.data(), id: doc.id, name: doc.get('name') || '', path: doc.get('path') || [] }) as OrganizerPhoto;
const groupKey = (photo: OrganizerPhoto, entry?: DriveEntry) => catalogDigest([
  entry?.sourceId || '', entry?.parents?.[0] || photo.path.slice(0, -1), uncodedGroupName(photo.name),
]);

async function inventory(clientId: string, photoId: string, tx?: Transaction) {
  const db = getAppFirestore(); const root = db.doc(`organizers/${checkedId(clientId)}`);
  const config = await read(root, tx);
  if (!config.exists) throw new HttpsError('not-found', 'Organizador no disponible.');
  const photos = await bounded(root.collection('photos'), tx);
  const sources = await bounded(root.collection('sourceFiles'), tx);
  const seed = photos.find(doc => doc.id === checkedId(photoId));
  if (!seed || !uncodedGroupName(seed.get('name') || '')) throw new HttpsError('not-found', 'Grupo SINCOD no disponible.');
  const entries = new Map(sources.map(doc => [doc.id, doc.get('entry') as DriveEntry]));
  const groupId = groupKey(dataPhoto(seed), entries.get(seed.id));
  const members = photos.filter(doc => groupKey(dataPhoto(doc), entries.get(doc.id)) === groupId);
  const variants = await bounded(root.collection('products'), tx);
  const allVariants = variants.map(doc => ({ ...doc.data(), id: doc.id }) as OrganizerVariant);
  const record = await read(root.collection('commercialGroups').doc(groupId), tx);
  const own = new Set(members.map(doc => doc.id));
  const free = freeCommercialVariants(allVariants, photos.filter(doc => record.get('state') !== 'linked' || !own.has(doc.id)).map(dataPhoto));
  const provenance = await Promise.all(free.map(variant => bounded(root.collection('products').doc(variant.id).collection('provenance'), tx)));
  const candidates = free.flatMap((variant, index) => {
    const rows = provenance[index].map(doc => doc.data() as OrganizerProductRow);
    if (!rows.some(row => row.line > 0 && row.sourceVersion && (row.skc || row.sku))) return [];
    return [{ variantId: variant.id, name: variant.name, color: variant.color, pack: variant.pack,
      skcs: variant.skcs, skus: variant.skus, sizes: variant.sizes,
      origins: rows.map(row => ({ fileId: row.fileId, fileName: row.fileName, version: row.sourceVersion || '', tab: row.tab, row: row.line })) }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.variantId.localeCompare(b.variantId));
  const group = pendingCommercialGroup(groupId, members.map(dataPhoto), candidates);
  if (record.get('state') === 'linked') {
    const valid = allVariants.some(variant => variant.id === record.get('variantId')) && members.every(doc => doc.get('variantId') === record.get('variantId') && doc.get('reviewedBy') &&
      (!record.get('photoVersions') || record.get('photoVersions')[doc.id] === doc.get('version')));
    group.state = valid ? 'linked' : 'needs_review';
    if (valid) { group.candidates = []; group.message = 'Ficha comercial vinculada'; }
  }
  if (config.get('activeRunId')) { group.severity = 'warning'; group.message = 'Sincronización en curso. Espera a que termine para revisar las filas disponibles.'; group.candidates = []; }
  return { db, root, config, photos, sources, entries, members, variants, provenance, group, record, allVariants };
}

export async function readLinkCandidates(clientId: string, photoId: string): Promise<OrganizerLinkCandidates> {
  return (await inventory(clientId, photoId)).group;
}

async function planLink(clientId: string, photoId: string, variantId: string, tx?: Transaction) {
  const inv = await inventory(clientId, photoId, tx);
  const { db, root, members, entries, group } = inv;
  if (inv.config.get('activeRunId')) throw new HttpsError('failed-precondition', 'Termina la sincronización antes de revisar el vínculo.');
  if (!group.candidates.some(candidate => candidate.variantId === checkedId(variantId)))
    throw new HttpsError('failed-precondition', 'La fila elegida ya no está libre. Actualiza las candidatas.');
  if (members.some(doc => doc.get('reviewedBy') && commercialIdentityOf(dataPhoto(doc)).variantId && doc.get('variantId') !== variantId))
    throw new HttpsError('failed-precondition', 'El grupo ya contiene una asociación humana. Revisa sus excepciones.');
  if (members.some(doc => !entries.get(doc.id))) throw new HttpsError('failed-precondition', 'Falta el origen de una foto del grupo. Sincroniza.');
  const variant = inv.allVariants.find(v => v.id === variantId)!;
  const rowsDocs = await bounded(root.collection('products').doc(variantId).collection('provenance'), tx);
  const clientDoc = await read(db.doc(`clients/${clientId}`), tx);
  if (!clientDoc.exists || clientDoc.get('status') === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
  const commercial = resolveCommercialRows(variant, rowsDocs.map(doc => doc.data() as OrganizerProductRow),
    clientDoc.get('automation.organizerGeneration.sourceColumns') || {}, true);
  if (commercial.issue) throw new HttpsError('failed-precondition', commercial.issue);
  const client = db.doc(`clients/${clientId}`);
  const products = await bounded(client.collection('products'), tx);
  const baseCode = variant.base;
  if (!baseCode) throw new HttpsError('failed-precondition', 'La fila no tiene identidad comercial base.');
  const baseId = digest([baseCode]);
  const alias = await read(client.collection('productAliases').doc(baseAliasId(baseCode)), tx);
  let targetId = alias.get('productId') as string | undefined;
  if (!targetId) {
    const decision = chooseBindingTarget(baseCode, variant, products.map(doc => ({ id: doc.id, data: doc.data() as StoredMasterProduct })));
    if (decision.action === 'issue') throw new HttpsError('failed-precondition', decision.issue);
    targetId = decision.action === 'link' ? decision.productId : `organizer-${catalogDigest([clientId, baseCode]).slice(0, 40)}`;
  }
  let target = products.find(doc => doc.id === targetId);
  for (let hops = 0; target?.get('catalog.redirectTo') && hops < 4; hops++) {
    targetId = target.get('catalog.redirectTo'); target = products.find(doc => doc.id === targetId);
  }
  if (target?.get('catalog.redirectTo') || target?.get('catalog.status') === 'archived' || alias.exists && !target)
    throw new HttpsError('failed-precondition', 'La ficha canónica no está disponible.');
  const targetData = target?.data() as StoredMasterProduct | undefined || organizerDraftProduct(clientId, baseCode, baseId, commercial);
  const automation = await bounded(db.collection('automationJobs').where('clientId', '==', clientId), tx);
  const commerceDocs = (await Promise.all(automation.map(doc => bounded(doc.ref.collection('organizerCommerce'), tx)))).flat();
  const groupPhotos = new Set(members.map(doc => doc.id));
  const commerce = commerceDocs.filter(doc => (doc.get('photos') || []).some((photo: { id: string }) => groupPhotos.has(photo.id)));
  if (commerce.some(doc => (doc.get('photos') || []).some((photo: { id: string; version: string }) =>
    !groupPhotos.has(photo.id) || members.find(member => member.id === photo.id)?.get('version') !== photo.version)))
    throw new HttpsError('failed-precondition', 'Una generación comparte referencias con otro grupo o usa otra versión de las fotos. Revisa la asociación.');
  const generations: { legacyId: string; batchId: string; garmentId: string; jobs: DocumentSnapshot[]; alias: DocumentSnapshot }[] = [];
  const evidenceDocs: DocumentSnapshot[] = [];
  for (const link of commerce) {
    const batches = await bounded(db.collection('batches').where('automationJobId', '==', link.ref.parent.parent!.id), tx);
    evidenceDocs.push(...batches);
    for (const batch of batches) {
      const jobs = (await bounded(db.collection('jobs').where('batchId', '==', batch.id), tx)).filter(doc => doc.get('garmentId') === link.get('itemId'));
      evidenceDocs.push(...jobs);
      if (!jobs.length) continue;
      const legacyId = jobMasterProductId({ ...batch.data(), id: batch.id } as Batch, jobs[0].data() as Job);
      const sourceAlias = await read(client.collection('productAliases').doc(legacyId), tx);
      const routed = sourceAlias.get('productId');
      if (routed && routed !== legacyId && routed !== targetId) throw new HttpsError('failed-precondition', 'La generación ya está vinculada a otra ficha canónica.');
      generations.push({ legacyId, batchId: batch.id, garmentId: link.get('itemId'), jobs, alias: sourceAlias });
    }
  }
  const sourceIds = [...new Set(generations.map(g => g.legacyId))].filter(id => id !== targetId);
  const sourceDocs = products.filter(doc => sourceIds.includes(doc.id) && !doc.get('catalog.redirectTo'));
  const allLinks = (await Promise.all(sourceDocs.map(doc => bounded(doc.ref.collection('generationLinks'), tx)))).flat();
  if (allLinks.some(doc => !generations.some(g => doc.get('batchId') === g.batchId && doc.get('legacyProductId') === g.legacyId)))
    throw new HttpsError('failed-precondition', 'La ficha provisional tiene generaciones ajenas al grupo. Revisa sus asociaciones.');
  const merge = mergeLinkedProduct(targetData, sourceDocs.map(doc => doc.data() as StoredMasterProduct), commercial);
  const targetLinks = await bounded(client.collection('products').doc(targetId!).collection('generationLinks'), tx);
  const publications = (await Promise.all(sourceDocs.map(doc => bounded(doc.ref.collection('marketplaceImages'), tx)))).flat();
  // Publications are keyed by historical product ID and retain their valid Storage paths. Do not copy or rename assets.
  const token = catalogDigest([variantId, targetId, commercial, signature([clientDoc, inv.config, inv.record, alias, ...inv.photos, ...inv.sources,
    ...inv.variants, ...rowsDocs, ...products, ...commerceDocs, ...allLinks, ...targetLinks, ...publications, ...evidenceDocs, ...generations.map(g => g.alias)])]);
  const preview: OrganizerLinkPreview = { group, variantId, productId: targetId!, sourceProductIds: sourceDocs.map(doc => doc.id),
    previewToken: token, conflicts: merge.conflicts, values: commercial };
  return { inv, client, variant, baseCode, baseId, targetId: targetId!, targetData, commercial, sourceDocs, commerce, generations, allLinks, preview };
}

export async function previewCommercialLink(clientId: string, photoId: string, variantId: string): Promise<OrganizerLinkPreview> {
  return (await planLink(clientId, photoId, variantId)).preview;
}

export async function confirmCommercialLink(clientId: string, photoId: string, variantId: string, previewToken: string, requestId: string,
  uid: string, resolutions: Record<string, 'source' | 'target' | 'excel'> = {}): Promise<OrganizerLinkResult> {
  checkedId(requestId);
  if (typeof previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(previewToken) || !resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions) ||
      Object.values(resolutions).some(value => !['source', 'target', 'excel'].includes(value))) throw new HttpsError('invalid-argument', 'Confirmación de vínculo inválida.');
  const db = getAppFirestore();
  const receipt = db.doc(`organizers/${checkedId(clientId)}/linkRequests/${requestId}`);
  return db.runTransaction(async tx => {
    const previous = await tx.get(receipt);
    const requestKey = catalogDigest([photoId, variantId, previewToken, resolutions, uid]);
    if (previous.exists) {
      if (previous.get('requestKey') !== requestKey) throw new HttpsError('already-exists', 'requestId pertenece a otra confirmación.');
      return previous.get('result') as OrganizerLinkResult;
    }
    const p = await planLink(clientId, photoId, variantId, tx);
    if (p.preview.previewToken !== previewToken) throw new HttpsError('aborted', 'Cambió el Excel, las fotos o las fichas. Revisa nuevamente el vínculo.');
    if (p.preview.conflicts.some(conflict => !resolutions[conflict.field])) throw new HttpsError('failed-precondition', 'Resuelve los valores incompatibles antes de confirmar.');
    const merged = mergeLinkedProduct(p.targetData, p.sourceDocs.map(doc => doc.data() as StoredMasterProduct), p.commercial, resolutions).product;
    merged.revision = p.targetData.revision + 1; merged.updatedByUid = uid; merged.updatedAt = Date.now();
    merged.catalog!.manuallyConfirmed = true;
    merged.catalog!.issues = merged.catalog!.issues.filter(issue => issue.kind !== 'possible_duplicate' || !p.sourceDocs.some(doc => doc.id === issue.reference));
    const chosen = merged.variants.filter(row => p.commercial.variants.some(v => v.id === row.id || v.values.sku && v.values.sku === row.values.sku || !v.values.sku && v.values.skc === row.values.skc));
    if (merged.catalog!.photos) merged.catalog!.photos = merged.catalog!.photos.map(photo => ({ ...photo, variantId: merged.variants.some(v => v.id === photo.variantId) ? photo.variantId : chosen[0].id }));
    assertCatalogSize(merged);
    const writes = p.inv.members.length * 3 + p.generations.length * 2 + p.sourceDocs.length + p.commerce.length + 5;
    if (writes > 400) throw new HttpsError('resource-exhausted', 'El grupo supera el tamaño de una vinculación atómica.');
    const result: OrganizerLinkResult = { groupId: p.inv.group.groupId, productId: p.targetId, state: 'linked' };
    const now = Date.now(); const root = p.inv.root;
    tx.set(p.client.collection('products').doc(p.targetId), merged);
    tx.set(p.client.collection('productAliases').doc(baseAliasId(p.baseCode)), { clientId, productId: p.targetId, origin: 'organizer', kind: 'base', baseCode: p.baseCode, baseId: p.baseId, updatedByUid: uid, updatedAt: now }, { merge: true });
    for (const doc of p.inv.members) {
      const entry = p.inv.entries.get(doc.id)!;
      const decision = { variantId, variantIds: [variantId], referenceEligibleFor: [variantId], uid, at: now,
        version: versionOf(entry), contextKey: photoDecisionKey(entry, [p.variant], identityModeOf(p.inv.config.data() as any) === 'baseCode') };
      tx.set(root.collection('decisions').doc(doc.id), decision);
      tx.set(root.collection('reviewHistory').doc(catalogDigest([requestId, doc.id])), { ...decision, photoId: doc.id, type: 'commercial_link', previousVariantId: doc.get('variantId') || null });
      tx.update(doc.ref, { variantId, variantIds: [variantId], baseId: p.baseId, identityState: 'variant', method: 'manual', reviewedBy: uid,
        confidence: 1, issue: null, hasConflict: false, candidates: [], candidateDetails: [], referenceEligibleFor: [variantId], updatedAt: now,
        commercialGroupId: result.groupId, baseCodeIdentity: { baseId: p.baseId, baseCode: p.baseCode, variantId, candidates: [], method: 'codigo_variante', issue: null } });
    }
    const targetVariants = merged.variants;
    for (const generation of p.generations) {
      const old = p.sourceDocs.find(doc => doc.id === generation.legacyId);
      const variantMap: Record<string, string> = {};
      const first = targetVariants.find(row => p.commercial.variants.some(v => v.id === row.id || v.values.sku && v.values.sku === row.values.sku || !v.values.sku && v.values.skc === row.values.skc))!;
      for (const v of p.commercial.variants) variantMap[v.id] = targetVariants.find(row => row.id === v.id || v.values.sku && v.values.sku === row.values.sku || !v.values.sku && v.values.skc === row.values.skc)?.id || first.id;
      for (const variant of (old?.get('variants') || []) as StoredMasterProduct['variants']) {
        const match = targetVariants.find(row => row.values.sku && row.values.sku === variant.values.sku);
        variantMap[variant.id] = match?.id || first.id;
      }
      const prior = p.allLinks.find(doc => doc.get('batchId') === generation.batchId && doc.get('legacyProductId') === generation.legacyId);
      tx.set(p.client.collection('products').doc(p.targetId).collection('generationLinks').doc(catalogDigest([generation.batchId, generation.legacyId])), {
        ...prior?.data(), id: catalogDigest([generation.batchId, generation.legacyId]), clientId, batchId: generation.batchId,
        legacyProductId: generation.legacyId, garmentId: generation.garmentId, draftIds: prior?.get('draftIds') || [],
        organizerReferences: Object.keys(p.commercial.origins), variantMap: { ...prior?.get('variantMap'), ...variantMap },
      }, { merge: true });
      tx.set(generation.alias.ref, { clientId, productId: p.targetId, legacyProductId: generation.legacyId, origin: 'organizer' }, { merge: true });
    }
    for (const source of p.sourceDocs) tx.update(source.ref, { 'catalog.redirectTo': p.targetId, 'catalog.listed': false, marketplaces: merged.marketplaces });
    for (const link of p.commerce) tx.update(link.ref, { organizerVariantId: variantId, source: p.commercial, catalogBinding: { productId: p.targetId, baseCode: p.baseCode }, commercialGroupId: result.groupId });
    tx.set(root.collection('commercialGroups').doc(result.groupId), { ...result, variantId, photoIds: p.inv.members.map(doc => doc.id),
      photoVersions: Object.fromEntries(p.inv.members.map(doc => [doc.id, doc.get('version')])), catalogFingerprint: catalogDigest(p.commercial), confirmedBy: uid, confirmedAt: now, previewToken });
    tx.create(receipt, { requestKey, result, at: now });
    return result;
  });
}
