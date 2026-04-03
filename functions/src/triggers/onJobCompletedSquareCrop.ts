import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Batch, Job, ProductDraft } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import {
  buildSquareCropStoragePath,
  generateAndStoreSquareCrop,
  isSquareCropValueForJob,
} from '../spreadsheets/squareCrop';
import { getAppFirestore } from '../firebase/appFirestore';

// Column keys that represent the "primera foto" / main square image
const MAIN_IMAGE_COLUMN_KEYS = new Set(['main_img', 'square_img']);

export const onJobCompletedSquareCrop = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data();
  const after = snapshot.after.data() as Job;

  // Only fire when transitioning TO completed
  if (before.status === 'completed' || after.status !== 'completed') return;

  const approvedOutput = resolveApprovedJobOutput(after);
  const resultImagePath = approvedOutput?.resultImagePath;
  if (!approvedOutput?.id || !resultImagePath) return;

  const db = getAppFirestore();

  // Fetch batch to check for spreadsheet template
  const batchSnap = await db.collection('batches').doc(after.batchId).get();
  if (!batchSnap.exists) return;

  const batch = batchSnap.data() as Batch;
  if (!batch.spreadsheetTemplateId) return;

  // Find the ProductDraft for this garment in the batch
  const draftsSnap = await db
    .collection('batches')
    .doc(after.batchId)
    .collection('productDrafts')
    .where('garmentId', '==', after.garmentId)
    .limit(1)
    .get();

  if (draftsSnap.empty) return;

  const draftDoc = draftsSnap.docs[0];
  const draft = draftDoc.data() as ProductDraft;
  const cropLocation = {
    clientId: after.clientId,
    batchId: after.batchId,
    jobId: event.params.jobId,
  };

  const shouldRefreshSquareCrop = draft.rows.some((row) =>
    [...MAIN_IMAGE_COLUMN_KEYS].some((key) => {
      const currentValue = row.values[key];
      return !currentValue || isSquareCropValueForJob(currentValue, cropLocation);
    }),
  );

  if (!shouldRefreshSquareCrop) return;

  // Generate square crop
  const outputPath = buildSquareCropStoragePath({
    ...cropLocation,
    outputId: approvedOutput.id,
  });
  let downloadUrl: string;
  try {
    downloadUrl = await generateAndStoreSquareCrop(resultImagePath, outputPath, {
      poseFraming: after.poseFraming || 'unknown',
    });
  } catch (error) {
    console.error('Failed to generate square crop for job', event.params.jobId, error);
    return;
  }

  // Update all draft rows that were still empty or already pointed to this job's square crop.
  const updatedRows = draft.rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      ...[...MAIN_IMAGE_COLUMN_KEYS].reduce<Record<string, string>>((nextValues, key) => {
        const currentValue = row.values[key];
        if (!currentValue || isSquareCropValueForJob(currentValue, cropLocation)) {
          nextValues[key] = downloadUrl;
        }
        return nextValues;
      }, {}),
    },
  }));

  await draftDoc.ref.update({
    rows: updatedRows,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
