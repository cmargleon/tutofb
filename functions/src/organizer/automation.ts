import { isOrganizerGenerationEnabled } from '../../../shared/src/automationConfig';
import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationInput, ClientAutomationConfig, OrganizerPhoto } from '../../../shared/src/types';
import { assertUserRoles } from '../auth/roles';
import { getSystemConfigDocRef, sanitizeSystemConfig } from '../admin/systemConfig';
import { createAutomation } from '../automation/persistence';
import { DEFAULT_AUTOMATION_BUDGET, effectiveMaxBudgetUsd } from '../../../shared/src/automationPolicy';
import { AutomationAttentionError } from '../automation/imports';
import { freezeOriginal, generationSourceKey } from './source';
import { assertDelegatedStamp } from '../manglar/access';
import { withManglarContext } from '../manglar/context';
import { getAppFirestore } from '../firebase/appFirestore';
import { digest, isImage, versionOf, type DriveEntry, type OrganizerDrive } from './drive';
import { documents, whileLeased, type StoredConfig, type StoredRun } from './store';
import { readOrganizerCommerce } from './commerce';
import { identityModeOf } from './baseCodeVision';
import { contentVersionOf } from './baseCode';
import { bindOrganizerBase } from '../catalog/organizerBinding';
import type { OrganizerBaseProduct, OrganizerVariant } from '../../../shared/src/types';

export type GenerationPhoto = OrganizerPhoto & { kind?: string; visualConfidence?: number; differenceHash?: { key: string; value: string | null } };
export type GenerationSource = { entry: DriveEntry; photo: GenerationPhoto };
// Catalog identity is useful context, never a prerequisite for production.
// Visual groups are scoped to their source folder and already include color/pack/kind.
export function groupGenerationSources(sources: GenerationSource[]) {
  const groups = new Map<string, GenerationSource[]>();
  for (const source of sources) {
    const photo = source.photo;
    const key = photo.variantId ? `variant:${photo.variantId}` : photo.visualHint?.groupId
      ? `visual:${source.entry.sourceId}:${source.entry.parents?.[0]}:${photo.visualHint.groupId}` : `photo:${photo.id}`;
    groups.set(key, [...(groups.get(key) || []), source]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, photos]) => ({ itemId: digest(key), photos }));
}

/** 64-bit difference hash: robust to re-encoding (PNG ↔ JPG), resizing and light compression. */
export async function differenceHash(bytes: Buffer) {
  const sharp = (await import('sharp')).default;
  const pixels = await sharp(bytes, { limitInputPixels: 60_000_000 }).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? '1' : '0';
  return bits;
}
const hamming = (a: string, b: string) => [...a].reduce((count, bit, index) => count + (bit === b[index] ? 0 : 1), 0);
export const NEAR_DUPLICATE_DISTANCE = 6;

/**
 * Photos without a commercial code are grouped by Gemini's label, which can differ for the same article saved twice
 * (e.g. PNG and JPG). Groups in the same folder whose photos are near-identical images become one article, and the
 * copies are marked as duplicates so they are never sent twice as references.
 */
export function mergeNearDuplicateGroups<G extends { itemId: string; photos: GenerationSource[] }>(groups: G[], hashes: Map<string, string>) {
  const merged: G[] = [];
  for (const group of groups) {
    const folder = (item: G) => `${item.photos[0].entry.sourceId}:${item.photos[0].entry.parents?.[0]}`;
    const coded = (item: G) => item.photos.some(({ photo }) => photo.variantId);
    const target = coded(group) ? undefined : merged.find(other => !coded(other) && folder(other) === folder(group) &&
      other.photos.some(a => group.photos.some(b => {
        const [x, y] = [hashes.get(a.photo.id), hashes.get(b.photo.id)];
        return Boolean(x && y && hamming(x, y) <= NEAR_DUPLICATE_DISTANCE);
      })));
    if (target) target.photos.push(...group.photos);
    else merged.push({ ...group, photos: [...group.photos] });
  }
  for (const group of merged) for (const [index, source] of group.photos.entries()) {
    const hash = hashes.get(source.photo.id);
    const original = hash && group.photos.slice(0, index).find(other => {
      const otherHash = hashes.get(other.photo.id);
      return otherHash && hamming(hash, otherHash) <= NEAR_DUPLICATE_DISTANCE;
    });
    if (original && !source.photo.duplicateOf) group.photos[index] = { ...source, photo: { ...source.photo, duplicateOf: original.photo.duplicateOf || original.photo.id } };
  }
  return merged;
}

export function selectGenerationReferences(sources: GenerationSource[], minimumConfidence: number) {
  const kinds = new Set(sources.map(({ photo }) => photo.kind));
  const kind = kinds.size === 1 ? sources[0]?.photo.kind : undefined;
  if (kind !== 'garment' && kind !== 'product') return null;
  const seen = new Set<string>();
  const ranked = sources.filter(({ photo }) => (photo.visualConfidence || 0) >= minimumConfidence &&
    (photo.quality || 0) >= minimumConfidence && photo.view && photo.view !== 'unknown')
    .sort((a, b) => (b.photo.quality || 0) - (a.photo.quality || 0) || a.entry.id.localeCompare(b.entry.id))
    .filter(({ photo, entry }) => {
      const keys = [photo.duplicateOf, entry.sha256Checksum || entry.md5Checksum, photo.id].filter((key): key is string => Boolean(key));
      if (keys.some(key => seen.has(key))) return false;
      keys.forEach(key => seen.add(key)); return true;
    });
  if (!ranked.length) return null;
  const front = ranked.find(({ photo }) => photo.view === 'front');
  if (kind === 'product') {
    const main = front || ranked[0];
    return { kind, references: [main, ...ranked.filter(item => item !== main && item.photo.view !== 'front').slice(0, 2)] };
  }
  const back = kind === 'garment' ? ranked.find(({ photo }) => photo.view === 'back') : undefined;
  const ordered = [...new Set([front, back, ...ranked].filter((value): value is GenerationSource => Boolean(value)))];
  return { kind, references: ordered.slice(0, 4) };
}

/** Generation input in base-code mode: a variant's approved references, never unverified new photos. */
export function approvedReferenceIds(variant: Pick<OrganizerVariant, 'referenceState' | 'references'>) {
  if (variant.referenceState !== 'approved') return null;
  const refs = variant.references;
  const ids = refs.front.length || refs.back.length ? [...refs.front, ...refs.back] : [...refs.main, ...(refs.complementary || [])];
  return [...new Set(ids)].slice(0, 4);
}

type Group = { itemId: string; photos: GenerationSource[]; selection?: ReturnType<typeof selectGenerationReferences>; variantId?: string };
async function baseCodeGroups(root: DocumentReference, doc: DocumentReference, touched: GenerationSource[]) {
  const groups: Group[] = [];
  let needsReview = 0;
  const byVariant = new Map<string, GenerationSource[]>();
  for (const source of touched) {
    if (!source.photo.variantId || source.photo.issue) { needsReview++; continue; }
    byVariant.set(source.photo.variantId, [...(byVariant.get(source.photo.variantId) || []), source]);
  }
  for (const [variantId, members] of [...byVariant].sort(([a], [b]) => a.localeCompare(b))) {
    const variant = (await root.collection('products').doc(variantId).get()).data() as OrganizerVariant | undefined;
    const ids = variant ? approvedReferenceIds(variant) : null;
    if (!ids?.length) { needsReview += members.length; continue; }
    const references: GenerationSource[] = [];
    for (const id of ids) {
      const [file, photo] = await Promise.all([doc.collection('files').doc(id).get(), root.collection('photos').doc(id).get()]);
      if (file.exists && photo.exists) references.push({ entry: file.data()!.entry as DriveEntry, photo: photo.data() as GenerationPhoto });
    }
    if (references.length !== ids.length) { needsReview += members.length; continue; }
    const kind = variant!.references.front.length || variant!.references.back.length ? 'garment' as const : 'product' as const;
    groups.push({ itemId: digest(`variant:${variantId}`), photos: references, selection: { kind, references }, variantId });
  }
  return { groups, needsReview };
}

/** Organizer jobs carry one folder update: budget scales with articles up to the client (or global) automation maximum. */
export function organizerAutomationBudget(articles: number, perArticleUsd: number, maxUsd: number) {
  return Math.min(maxUsd, Math.max(perArticleUsd, Math.round(perArticleUsd * articles * 100) / 100));
}

/** Articles of one Drive update the Organizer sends to automation (~1000 photos). */
export const ORGANIZER_MAX_ARTICLES = 500;
/**
 * Articles per automation job. One update still produces one export (all its batches share `organizerRunId`),
 * but each job must fit Firestore's 1 MiB document — a garment photo plan stores ~20 KB per article in both
 * the automation job and its batch — and the existing per-batch limits (40 objects, 100 photo-plan articles).
 */
export const ORGANIZER_ARTICLES_PER_JOB = { garment: 30, product: 40 } as const;
export const chunkArticles = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

type PreparedGroup = { itemId: string; kind: 'garment' | 'product'; assets: string[]; inputImages: AutomationInput[];
  link: import('./commerce').OrganizerCommercialLink; photoIds: string[]; referenceIds: string[]; jobId?: string };
const handoffId = (clientId: string, assets: string[]) => digest([clientId, assets]);
const assetsOf = (group: Group) => group.photos.map(({ entry }) => generationSourceKey(entry)).sort();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const errorText = (error: unknown) => error instanceof Error ? error.message.slice(0, 120) : 'Error';

/**
 * Near-duplicate hashes of the photos without a commercial code. Each hash is stored on the photo keyed by its
 * content version, so a new slice (or a later run) never downloads the same photo again. Returns null when the
 * slice ran out of time; the hashes computed so far are kept.
 */
export async function photoHashes(drive: Pick<OrganizerDrive, 'assertSource' | 'image'>, root: DocumentReference, groups: { photos: GenerationSource[] }[], deadline: number) {
  const hashes = new Map<string, string>();
  const missing: GenerationSource[] = [];
  for (const group of groups) for (const source of group.photos) {
    if (source.photo.variantId) continue;
    const stored = source.photo.differenceHash;
    if (stored?.key === contentVersionOf(source.entry)) { if (stored.value) hashes.set(source.photo.id, stored.value); }
    else missing.push(source);
  }
  let pending: { id: string; differenceHash: { key: string; value: string | null } }[] = [];
  const persist = async () => {
    if (!pending.length) return;
    const batch = getAppFirestore().batch();
    for (const item of pending) batch.update(root.collection('photos').doc(item.id), { differenceHash: item.differenceHash });
    pending = [];
    await batch.commit();
  };
  for (let index = 0; index < missing.length; index += 4) {
    if (Date.now() > deadline) { await persist(); return null; }
    await Promise.all(missing.slice(index, index + 4).map(async ({ entry, photo }) => {
      let value: string | null = null;
      try {
        await drive.assertSource(entry);
        const bytes = await drive.image(entry.id);
        await drive.assertSource(entry);
        value = await differenceHash(bytes);
        hashes.set(photo.id, value);
      } catch (error) { console.warn('organizer_duplicate_hash_unavailable', { photoId: photo.id, message: errorText(error) }); }
      // Best effort, as before: an unreadable photo is recorded (null) so every slice groups the same way.
      pending.push({ id: photo.id, differenceHash: { key: contentVersionOf(entry), value } });
      photo.differenceHash = { key: contentVersionOf(entry), value };
    }));
    if (pending.length >= 100) await persist();
  }
  await persist();
  return hashes;
}

export async function automateNewPhotos(drive: OrganizerDrive, root: DocumentReference, doc: DocumentReference,
  config: StoredConfig, run: StoredRun, lease: string, deadline: number) {
  const db = getAppFirestore();
  const sources: GenerationSource[] = [];
  const manual = run.mode === 'generate';
  // "Generar desde originales" without a selection takes every photo of the folder that has not been generated yet.
  const selection = Boolean(run.photoIds.length || run.variantId);
  const baseCode = identityModeOf(config) === 'baseCode' && !manual;
  // Sources consumed by this same run stay in the selection, so a resumed slice rebuilds exactly the same groups
  // (and therefore the same idempotency keys) after a partial hand-off.
  const consumedElsewhere = (snapshot: FirebaseFirestore.DocumentSnapshot) => snapshot.exists && snapshot.get('runId') !== run.id;
  const files: { id: string; entry: DriveEntry; added?: boolean; changed?: boolean }[] = [];
  for await (const file of documents(doc.collection('files'))) {
    const value = file.data() as { entry: DriveEntry; added?: boolean; changed?: boolean };
    if (isImage(value.entry)) files.push({ id: file.id, ...value });
  }
  for (let index = 0; index < files.length; index += 100) {
    const page = files.slice(index, index + 100);
    const [photos, consumed] = await Promise.all([
      db.getAll(...page.map(file => root.collection('photos').doc(file.id))),
      baseCode ? Promise.resolve([]) : db.getAll(...page.map(file => root.collection('generationSources').doc(generationSourceKey(file.entry)))),
    ]);
    page.forEach((file, position) => {
      const photo = photos[position].data() as GenerationPhoto | undefined;
      const forced = run.photoIds.includes(file.id) || Boolean(run.variantId && photo?.variantIds?.includes(run.variantId)) || (manual && !selection);
      if (manual && !forced) return;
      if ((!file.added && !file.changed && !forced) || !photo) return;
      // Base-code mode: any new or changed photo of a variant triggers it; its approved references are the input.
      if (!baseCode && consumedElsewhere(consumed[position])) return;
      sources.push({ entry: file.entry, photo });
    });
  }
  let pendingIdentity = 0;
  let groups: Group[] = groupGenerationSources(sources);
  if (baseCode) {
    const resolved = await baseCodeGroups(root, doc, sources);
    pendingIdentity = resolved.needsReview;
    groups = [];
    for (const group of resolved.groups) {
      const consumed = await db.getAll(...group.photos.map(({ entry }) => root.collection('generationSources').doc(generationSourceKey(entry))));
      if (!consumed.every(consumedElsewhere)) groups.push(group);
    }
  }
  if (!baseCode) {
    const hashes = await photoHashes(drive, root, groups, deadline);
    if (!hashes) return;
    groups = mergeNearDuplicateGroups(groups, hashes);
  }
  if (groups.length > ORGANIZER_MAX_ARTICLES)
    throw new HttpsError('resource-exhausted', `La actualización supera ${ORGANIZER_MAX_ARTICLES} artículos. Divide la carpeta o genera por partes.`);
  let organizerGeneration: ClientAutomationConfig['organizerGeneration'];
  let clientAutomation: ClientAutomationConfig | undefined;
  let automationBudget = DEFAULT_AUTOMATION_BUDGET;
  let enabled: { value: boolean; at: number } | null = null;
  const isEnabled = async () => {
    // Re-read at most every 30 s: hundreds of articles must not mean hundreds of configuration reads.
    if (enabled && Date.now() - enabled.at < 30_000) return enabled.value;
    const [system, client] = await Promise.all([getSystemConfigDocRef().get(), db.collection('clients').doc(config.clientId).get()]);
    clientAutomation = client.data()?.automation;
    organizerGeneration = clientAutomation?.organizerGeneration;
    automationBudget = system.data()?.automationBudget ?? DEFAULT_AUTOMATION_BUDGET;
    const value = client.exists && client.data()?.status !== 'archived' && clientAutomation?.enabled !== false &&
      (manual || isOrganizerGenerationEnabled(sanitizeSystemConfig(system.data()).organizerAutoGenerationEnabled, clientAutomation));
    enabled = { value, at: Date.now() };
    return value;
  };
  const handoffs = doc.collection('generationHandoffs');
  const markNeedsAttention = (items: { assets: string[]; photos: { id: string; issue?: string | null }[] }[], issue: string) => whileLeased(doc, lease, tx => {
    for (const item of items) {
      tx.set(handoffs.doc(handoffId(config.clientId, item.assets)), { status: 'needs_attention', photoIds: item.photos.map(photo => photo.id), issue });
      for (const photo of item.photos) tx.update(root.collection('photos').doc(photo.id), {
        hasConflict: true, issue: photo.issue?.includes(issue) ? photo.issue : [photo.issue, issue].filter(Boolean).join(' '),
      });
    }
  });
  let actor: { uid: string; role: string } | null = null;
  const resolveActor = async () => {
    if (actor) return actor;
    const uid = run.generationUid || (run.createdBy !== 'watcher' ? run.createdBy : config.generationActor?.uid || config.operatorUids[0]) || '';
    if (!uid) throw new HttpsError('failed-precondition', 'Guarda la configuración del organizador para identificar al responsable de la automatización.');
    const role = await assertUserRoles(uid, undefined, ['admin', 'operador']);
    if (role !== 'admin' && !config.operatorUids.includes(uid)) throw new HttpsError('permission-denied', 'El responsable ya no tiene acceso al organizador del cliente.');
    if (run.delegated) await assertDelegatedStamp(run.delegated, config.clientId);
    actor = { uid, role };
    return actor;
  };
  // Groups already prepared (or handed off) by an earlier slice of this run are reused as stored.
  const stored = new Map<string, FirebaseFirestore.DocumentData>();
  const ids = groups.map(group => handoffId(config.clientId, assetsOf(group)));
  for (let index = 0; index < ids.length; index += 200) {
    for (const snapshot of await db.getAll(...ids.slice(index, index + 200).map(id => handoffs.doc(id))))
      if (snapshot.exists) stored.set(snapshot.id, snapshot.data()!);
  }
  let skipped = 0;
  const prepared: PreparedGroup[] = [];
  for (const [index, group] of groups.entries()) {
    const assets = assetsOf(group);
    const previous = stored.get(handoffId(config.clientId, assets));
    if (previous?.status === 'needs_attention') continue;
    if (previous && ['prepared', 'queued'].includes(previous.status) && Array.isArray(previous.inputImages) && previous.link) {
      prepared.push({ itemId: previous.itemId, kind: previous.kind, assets, inputImages: previous.inputImages, link: previous.link,
        photoIds: previous.photoIds, referenceIds: previous.referenceIds, ...(previous.jobId ? { jobId: previous.jobId } : {}) });
      continue;
    }
    if (Date.now() > deadline) return;
    if (!await isEnabled()) {
      skipped = groups.slice(index).reduce((count, item) => count + item.photos.length, 0);
      break;
    }
    // Independent of run ID and Excel matching: a retry keeps the same intake key.
    const chosen = group.selection ?? selectGenerationReferences(group.photos, config.minimumConfidence);
    if (!chosen) {
      await markNeedsAttention([{ assets, photos: group.photos.map(({ photo }) => photo) }],
        `Generación pendiente: revisa el tipo, las vistas o la calidad de ${group.photos.map(({ photo }) => photo.name).join(', ')}.`);
      continue;
    }
    const { uid } = await resolveActor();
    const inputImages: AutomationInput[] = [];
    for (const { entry, photo } of chosen.references) {
      if (Date.now() > deadline) return;
      const { storagePath } = await freezeOriginal(drive, entry, uid, config.clientId);
      inputImages.push({ itemId: group.itemId, fileName: photo.name.slice(0, 200), storagePath });
    }
    const photos = chosen.references.map(({ entry }) => ({ id: entry.id, version: versionOf(entry) }));
    const commercial = await readOrganizerCommerce(root, photos, organizerGeneration?.sourceColumns);
    const catalogBinding = baseCode && commercial.organizerVariantId ? await bindVariantBase(root, config.clientId, commercial.organizerVariantId, commercial.source) : null;
    const item: PreparedGroup = { itemId: group.itemId, kind: chosen.kind as PreparedGroup['kind'], assets, inputImages,
      link: plain({ ...commercial, itemId: group.itemId, photos, ...(catalogBinding ? { catalogBinding } : {}) }),
      photoIds: group.photos.map(({ photo }) => photo.id), referenceIds: chosen.references.map(({ photo }) => photo.id) };
    // Each prepared group is saved at once: a new slice continues after it instead of starting over.
    await whileLeased(doc, lease, tx => tx.set(handoffs.doc(handoffId(config.clientId, assets)), { status: 'prepared', ...item }));
    prepared.push(item);
  }
  // Automations (one per type, split in jobs that fit Firestore) are created only once every group is prepared.
  for (const kind of ['garment', 'product'] as const) {
    const items = prepared.filter(item => item.kind === kind).sort((a, b) => a.itemId.localeCompare(b.itemId));
    const chunks = chunkArticles(items, ORGANIZER_ARTICLES_PER_JOB[kind]);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      if (chunk.every(item => item.jobId)) continue;
      if (Date.now() > deadline) return;
      if (!await isEnabled()) { skipped += chunk.reduce((count, item) => count + item.photoIds.length, 0); continue; }
      const { uid, role } = await resolveActor();
      await whileLeased(doc, lease, () => undefined);
      const key = digest([config.clientId, kind, chunk.map(item => item.assets)]);
      const perArticle = clientAutomation?.defaultBudgetUsd ?? automationBudget.defaultBudgetUsd;
      const create = () => createAutomation({
        source: 'api', externalId: `organizer-${key}`, clientId: config.clientId, jobType: kind,
        ...(organizerGeneration?.preset !== undefined ? { preset: organizerGeneration.preset } : {}),
        inputImages: chunk.flatMap(item => item.inputImages), allowEstimatedCosts: true, authorizeClassification: true,
        budgetUsd: organizerAutomationBudget(chunk.length, perArticle, effectiveMaxBudgetUsd(automationBudget, clientAutomation)),
        metadata: { organizerRunId: run.id, organizerArticleCount: chunk.length, organizerChunk: chunkIndex + 1, organizerChunks: chunks.length,
          organizerPhotoCount: chunk.reduce((count, item) => count + item.photoIds.length, 0),
          organizerPhotoIds: chunk.flatMap(item => item.referenceIds).slice(0, 120) },
      }, uid, role, undefined, chunk.map(item => item.link));
      let receipt: Awaited<ReturnType<typeof createAutomation>>;
      try {
        receipt = run.delegated ? await withManglarContext({ caller: { ...run.delegated,
          scopes: ['jobs:read', 'jobs:create'], allowedClientIds: [config.clientId] } }, create) : await create();
      } catch (error) {
        if (!(error instanceof AutomationAttentionError)) throw error;
        await markNeedsAttention(chunk.map(item => ({ assets: item.assets, photos: item.photoIds.map(id => ({ id })) })), error.message);
        continue;
      }
      // Receipt and consumption are idempotent: a crash part-way reuses createAutomation's key (same groups,
      // same chunk) and rewrites the same documents.
      for (const part of chunkArticles(chunk, 100)) await whileLeased(doc, lease, tx => {
        for (const item of part) {
          // Merge keeps the prepared inputs and link, so a later slice can still rebuild this chunk without preparing it again.
          tx.set(handoffs.doc(handoffId(config.clientId, item.assets)), { status: 'queued', jobId: receipt.jobId, kind,
            photoIds: item.photoIds, referenceIds: item.referenceIds, itemId: item.itemId }, { merge: true });
          for (const asset of item.assets) tx.set(root.collection('generationSources').doc(asset), { jobId: receipt.jobId, runId: run.id, at: Date.now() });
        }
      });
      chunk.forEach(item => { item.jobId = receipt.jobId; });
    }
  }
  const all: FirebaseFirestore.DocumentData[] = [];
  for await (const item of documents(handoffs)) all.push(item.data());
  const queued = all.filter(item => item.status === 'queued' && item.jobId);
  await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'report', cursor: null,
    'counts.automationJobs': new Set(queued.map(item => item.jobId)).size,
    'counts.automationArticles': queued.length,
    'counts.automationPhotos': queued.reduce((count, item) => count + item.photoIds.length, 0),
    'counts.automationNeedsReview': all.filter(item => item.status === 'needs_attention').reduce((count, item) => count + item.photoIds.length, 0) + pendingIdentity,
    'counts.automationSkippedPhotos': skipped,
  }));
}


/** Resolves (or creates) the canonical master product for the variant's declared base code. */
async function bindVariantBase(root: DocumentReference, clientId: string, variantId: string,
  source: Awaited<ReturnType<typeof readOrganizerCommerce>>['source']) {
  const variant = (await root.collection('products').doc(variantId).get()).data() as OrganizerVariant | undefined;
  if (!variant?.baseDeclared) return null;
  const baseId = digest([variant.base]);
  const baseRef = root.collection('baseProducts').doc(baseId);
  const base = (await baseRef.get()).data() as OrganizerBaseProduct | undefined;
  if (base?.conflict) return null;
  const result = await bindOrganizerBase(clientId, variant.base, baseId, variant, source);
  if (base) await baseRef.update({ catalogProductId: result.productId, catalogIssue: result.issue });
  return result.productId ? { productId: result.productId, baseCode: variant.base } : null;
}
