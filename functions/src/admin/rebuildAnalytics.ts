import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { Job, JobOutput } from '../../../shared/src/types';
import { buildAnalyticsSnapshot } from '../analytics/aggregation';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const deleteCollectionDocs = async (collectionName: string): Promise<void> => {
  const db = getAppFirestore();
  const snapshot = await db.collection(collectionName).get();
  const batchSize = 400;

  for (let index = 0; index < snapshot.docs.length; index += batchSize) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + batchSize).forEach((docSnapshot) => {
      batch.delete(docSnapshot.ref);
    });
    await batch.commit();
  }
};

const commitWritersInChunks = async (
  writers: Array<(batch: FirebaseFirestore.WriteBatch) => void>,
): Promise<void> => {
  const db = getAppFirestore();
  const batchSize = 400;
  let batch = db.batch();
  let operationCount = 0;

  for (const writer of writers) {
    writer(batch);
    operationCount += 1;

    if (operationCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }
};

export const rebuildAnalytics = onCall(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const db = getAppFirestore();
  const [jobsSnapshot, outputsSnapshot] = await Promise.all([
    db.collection('jobs').get(),
    db.collectionGroup('outputs').get(),
  ]);

  const jobs = jobsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job));
  const outputs = outputsSnapshot.docs.map(
    (docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as JobOutput),
  );

  const rebuilt = buildAnalyticsSnapshot(jobs, outputs);

  await Promise.all([
    deleteCollectionDocs('analytics_daily'),
    deleteCollectionDocs('analytics_providers'),
    deleteCollectionDocs('analytics_clients'),
    deleteCollectionDocs('analytics_client_providers'),
  ]);

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const writers: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [
    (batch) => {
      batch.set(db.collection('analytics_summary').doc('global'), {
        ...rebuilt.summary,
        updatedAt: timestamp,
      });
    },
    ...rebuilt.daily.map(
      (daily) => (batch: FirebaseFirestore.WriteBatch) =>
        batch.set(db.collection('analytics_daily').doc(daily.date), {
          ...daily,
          updatedAt: timestamp,
        }),
    ),
    ...rebuilt.providers.map(
      (providerStats) => (batch: FirebaseFirestore.WriteBatch) =>
        batch.set(db.collection('analytics_providers').doc(providerStats.provider), {
          ...providerStats,
          updatedAt: timestamp,
        }),
    ),
    ...rebuilt.clients.map(
      (clientStats) => (batch: FirebaseFirestore.WriteBatch) =>
        batch.set(db.collection('analytics_clients').doc(clientStats.clientId), {
          ...clientStats,
          updatedAt: timestamp,
        }),
    ),
    ...rebuilt.clientProviders.map(
      (clientProviderStats) => (batch: FirebaseFirestore.WriteBatch) =>
        batch.set(db.collection('analytics_client_providers').doc(clientProviderStats.id), {
          ...clientProviderStats,
          updatedAt: timestamp,
        }),
    ),
  ];

  await commitWritersInChunks(writers);

  return {
    success: true,
    summary: {
      totalJobs: rebuilt.summary.totalJobs,
      totalCompletedOutputs: rebuilt.summary.totalCompletedOutputs,
      totalCostUsd: rebuilt.summary.totalCostUsd,
    },
  };
});
