import * as admin from 'firebase-admin';
import { Batch, Job, JobOutput, ProductDraft, ProductDraftGeneratedImage } from '../../../shared/src/types';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';
import {
  buildSquareCropStoragePath,
  generateAndStoreSquareCrop,
} from './squareCrop';

const MAIN_IMAGE_COLUMN_KEYS = new Set(['main_img', 'square_img']);

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const resolveDetailImageIndexFromKey = (key: string): number | null => {
  const candidate = normalizeComparable(key);
  const exactMatch = candidate.match(/detail_img_(\d+)$/) || candidate.match(/detalle_img_(\d+)$/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const compactMatch = candidate.match(/detail_(\d+)$/)
    || candidate.match(/detalle_(\d+)$/)
    || candidate.match(/detail(\d+)$/)
    || candidate.match(/detalle(\d+)$/);
  if (compactMatch) {
    return Number(compactMatch[1]);
  }

  return null;
};

const resolveEffectiveOutput = (job: Job): JobOutput | null =>
  job.userSelectedOutput || job.currentOutput || null;

const buildPoseOrderMap = (batch: Pick<Batch, 'poseIds'>): Map<string, number> =>
  new Map((batch.poseIds || []).map((poseId, index) => [poseId, index]));

const sortJobsForDraft = (jobs: Job[], batch: Pick<Batch, 'poseIds'>): Job[] => {
  const poseOrderMap = buildPoseOrderMap(batch);

  return [...jobs].sort((left, right) => {
    const leftPoseOrder = poseOrderMap.get(left.poseImageId) ?? Number.MAX_SAFE_INTEGER;
    const rightPoseOrder = poseOrderMap.get(right.poseImageId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPoseOrder !== rightPoseOrder) {
      return leftPoseOrder - rightPoseOrder;
    }

    const createdAtDelta = toMillisOrZero(left.createdAt) - toMillisOrZero(right.createdAt);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return (left.id || '').localeCompare(right.id || '');
  });
};

const buildGeneratedImages = async (jobs: Job[]): Promise<ProductDraftGeneratedImage[]> => {
  const generatedImages = await Promise.all<ProductDraftGeneratedImage | null>(
    jobs.map(async (job) => {
      const output = resolveEffectiveOutput(job);
      if (!job.id || !output?.id || !output.resultImagePath) {
        return null;
      }

      return {
        jobId: job.id,
        outputId: output.id,
        poseId: job.poseImageId || null,
        label: job.poseFileName || `Pose ${job.poseImageId}`,
        storagePath: output.resultImagePath,
        downloadUrl: await ensureStorageDownloadUrl(output.resultImagePath),
        poseOrientationGroup: job.poseOrientationGroup || null,
        poseOrientationDetail: job.poseOrientationDetail || null,
        poseFraming: job.poseFraming || null,
        selectedAt: output.createdAt || job.completedAt || job.updatedAt || job.createdAt,
      };
    }),
  );

  return generatedImages.filter((entry): entry is ProductDraftGeneratedImage => entry !== null);
};

const buildUpdatedRows = ({
  draft,
  mainImageUrl,
  squareImageUrl,
  detailImageUrls,
}: {
  draft: ProductDraft;
  mainImageUrl: string;
  squareImageUrl: string;
  detailImageUrls: string[];
}): ProductDraft['rows'] =>
  draft.rows.map((row) => ({
    ...row,
    values: Object.fromEntries(
      Object.entries(row.values).map(([key, value]) => {
        if (MAIN_IMAGE_COLUMN_KEYS.has(key)) {
          if (key === 'square_img') {
            return [key, squareImageUrl];
          }
          return [key, mainImageUrl];
        }

        const detailIndex = resolveDetailImageIndexFromKey(key);
        if (detailIndex !== null) {
          return [key, detailImageUrls[detailIndex - 1] || ''];
        }

        return [key, value];
      }),
    ),
  }));

export const syncProductDraftImagesForGarment = async ({
  db,
  batchId,
  garmentId,
  requestedByUid,
  batch: providedBatch,
}: {
  db: admin.firestore.Firestore;
  batchId: string;
  garmentId: string;
  requestedByUid?: string | null;
  batch?: Batch | null;
}): Promise<void> => {
  const batch = providedBatch || null;
  const batchSnapshot = batch
    ? null
    : await db.collection('batches').doc(batchId).get();
  const resolvedBatch = batch || (batchSnapshot?.exists ? ({ id: batchSnapshot.id, ...batchSnapshot.data() } as Batch) : null);

  if (!resolvedBatch?.spreadsheetTemplateId) {
    return;
  }

  const draftSnapshot = await db
    .collection('batches')
    .doc(batchId)
    .collection('productDrafts')
    .where('garmentId', '==', garmentId)
    .limit(1)
    .get();

  if (draftSnapshot.empty) {
    return;
  }

  const draftDoc = draftSnapshot.docs[0];
  const draft = { id: draftDoc.id, ...draftDoc.data() } as ProductDraft;

  const jobsSnapshot = await db
    .collection('jobs')
    .where('batchId', '==', batchId)
    .where('garmentId', '==', garmentId)
    .get();

  const sortedJobs = sortJobsForDraft(
    jobsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Job),
    resolvedBatch,
  );
  const generatedImages = await buildGeneratedImages(sortedJobs);
  const mainGeneratedImage = generatedImages[0] || null;
  const detailGeneratedImages = generatedImages.slice(1);

  let squareImageUrl = '';
  if (mainGeneratedImage && sortedJobs[0]?.id) {
    squareImageUrl = await generateAndStoreSquareCrop(
      mainGeneratedImage.storagePath,
      buildSquareCropStoragePath({
        clientId: sortedJobs[0].clientId,
        batchId: sortedJobs[0].batchId,
        jobId: sortedJobs[0].id!,
        outputId: mainGeneratedImage.outputId,
      }),
      { poseFraming: sortedJobs[0].poseFraming || 'unknown' },
    );
  }

  await draftDoc.ref.update({
    generatedImages,
    rows: buildUpdatedRows({
      draft,
      mainImageUrl: mainGeneratedImage?.downloadUrl || '',
      squareImageUrl,
      detailImageUrls: detailGeneratedImages.map((image) => image.downloadUrl || ''),
    }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUid: requestedByUid || draft.updatedByUid || null,
  });
};
