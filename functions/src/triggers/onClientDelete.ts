import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

export const onClientDelete = onDocumentDeleted('clients/{clientId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const db = admin.firestore();
  const clientId = event.params.clientId;

  // Delete all models for this client
  const modelsSnap = await db.collection('models').where('clientId', '==', clientId).get();
  const batch = db.batch();
  modelsSnap.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Delete all batches for this client
  const batchesSnap = await db.collection('batches').where('clientId', '==', clientId).get();
  batchesSnap.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Delete all jobs for this client
  const jobsSnap = await db.collection('jobs').where('clientId', '==', clientId).get();
  jobsSnap.docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  // Delete storage files
  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix: `models/${clientId}/` });
  await bucket.deleteFiles({ prefix: `generated/${clientId}/` });
});
