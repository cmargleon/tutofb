import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { Model } from '../../../shared/src/types';
import { batchesToRecomputeAfterModelDelete, extractLiveOutputPaths, modelStoragePrefixes, OutputDeleteCandidate } from './deletePlans';
import { recursiveDeleteDocuments } from '../utils/recursiveDelete';
import { getAppFirestore } from '../firebase/appFirestore';
import { recomputeBatchCounters } from '../batches/batchCounters';

const OUTPUT_READ_CONCURRENCY = 20;

/**
 * Cascade for a permanently deleted model:
 *  - jobs with `modelId` (and their `outputs` subcollection + output files),
 *  - batches with `batches.modelId` (single-model batches),
 *  - the model's own subcollections (baseOperations, baseCombinationLocks, baseSchedules…),
 *  - storage under the model root and `model_generations/{clientId}/{modelId}/`.
 *
 * Mixed-model batches have no `batches.modelId`: they are kept, only this model's jobs are
 * removed from them and their counters are recomputed. A mixed batch left with zero jobs
 * held only this model's jobs, so it is deleted too.
 *
 * Outputs are read per job (`jobs/{jobId}/outputs`) instead of with a collection-group
 * query, which would need a single-field COLLECTION_GROUP index on `outputs.modelId`.
 */
export const onModelDelete = onDocumentDeleted({ document: 'models/{modelId}', timeoutSeconds: 540, memory: '512MiB' }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const model = snapshot.data() as Model;
  const modelId = event.params.modelId;
  const db = getAppFirestore();
  const bucket = admin.storage().bucket();

  const [batchesSnapshot, jobsSnapshot] = await Promise.all([
    db.collection('batches').where('modelId', '==', modelId).get(),
    db.collection('jobs').where('modelId', '==', modelId).get(),
  ]);

  const outputs: OutputDeleteCandidate[] = [];
  for (let i = 0; i < jobsSnapshot.docs.length; i += OUTPUT_READ_CONCURRENCY) {
    const chunk = jobsSnapshot.docs.slice(i, i + OUTPUT_READ_CONCURRENCY);
    const snapshots = await Promise.all(chunk.map((job) => job.ref.collection('outputs').get()));
    snapshots.forEach((outputsSnapshot) => outputsSnapshot.docs.forEach((doc) => outputs.push(doc.data() as OutputDeleteCandidate)));
  }
  const outputPaths = extractLiveOutputPaths(outputs);

  const mixedBatchIds = batchesToRecomputeAfterModelDelete(
    jobsSnapshot.docs.map((job) => job.data() as { batchId?: string | null }),
    batchesSnapshot.docs.map((batch) => batch.id),
  );

  await recursiveDeleteDocuments(jobsSnapshot.docs);
  await recursiveDeleteDocuments(batchesSnapshot.docs);
  // The model doc is gone, but its subcollections are not deleted with it.
  await db.recursiveDelete(snapshot.ref);

  for (const batchId of mixedBatchIds) {
    try {
      const remaining = await db.collection('jobs').where('batchId', '==', batchId).limit(1).get();
      if (remaining.empty) {
        await db.recursiveDelete(db.collection('batches').doc(batchId));
      } else {
        await recomputeBatchCounters(db, batchId, { writeTotalJobs: true });
      }
    } catch (error) {
      logger.error('onModelDelete: failed to update mixed batch', { modelId, batchId, error });
    }
  }

  const results = await Promise.allSettled([
    ...modelStoragePrefixes({ modelId, clientId: model.clientId, storageRootPath: model.storageRootPath })
      .map((prefix) => bucket.deleteFiles({ prefix, force: true })),
    ...outputPaths.map((storagePath) => bucket.file(storagePath).delete({ ignoreNotFound: true })),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    logger.warn('onModelDelete: some storage deletions failed', {
      modelId,
      failures: failures.length,
      firstError: String((failures[0] as PromiseRejectedResult).reason),
    });
  }

  logger.info('onModelDelete: cascade done', {
    modelId,
    jobs: jobsSnapshot.size,
    batches: batchesSnapshot.size,
    mixedBatches: mixedBatchIds.length,
    outputFiles: outputPaths.length,
  });
});
