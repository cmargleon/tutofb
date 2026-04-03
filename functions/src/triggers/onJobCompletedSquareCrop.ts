import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Batch, Job } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { syncProductDraftImagesForGarment } from '../spreadsheets/syncProductDraftImages';

const resolveEffectiveOutputId = (job: Job | undefined): string | null =>
  job?.userSelectedOutput?.id
  || job?.userSelectedOutputId
  || job?.currentOutput?.id
  || job?.currentOutputId
  || null;

export const onJobCompletedSquareCrop = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data() as Job;
  const after = snapshot.after.data() as Job;

  if (!after.batchId || !after.garmentId || !after.productDraftId) {
    return;
  }

  // Manual selections are handled inside the callable so the user waits for the sync there.
  if ((before.userSelectedOutputId || null) !== (after.userSelectedOutputId || null)) {
    return;
  }

  if (resolveEffectiveOutputId(before) === resolveEffectiveOutputId(after)) {
    return;
  }

  const db = getAppFirestore();
  const batchSnapshot = await db.collection('batches').doc(after.batchId).get();
  if (!batchSnapshot.exists) {
    return;
  }

  const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;
  if (!batch.spreadsheetTemplateId) {
    return;
  }

  await syncProductDraftImagesForGarment({
    db,
    batchId: after.batchId,
    garmentId: after.garmentId,
    batch,
  });
});
