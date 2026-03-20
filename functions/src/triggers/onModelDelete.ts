import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const onModelDelete = onDocumentDeleted('models/{modelId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const db = admin.firestore();
  const modelId = event.params.modelId;

  // Delete all batches for this model
  const batchesSnap = await db.collection('batches').where('modelId', '==', modelId).get();
  const batch = db.batch();
  batchesSnap.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Delete all jobs for this model
  const jobsSnap = await db.collection('jobs').where('modelId', '==', modelId).get();
  jobsSnap.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  // Delete storage files
  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix: `models/${snapshot.data().clientId}/${modelId}/` });
});
