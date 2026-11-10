import * as admin from 'firebase-admin';
import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationInput, ClientAutomationConfig, OrganizerPhoto } from '../../../shared/src/types';
import { assertUserRoles } from '../auth/roles';
import { getSystemConfigDocRef, sanitizeSystemConfig } from '../admin/systemConfig';
import { createAutomation } from '../automation/persistence';
import { AutomationAttentionError } from '../automation/imports';
import { normalizeInputImage } from '../media/normalizeInputImage';
import { assertDelegatedStamp } from '../manglar/access';
import { withManglarContext } from '../manglar/context';
import { getAppFirestore } from '../firebase/appFirestore';
import { digest, isImage, versionOf, type DriveEntry, type OrganizerDrive } from './drive';
import { documents, whileLeased, type StoredConfig, type StoredRun } from './store';

export type GenerationPhoto = OrganizerPhoto & { kind?: string; visualConfidence?: number };
export type GenerationSource = { entry: DriveEntry; photo: GenerationPhoto };
const sourceKey = (entry: DriveEntry) => digest([entry.id, versionOf(entry)]);
const generationSourceKey = (entry: DriveEntry) => digest([entry.id,
  entry.sha256Checksum ? ['sha256', entry.sha256Checksum] : entry.md5Checksum ? ['md5', entry.md5Checksum] : ['version', versionOf(entry)]]);

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

export function selectGenerationReferences(sources: GenerationSource[], minimumConfidence: number) {
  const kinds = new Set(sources.map(({ photo }) => photo.kind));
  const kind = kinds.size === 1 ? sources[0]?.photo.kind : undefined;
  if (kind !== 'garment' && kind !== 'product') return null;
  const seen = new Set<string>();
  const ranked = sources.filter(({ photo }) => (photo.visualConfidence || 0) >= minimumConfidence &&
    (photo.quality || 0) >= minimumConfidence && photo.view && photo.view !== 'unknown')
    .sort((a, b) => (b.photo.quality || 0) - (a.photo.quality || 0) || a.entry.id.localeCompare(b.entry.id))
    .filter(({ photo, entry }) => {
      const key = photo.duplicateOf || entry.sha256Checksum || entry.md5Checksum || entry.id;
      if (seen.has(key)) return false;
      seen.add(key); return true;
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

export async function automateNewPhotos(drive: OrganizerDrive, root: DocumentReference, doc: DocumentReference,
  config: StoredConfig, run: StoredRun, lease: string, deadline: number) {
  const sources: GenerationSource[] = [];
  for await (const file of documents(doc.collection('files'))) {
    const value = file.data() as { entry: DriveEntry; added?: boolean; changed?: boolean };
    if (!isImage(value.entry)) continue;
    const photo = (await root.collection('photos').doc(file.id).get()).data() as GenerationPhoto | undefined;
    const forced = run.photoIds.includes(file.id) || Boolean(run.variantId && photo?.variantIds?.includes(run.variantId));
    if ((!value.added && !value.changed && !forced) || !photo) continue;
    if ((await root.collection('generationSources').doc(generationSourceKey(value.entry)).get()).exists) continue;
    sources.push({ entry: value.entry, photo });
  }
  const groups = groupGenerationSources(sources);
  let organizerGeneration: ClientAutomationConfig['organizerGeneration'];
  const isEnabled = async () => {
    const [system, client] = await Promise.all([getSystemConfigDocRef().get(), getAppFirestore().collection('clients').doc(config.clientId).get()]);
    organizerGeneration = client.data()?.automation?.organizerGeneration;
    return sanitizeSystemConfig(system.data()).organizerAutoGenerationEnabled && client.exists &&
      client.data()?.status !== 'archived' && client.data()?.automation?.enabled !== false && organizerGeneration?.enabled !== false;
  };
  let skipped = 0;
  for (const [index, group] of groups.entries()) {
    if (Date.now() > deadline) return;
    if (!await isEnabled()) {
      skipped = groups.slice(index).reduce((count, item) => count + item.photos.length, 0);
      break;
    }
    // Independent of run ID and Excel matching: a retry keeps the same intake key.
    const assets = group.photos.map(({ entry }) => generationSourceKey(entry)).sort();
    const key = digest([config.clientId, assets]);
    const handoff = doc.collection('generationHandoffs').doc(key);
    const selection = selectGenerationReferences(group.photos, config.minimumConfidence);
    if (!selection || group.photos.some(({ photo }) => !photo.copyUrl)) {
      const issue = `Generación pendiente: revisa el tipo, las vistas o la calidad de ${group.photos.map(({ photo }) => photo.name).join(', ')}.`;
      await whileLeased(doc, lease, tx => {
        tx.set(handoff, { status: 'needs_attention', photoIds: group.photos.map(({ photo }) => photo.id), issue });
        for (const { photo } of group.photos) tx.update(root.collection('photos').doc(photo.id), {
          hasConflict: true, issue: photo.issue?.includes(issue) ? photo.issue : [photo.issue, issue].filter(Boolean).join(' '),
        });
      });
      continue;
    }
    const uid = run.generationUid || (run.createdBy !== 'watcher' ? run.createdBy : config.generationActor?.uid || config.operatorUids[0]);
    if (!uid) throw new HttpsError('failed-precondition', 'Guarda la configuración del organizador para identificar al responsable de la automatización.');
    const role = await assertUserRoles(uid, undefined, ['admin', 'operador']);
    if (role !== 'admin' && !config.operatorUids.includes(uid)) throw new HttpsError('permission-denied', 'El responsable ya no tiene acceso al organizador del cliente.');
    if (run.delegated) await assertDelegatedStamp(run.delegated, config.clientId);
    const inputImages: AutomationInput[] = [];
    for (const { entry, photo } of selection.references) {
      if (Date.now() > deadline) return;
      const copy = (await root.collection('manifest').doc(sourceKey(entry)).get()).data();
      if (!copy?.copiedId) throw new HttpsError('failed-precondition', `No está disponible la copia verificada de ${photo.name}.`);
      await drive.managed(run.rootId!, copy.parentId, config.sourceIds, digest(['organizer', config.clientId]), config.parentId);
      await drive.verifyCopy(copy.copiedId, copy.parentId, entry, digest(['organizer', config.clientId]));
      const storagePath = `garments/drafts/${uid}/organizer-${digest([config.clientId, sourceKey(entry)])}/source/image.jpg`;
      const target = admin.storage().bucket().file(storagePath);
      if (!(await target.exists())[0]) {
        const bytes = await normalizeInputImage(await drive.image(copy.copiedId));
        await target.save(bytes, { resumable: false, metadata: { contentType: 'image/jpeg' } });
      }
      inputImages.push({ itemId: group.itemId, fileName: photo.name.slice(0, 200), storagePath });
    }
    await whileLeased(doc, lease, () => undefined);
    if (!await isEnabled()) {
      skipped = groups.slice(index).reduce((count, item) => count + item.photos.length, 0);
      break;
    }
    const create = () => createAutomation({
      source: 'api', externalId: `organizer-${key}`, clientId: config.clientId, jobType: selection.kind,
      ...(organizerGeneration?.preset !== undefined ? { preset: organizerGeneration.preset } : {}),
      inputImages, allowEstimatedCosts: true, authorizeClassification: true,
      metadata: { organizerRunId: run.id, organizerPhotoCount: group.photos.length,
        organizerPhotoIds: selection.references.map(({ photo }) => photo.id) },
    }, uid, role);
    let receipt: Awaited<ReturnType<typeof createAutomation>>;
    try {
      receipt = run.delegated ? await withManglarContext({ caller: { ...run.delegated,
        scopes: ['jobs:read', 'jobs:create'], allowedClientIds: [config.clientId] } }, create) : await create();
    } catch (error) {
      if (!(error instanceof AutomationAttentionError) || organizerGeneration?.preset === undefined) throw error;
      const issue = error.message;
      await whileLeased(doc, lease, tx => {
        tx.set(handoff, { status: 'needs_attention', photoIds: group.photos.map(({ photo }) => photo.id), issue });
        for (const { photo } of group.photos) tx.update(root.collection('photos').doc(photo.id), {
          hasConflict: true, issue: photo.issue?.includes(issue) ? photo.issue : [photo.issue, issue].filter(Boolean).join(' '),
        });
      });
      continue;
    }
    // Receipt and consumption are committed together. A crash before this transaction
    // reuses createAutomation's idempotency key rather than creating a second batch.
    await whileLeased(doc, lease, tx => {
      tx.set(handoff, { status: 'queued', jobId: receipt.jobId, photoIds: group.photos.map(({ photo }) => photo.id),
        referenceIds: selection.references.map(({ photo }) => photo.id), kind: selection.kind });
      for (const asset of assets) tx.set(root.collection('generationSources').doc(asset), { jobId: receipt.jobId, runId: run.id, at: Date.now() });
    });
  }
  const handoffs = (await doc.collection('generationHandoffs').get()).docs.map(item => item.data());
  await whileLeased(doc, lease, tx => tx.update(doc, { phase: 'report', cursor: null,
    'counts.automationJobs': handoffs.filter(item => item.jobId).length,
    'counts.automationPhotos': handoffs.filter(item => item.jobId).reduce((count, item) => count + item.photoIds.length, 0),
    'counts.automationNeedsReview': handoffs.filter(item => !item.jobId).reduce((count, item) => count + item.photoIds.length, 0),
    'counts.automationSkippedPhotos': skipped,
  }));
}
