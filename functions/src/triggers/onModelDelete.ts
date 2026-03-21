import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Model } from '../../../shared/src/types';
import { extractLiveOutputPaths } from './deletePlans';
import { recursiveDeleteDocuments } from '../utils/recursiveDelete';
import { getAppFirestore } from '../firebase/appFirestore';

export const onModelDelete = onDocumentDeleted('models/{modelId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const model = snapshot.data() as Model;
  const modelId = event.params.modelId;
  const db = getAppFirestore();
  const bucket = admin.storage().bucket();

  const [batchesSnapshot, jobsSnapshot, outputsSnapshot] = await Promise.all([
    db.collection('batches').where('modelId', '==', modelId).get(),
    db.collection('jobs').where('modelId', '==', modelId).get(),
    db.collectionGroup('outputs').where('modelId', '==', modelId).get(),
  ]);

  const outputPaths = extractLiveOutputPaths(
    outputsSnapshot.docs.map((docSnapshot) => docSnapshot.data() as { resultImagePath?: string; storageDeletedAt?: unknown }),
  );

  await recursiveDeleteDocuments(jobsSnapshot.docs);
  await recursiveDeleteDocuments(batchesSnapshot.docs);

  await Promise.allSettled([
    bucket.deleteFiles({ prefix: `${model.storageRootPath || `models/${model.clientId}/${modelId}`}/`, force: true }),
    ...outputPaths.map((storagePath) => bucket.file(storagePath).delete({ ignoreNotFound: true })),
  ]);
});
