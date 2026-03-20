import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { recursiveDeleteDocuments } from '../utils/recursiveDelete';
import { getAppFirestore } from '../firebase/appFirestore';

export const onClientDelete = onDocumentDeleted('clients/{clientId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const clientId = event.params.clientId;
  const db = getAppFirestore();
  const bucket = admin.storage().bucket();

  const [modelsSnapshot, batchesSnapshot, jobsSnapshot] = await Promise.all([
    db.collection('models').where('clientId', '==', clientId).get(),
    db.collection('batches').where('clientId', '==', clientId).get(),
    db.collection('jobs').where('clientId', '==', clientId).get(),
  ]);

  await recursiveDeleteDocuments(jobsSnapshot.docs);
  await recursiveDeleteDocuments(batchesSnapshot.docs);
  await recursiveDeleteDocuments(modelsSnapshot.docs);

  await Promise.allSettled([
    bucket.deleteFiles({ prefix: `models/${clientId}/`, force: true }),
    bucket.deleteFiles({ prefix: `generated/${clientId}/`, force: true }),
  ]);
});
