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
  ]);

  const batch = db.batch();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  batch.set(db.collection('analytics_summary').doc('global'), {
    ...rebuilt.summary,
    updatedAt: timestamp,
  });

  rebuilt.daily.forEach((daily) => {
    batch.set(db.collection('analytics_daily').doc(daily.date), {
      ...daily,
      updatedAt: timestamp,
    });
  });

  rebuilt.providers.forEach((providerStats) => {
    batch.set(db.collection('analytics_providers').doc(providerStats.provider), {
      ...providerStats,
      updatedAt: timestamp,
    });
  });

  rebuilt.clients.forEach((clientStats) => {
    batch.set(db.collection('analytics_clients').doc(clientStats.clientId), {
      ...clientStats,
      updatedAt: timestamp,
    });
  });

  await batch.commit();

  return {
    success: true,
    summary: {
      totalJobs: rebuilt.summary.totalJobs,
      totalCompletedOutputs: rebuilt.summary.totalCompletedOutputs,
      totalCostUsd: rebuilt.summary.totalCostUsd,
    },
  };
});
