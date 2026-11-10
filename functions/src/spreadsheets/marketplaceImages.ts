import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Job, MasterProduct, PublishedMarketplaceImage } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { getAppFirestore } from '../firebase/appFirestore';
import { MARKETPLACE_IMAGE_PROFILE_VERSION, MARKETPLACE_IMAGE_MAX_BYTES, prepareMarketplaceImage } from '../media/prepareMarketplaceImage';
import { isApprovedMasterProductOutput } from './masterProducts';

type ApprovedImage = MasterProduct['approvedImages'][number];

export function marketplaceImageBucketName(): string {
  const projectId = process.env.GCLOUD_PROJECT || admin.app().options.projectId;
  if (!projectId) throw new Error('No se pudo resolver el proyecto del almacenamiento de marketplaces.');
  return `${projectId}-marketplace-images`;
}

const publicationId = (product: MasterProduct, image: ApprovedImage, channel: MarketplaceId) => createHash('sha256')
  .update(JSON.stringify([product.clientId, product.id, image.jobId, image.outputId, image.storagePath, channel, MARKETPLACE_IMAGE_PROFILE_VERSION])).digest('hex');
export const marketplaceImageClientPrefix = (clientId: string) => `images/${createHash('sha256').update(clientId).digest('hex')}/`;
const publicationRef = (product: MasterProduct, channel: MarketplaceId) => getAppFirestore()
  .doc(`clients/${product.clientId}/products/${product.id}/marketplaceImages/${channel}`);

export function isMatchingMarketplacePublication(record: PublishedMarketplaceImage | undefined, product: MasterProduct, image: ApprovedImage, channel: MarketplaceId): record is PublishedMarketplaceImage {
  if (!record) return false;
  const prefix = `${marketplaceImageClientPrefix(product.clientId)}${publicationId(product, image, channel)}/`;
  return record.marketplaceId === channel && record.outputId === image.outputId && record.jobId === image.jobId
    && record.sourceStoragePath === image.storagePath && record.profileVersion === MARKETPLACE_IMAGE_PROFILE_VERSION
    && record.bucket === marketplaceImageBucketName() && record.storagePath.startsWith(prefix)
    && /^[a-f0-9]{64}\.jpg$/.test(record.storagePath.slice(prefix.length))
    && record.url === `https://storage.googleapis.com/${record.bucket}/${record.storagePath}`
    && record.contentType === 'image/jpeg' && record.bytes > 0 && record.bytes <= MARKETPLACE_IMAGE_MAX_BYTES;
}

/** Read-only projection. Publication is never a side effect of opening a preview or downloading an Excel. */
export async function attachMarketplacePublications(products: MasterProduct[], channels: MarketplaceId[]) {
  const refs = products.flatMap(product => product.approvedImages.length ? channels.map(channel => ({ product, channel, ref: publicationRef(product, channel) })) : []);
  for (let offset = 0; offset < refs.length; offset += 400) {
    const group = refs.slice(offset, offset + 400);
    const snapshots = await getAppFirestore().getAll(...group.map(entry => entry.ref));
    for (const [index, snapshot] of snapshots.entries()) {
      const { product, channel } = group[index];
      const images = snapshot.get('images') as Record<string, PublishedMarketplaceImage> | undefined;
      for (const image of product.approvedImages) {
        const record = images?.[image.outputId];
        if (!isMatchingMarketplacePublication(record, product, image, channel)) continue;
        product.publishedImages ??= {};
        product.publishedImages[channel] ??= {};
        product.publishedImages[channel]![image.outputId] = record;
        const data = product.marketplaces[channel];
        if (data) {
          data.imageUrls ??= {};
          // Preserve explicitly supplied external hosting. Refresh only managed or absent links.
          if (!data.imageUrls[image.outputId] || data.imageUrls[image.outputId].startsWith('https://storage.googleapis.com/')) data.imageUrls[image.outputId] = record.url;
        }
      }
    }
  }
}

const assertCurrentImage = (product: MasterProduct, image: ApprovedImage, channel: MarketplaceId, client: admin.firestore.DocumentSnapshot, snapshot: admin.firestore.DocumentSnapshot) => {
  if (!client.exists || client.get('status') === 'archived' || client.get(`marketplaces.${channel}.enabled`) !== true)
    throw new HttpsError('failed-precondition', 'Cliente o marketplace no disponible.');
  const job = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } as Job : null;
  const output = job && resolveApprovedJobOutput(job);
  if (!job || job.clientId !== product.clientId || job.garmentId !== product.garmentId || !product.batchIds.includes(job.batchId)
    || !isApprovedMasterProductOutput(job, output) || output?.id !== image.outputId || output.resultImagePath !== image.storagePath)
    throw new HttpsError('failed-precondition', 'La fotografía cambió o dejó de estar aprobada. Actualiza antes de publicarla.');
  if (!image.storagePath.startsWith(`generated/${product.clientId}/${job.batchId}/${image.jobId}/`)
    || /[\\%?#\x00-\x1f]/.test(image.storagePath) || image.storagePath.split('/').some(part => !part || part === '.' || part === '..'))
    throw new HttpsError('permission-denied', 'La fotografía no pertenece a este trabajo.');
};

export async function publishMarketplaceImage(product: MasterProduct, image: ApprovedImage, channel: MarketplaceId, uid: string): Promise<PublishedMarketplaceImage> {
  const db = getAppFirestore();
  const ref = publicationRef(product, channel);
  const clientRef = db.doc(`clients/${product.clientId}`);
  const jobRef = db.doc(`jobs/${image.jobId}`);
  const [client, job, previous] = await db.getAll(clientRef, jobRef, ref);
  assertCurrentImage(product, image, channel, client, job);
  const bucket = admin.storage().bucket(marketplaceImageBucketName());
  const existing = previous.get('images')?.[image.outputId] as PublishedMarketplaceImage | undefined;
  if (isMatchingMarketplacePublication(existing, product, image, channel) && (await bucket.file(existing.storagePath).exists())[0]) return existing;

  const source = admin.storage().bucket().file(image.storagePath);
  const [sourceMetadata] = await source.getMetadata();
  if (Number(sourceMetadata.size) > 32 * 1024 * 1024) throw new Error('La imagen supera 32 MB; prepara una versión más pequeña.');
  // Pin the read to this object generation so a concurrent replacement cannot change the bytes being published.
  const [bytes] = await admin.storage().bucket().file(image.storagePath, { generation: sourceMetadata.generation }).download();
  const prepared = await prepareMarketplaceImage(bytes, channel);
  const contentHash = createHash('sha256').update(prepared.bytes).digest('hex');
  const storagePath = `${marketplaceImageClientPrefix(product.clientId)}${publicationId(product, image, channel)}/${contentHash}.jpg`;
  const record: PublishedMarketplaceImage = {
    outputId: image.outputId, jobId: image.jobId, sourceStoragePath: image.storagePath,
    marketplaceId: channel, profileVersion: MARKETPLACE_IMAGE_PROFILE_VERSION,
    bucket: bucket.name, storagePath, url: `https://storage.googleapis.com/${bucket.name}/${storagePath}`,
    contentType: prepared.contentType, width: prepared.width, height: prepared.height, bytes: prepared.bytes.length,
    publishedAt: admin.firestore.Timestamp.now(), publishedByUid: uid,
  };
  // Recheck approval after the transform and immediately before making the authorized copy public.
  const [currentClient, currentJob] = await db.getAll(clientRef, jobRef);
  assertCurrentImage(product, image, channel, currentClient, currentJob);
  try {
    await bucket.file(storagePath).save(prepared.bytes, {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: prepared.contentType, cacheControl: 'public, max-age=86400, immutable', contentDisposition: 'inline' },
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 412) throw error; // An identical concurrent publication is safe to reuse.
  }
  return db.runTransaction(async tx => {
    const [latestClient, latestJob, latestPublication] = await tx.getAll(clientRef, jobRef, ref);
    assertCurrentImage(product, image, channel, latestClient, latestJob);
    const concurrent = latestPublication.get('images')?.[image.outputId] as PublishedMarketplaceImage | undefined;
    if (isMatchingMarketplacePublication(concurrent, product, image, channel) && concurrent.url === record.url) return concurrent;
    tx.set(ref, { images: { [image.outputId]: record } }, { merge: true });
    return record;
  });
}

/** Called only by the existing permanent client deletion flow, never by output retention cleanup. */
export async function deletePublishedMarketplaceImages(clientId: string) {
  try { await admin.storage().bucket(marketplaceImageBucketName()).deleteFiles({ prefix: marketplaceImageClientPrefix(clientId), force: true }); }
  catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
}
