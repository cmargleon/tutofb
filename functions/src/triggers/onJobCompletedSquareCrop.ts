import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Batch, Job, ProductDraft } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { generateAndStoreSquareCrop } from '../spreadsheets/squareCrop';
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

  const resultImagePath = resolveApprovedJobOutput(after)?.resultImagePath;
  if (!resultImagePath) return;

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

  // Skip if any row already has a main image value set
  const alreadySet = draft.rows.some((row) =>
    [...MAIN_IMAGE_COLUMN_KEYS].some((key) => row.values[key]),
  );
  if (alreadySet) return;

  // Generate square crop
  const outputPath = `generated/${after.clientId}/${after.batchId}/${event.params.jobId}/square_crop.jpg`;
  let downloadUrl: string;
  try {
    downloadUrl = await generateAndStoreSquareCrop(resultImagePath, outputPath);
  } catch (error) {
    console.error('Failed to generate square crop for job', event.params.jobId, error);
    return;
  }

  // Update all draft rows — set main_img if empty
  const updatedRows = draft.rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      main_img: row.values['main_img'] || downloadUrl,
    },
  }));

  await draftDoc.ref.update({
    rows: updatedRows,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
