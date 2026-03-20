import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { Job, JobOutput } from '../../../shared/src/types';
import { getJobStateDelta } from '../analytics/aggregation';

const db = admin.firestore();

const updateDailyDoc = (
  batch: FirebaseFirestore.WriteBatch,
  date: string,
  updates: Partial<Record<'completed' | 'failed' | 'costUsd', number>>,
): void => {
  const ref = db.collection('analytics_daily').doc(date);
  const payload: Record<string, unknown> = {
    date,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (updates.completed) {
    payload.completed = admin.firestore.FieldValue.increment(updates.completed);
  }
  if (updates.failed) {
    payload.failed = admin.firestore.FieldValue.increment(updates.failed);
  }
  if (updates.costUsd) {
    payload.costUsd = admin.firestore.FieldValue.increment(updates.costUsd);
  }

  batch.set(ref, payload, { merge: true });
};

export const onJobAnalyticsUpdate = onDocumentWritten('jobs/{jobId}', async (event) => {
  const before = event.data?.before.data() as Job | undefined;
  const after = event.data?.after.data() as Job | undefined;
  const delta = getJobStateDelta(before, after);

  const hasSummaryChanges = Object.values(delta.summary).some((value) => (value || 0) !== 0);
  const hasProviderChanges = Object.values(delta.providerFailed).some((value) => (value || 0) !== 0);
  const hasDailyChanges = delta.dailyFailed.some((entry) => entry.delta !== 0);

  if (!hasSummaryChanges && !hasProviderChanges && !hasDailyChanges) {
    return;
  }

  const batch = db.batch();
  batch.set(
    db.collection('analytics_summary').doc('global'),
    {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(delta.summary.totalJobs ? { totalJobs: admin.firestore.FieldValue.increment(delta.summary.totalJobs) } : {}),
      ...(delta.summary.completedJobs
        ? { completedJobs: admin.firestore.FieldValue.increment(delta.summary.completedJobs) }
        : {}),
      ...(delta.summary.failedJobs ? { failedJobs: admin.firestore.FieldValue.increment(delta.summary.failedJobs) } : {}),
      ...(delta.summary.pendingJobs ? { pendingJobs: admin.firestore.FieldValue.increment(delta.summary.pendingJobs) } : {}),
      ...(delta.summary.processingJobs
        ? { processingJobs: admin.firestore.FieldValue.increment(delta.summary.processingJobs) }
        : {}),
    },
    { merge: true },
  );

  Object.entries(delta.providerFailed).forEach(([provider, failedDelta]) => {
    if (!failedDelta) {
      return;
    }

    batch.set(
      db.collection('analytics_providers').doc(provider),
      {
        provider,
        failed: admin.firestore.FieldValue.increment(failedDelta),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  delta.dailyFailed.forEach((entry) => {
    if (!entry.delta) {
      return;
    }

    updateDailyDoc(batch, entry.date, { failed: entry.delta });
  });

  await batch.commit();
});

export const onJobOutputAnalyticsCreate = onDocumentCreated('jobs/{jobId}/outputs/{outputId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const output = snapshot.data() as JobOutput;
  const batch = db.batch();
  const date = output.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(output.createdAt.toDate()) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const durationSeconds = output.durationSeconds || 0;

  batch.set(
    db.collection('analytics_summary').doc('global'),
    {
      totalCompletedOutputs: admin.firestore.FieldValue.increment(1),
      totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
      totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  updateDailyDoc(batch, date, {
    completed: 1,
    costUsd: output.costUsd || 0,
  });

  batch.set(
    db.collection('analytics_providers').doc(output.provider),
    {
      provider: output.provider,
      completed: admin.firestore.FieldValue.increment(1),
      totalCompletedOutputs: admin.firestore.FieldValue.increment(1),
      totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
      totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_clients').doc(output.clientId),
    {
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      completed: admin.firestore.FieldValue.increment(1),
      totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
});

export const onJobOutputAnalyticsDelete = onDocumentDeleted('jobs/{jobId}/outputs/{outputId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const output = snapshot.data() as JobOutput;
  const batch = db.batch();
  const date = output.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(output.createdAt.toDate()) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const durationSeconds = output.durationSeconds || 0;

  batch.set(
    db.collection('analytics_summary').doc('global'),
    {
      totalCompletedOutputs: admin.firestore.FieldValue.increment(-1),
      totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
      totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  updateDailyDoc(batch, date, {
    completed: -1,
    costUsd: -(output.costUsd || 0),
  });

  batch.set(
    db.collection('analytics_providers').doc(output.provider),
    {
      provider: output.provider,
      completed: admin.firestore.FieldValue.increment(-1),
      totalCompletedOutputs: admin.firestore.FieldValue.increment(-1),
      totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
      totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_clients').doc(output.clientId),
    {
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      completed: admin.firestore.FieldValue.increment(-1),
      totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
});
