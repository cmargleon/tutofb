import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { Job, JobOutput } from '../../../shared/src/types';
import { getJobReviewOutcomeCounts } from '../../../shared/src/reviewMetrics';
import { formatMexicoCityDate } from '../../../shared/src/utils/dateUtils';
import { getJobStateDelta } from '../analytics/aggregation';
import { getAppFirestore } from '../firebase/appFirestore';

const db = getAppFirestore();

const getClientProviderDocId = (clientId: string, provider: JobOutput['provider']) => `${clientId}__${provider}`;
const getClientModelDocId = (clientId: string, modelId: string) => `${clientId}__${modelId}`;

type JobContribution = {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  processingJobs: number;
  firstPassApprovedJobs: number;
  regeneratedCompletedJobs: number;
  jobsWithHumanIntervention: number;
  humanInterventionCount: number;
  manualSelectionCount: number;
  geminiApprovedJobs: number;
  geminiRejectedJobs: number;
  geminiTruePositiveJobs: number;
  geminiTrueNegativeJobs: number;
  geminiFalsePositiveJobs: number;
  geminiFalseNegativeJobs: number;
  humanReviewAvoidedJobs: number;
  manualRegenerationCount: number;
};

const getJobContribution = (job: Job | undefined): JobContribution => {
  if (!job) {
    return {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      firstPassApprovedJobs: 0,
      regeneratedCompletedJobs: 0,
      jobsWithHumanIntervention: 0,
      humanInterventionCount: 0,
      manualSelectionCount: 0,
      geminiApprovedJobs: 0,
      geminiRejectedJobs: 0,
      geminiTruePositiveJobs: 0,
      geminiTrueNegativeJobs: 0,
      geminiFalsePositiveJobs: 0,
      geminiFalseNegativeJobs: 0,
      humanReviewAvoidedJobs: 0,
      manualRegenerationCount: 0,
    };
  }

  const manualRegenerationCount = job.manualRegenerationCount || 0;
  const reviewCounts = getJobReviewOutcomeCounts(job);
  return {
    totalJobs: 1,
    completedJobs: job.status === 'completed' ? 1 : 0,
    failedJobs: job.status === 'failed' ? 1 : 0,
    pendingJobs: job.status === 'pending' ? 1 : 0,
    processingJobs: job.status === 'processing' ? 1 : 0,
    firstPassApprovedJobs:
      job.status === 'completed' && manualRegenerationCount === 0 && reviewCounts.jobsWithHumanIntervention === 0 ? 1 : 0,
    regeneratedCompletedJobs: job.status === 'completed' && manualRegenerationCount > 0 ? 1 : 0,
    jobsWithHumanIntervention: reviewCounts.jobsWithHumanIntervention,
    humanInterventionCount: reviewCounts.humanInterventionCount,
    manualSelectionCount: reviewCounts.manualSelectionCount,
    geminiApprovedJobs: reviewCounts.geminiApprovedJobs,
    geminiRejectedJobs: reviewCounts.geminiRejectedJobs,
    geminiTruePositiveJobs: reviewCounts.geminiTruePositiveJobs,
    geminiTrueNegativeJobs: reviewCounts.geminiTrueNegativeJobs,
    geminiFalsePositiveJobs: reviewCounts.geminiFalsePositiveJobs,
    geminiFalseNegativeJobs: reviewCounts.geminiFalseNegativeJobs,
    humanReviewAvoidedJobs: reviewCounts.humanReviewAvoidedJobs,
    manualRegenerationCount,
  };
};

const diffJobContribution = (before: Job | undefined, after: Job | undefined): JobContribution => {
  const previous = getJobContribution(before);
  const next = getJobContribution(after);

  return {
    totalJobs: next.totalJobs - previous.totalJobs,
    completedJobs: next.completedJobs - previous.completedJobs,
    failedJobs: next.failedJobs - previous.failedJobs,
    pendingJobs: next.pendingJobs - previous.pendingJobs,
    processingJobs: next.processingJobs - previous.processingJobs,
    firstPassApprovedJobs: next.firstPassApprovedJobs - previous.firstPassApprovedJobs,
    regeneratedCompletedJobs: next.regeneratedCompletedJobs - previous.regeneratedCompletedJobs,
    jobsWithHumanIntervention: next.jobsWithHumanIntervention - previous.jobsWithHumanIntervention,
    humanInterventionCount: next.humanInterventionCount - previous.humanInterventionCount,
    manualSelectionCount: next.manualSelectionCount - previous.manualSelectionCount,
    geminiApprovedJobs: next.geminiApprovedJobs - previous.geminiApprovedJobs,
    geminiRejectedJobs: next.geminiRejectedJobs - previous.geminiRejectedJobs,
    geminiTruePositiveJobs: next.geminiTruePositiveJobs - previous.geminiTruePositiveJobs,
    geminiTrueNegativeJobs: next.geminiTrueNegativeJobs - previous.geminiTrueNegativeJobs,
    geminiFalsePositiveJobs: next.geminiFalsePositiveJobs - previous.geminiFalsePositiveJobs,
    geminiFalseNegativeJobs: next.geminiFalseNegativeJobs - previous.geminiFalseNegativeJobs,
    humanReviewAvoidedJobs: next.humanReviewAvoidedJobs - previous.humanReviewAvoidedJobs,
    manualRegenerationCount: next.manualRegenerationCount - previous.manualRegenerationCount,
  };
};

const setIncrementIfNeeded = (
  payload: Record<string, unknown>,
  field: keyof JobContribution,
  value: number,
): void => {
  if (value) {
    payload[field] = admin.firestore.FieldValue.increment(value);
  }
};

const updateJobAggregationDoc = (
  batch: FirebaseFirestore.WriteBatch,
  ref: FirebaseFirestore.DocumentReference,
  before: Job | undefined,
  after: Job | undefined,
  basePayload: Record<string, unknown>,
): void => {
  const delta = diffJobContribution(before, after);
  const payload: Record<string, unknown> = {
    ...basePayload,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  setIncrementIfNeeded(payload, 'totalJobs', delta.totalJobs);
  setIncrementIfNeeded(payload, 'completedJobs', delta.completedJobs);
  setIncrementIfNeeded(payload, 'failedJobs', delta.failedJobs);
  setIncrementIfNeeded(payload, 'pendingJobs', delta.pendingJobs);
  setIncrementIfNeeded(payload, 'processingJobs', delta.processingJobs);
  setIncrementIfNeeded(payload, 'firstPassApprovedJobs', delta.firstPassApprovedJobs);
  setIncrementIfNeeded(payload, 'regeneratedCompletedJobs', delta.regeneratedCompletedJobs);
  setIncrementIfNeeded(payload, 'jobsWithHumanIntervention', delta.jobsWithHumanIntervention);
  setIncrementIfNeeded(payload, 'humanInterventionCount', delta.humanInterventionCount);
  setIncrementIfNeeded(payload, 'manualSelectionCount', delta.manualSelectionCount);
  setIncrementIfNeeded(payload, 'geminiApprovedJobs', delta.geminiApprovedJobs);
  setIncrementIfNeeded(payload, 'geminiRejectedJobs', delta.geminiRejectedJobs);
  setIncrementIfNeeded(payload, 'geminiTruePositiveJobs', delta.geminiTruePositiveJobs);
  setIncrementIfNeeded(payload, 'geminiTrueNegativeJobs', delta.geminiTrueNegativeJobs);
  setIncrementIfNeeded(payload, 'geminiFalsePositiveJobs', delta.geminiFalsePositiveJobs);
  setIncrementIfNeeded(payload, 'geminiFalseNegativeJobs', delta.geminiFalseNegativeJobs);
  setIncrementIfNeeded(payload, 'humanReviewAvoidedJobs', delta.humanReviewAvoidedJobs);
  setIncrementIfNeeded(payload, 'manualRegenerationCount', delta.manualRegenerationCount);

  if (Object.keys(payload).length <= Object.keys(basePayload).length + 1) {
    return;
  }

  batch.set(ref, payload, { merge: true });
};

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
  const jobContributionDelta = diffJobContribution(before, after);

  const hasSummaryChanges = Object.values(delta.summary).some((value) => (value || 0) !== 0);
  const hasProviderChanges = Object.values(delta.providerFailed).some((value) => (value || 0) !== 0);
  const hasDailyChanges = delta.dailyFailed.some((entry) => entry.delta !== 0);
  const hasProductivityChanges = Object.values(jobContributionDelta).some((value) => value !== 0);

  if (!hasSummaryChanges && !hasProviderChanges && !hasDailyChanges && !hasProductivityChanges) {
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
      ...(jobContributionDelta.firstPassApprovedJobs
        ? { firstPassApprovedJobs: admin.firestore.FieldValue.increment(jobContributionDelta.firstPassApprovedJobs) }
        : {}),
      ...(jobContributionDelta.jobsWithHumanIntervention
        ? { jobsWithHumanIntervention: admin.firestore.FieldValue.increment(jobContributionDelta.jobsWithHumanIntervention) }
        : {}),
      ...(jobContributionDelta.humanInterventionCount
        ? { humanInterventionCount: admin.firestore.FieldValue.increment(jobContributionDelta.humanInterventionCount) }
        : {}),
      ...(jobContributionDelta.manualSelectionCount
        ? { manualSelectionCount: admin.firestore.FieldValue.increment(jobContributionDelta.manualSelectionCount) }
        : {}),
      ...(jobContributionDelta.geminiApprovedJobs
        ? { geminiApprovedJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiApprovedJobs) }
        : {}),
      ...(jobContributionDelta.geminiRejectedJobs
        ? { geminiRejectedJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiRejectedJobs) }
        : {}),
      ...(jobContributionDelta.geminiTruePositiveJobs
        ? { geminiTruePositiveJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiTruePositiveJobs) }
        : {}),
      ...(jobContributionDelta.geminiTrueNegativeJobs
        ? { geminiTrueNegativeJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiTrueNegativeJobs) }
        : {}),
      ...(jobContributionDelta.geminiFalsePositiveJobs
        ? { geminiFalsePositiveJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiFalsePositiveJobs) }
        : {}),
      ...(jobContributionDelta.geminiFalseNegativeJobs
        ? { geminiFalseNegativeJobs: admin.firestore.FieldValue.increment(jobContributionDelta.geminiFalseNegativeJobs) }
        : {}),
      ...(jobContributionDelta.humanReviewAvoidedJobs
        ? { humanReviewAvoidedJobs: admin.firestore.FieldValue.increment(jobContributionDelta.humanReviewAvoidedJobs) }
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

  const clientIds = new Set([before?.clientId, after?.clientId].filter((value): value is string => Boolean(value)));
  clientIds.forEach((clientId) => {
    const beforeForClient = before?.clientId === clientId ? before : undefined;
    const afterForClient = after?.clientId === clientId ? after : undefined;
    const clientNameSnapshot = afterForClient?.clientNameSnapshot || beforeForClient?.clientNameSnapshot || 'Cliente desconocido';

    updateJobAggregationDoc(
      batch,
      db.collection('analytics_clients').doc(clientId),
      beforeForClient,
      afterForClient,
      {
        clientId,
        clientNameSnapshot,
      },
    );
  });

  const clientModelKeys = new Set(
    [
      before ? getClientModelDocId(before.clientId, before.modelId) : null,
      after ? getClientModelDocId(after.clientId, after.modelId) : null,
    ].filter((value): value is string => Boolean(value)),
  );

  clientModelKeys.forEach((key) => {
    const [clientId, modelId] = key.split('__');
    const beforeForKey = before && before.clientId === clientId && before.modelId === modelId ? before : undefined;
    const afterForKey = after && after.clientId === clientId && after.modelId === modelId ? after : undefined;
    const source = afterForKey || beforeForKey;

    if (!source) {
      return;
    }

    updateJobAggregationDoc(
      batch,
      db.collection('analytics_client_models').doc(key),
      beforeForKey,
      afterForKey,
      {
        id: key,
        clientId,
        clientNameSnapshot: source.clientNameSnapshot,
        modelId,
        modelNameSnapshot: source.modelNameSnapshot,
      },
    );
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
  const date = formatMexicoCityDate(output.createdAt);
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
      totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_client_providers').doc(getClientProviderDocId(output.clientId, output.provider)),
    {
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      provider: output.provider,
      completed: admin.firestore.FieldValue.increment(1),
      totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_client_models').doc(getClientModelDocId(output.clientId, output.modelId)),
    {
      id: getClientModelDocId(output.clientId, output.modelId),
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      modelId: output.modelId,
      modelNameSnapshot: output.modelNameSnapshot,
      totalCompletedOutputs: admin.firestore.FieldValue.increment(1),
      totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
      totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
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
  const date = formatMexicoCityDate(output.createdAt);
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
      totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_client_providers').doc(getClientProviderDocId(output.clientId, output.provider)),
    {
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      provider: output.provider,
      completed: admin.firestore.FieldValue.increment(-1),
      totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  batch.set(
    db.collection('analytics_client_models').doc(getClientModelDocId(output.clientId, output.modelId)),
    {
      id: getClientModelDocId(output.clientId, output.modelId),
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      modelId: output.modelId,
      modelNameSnapshot: output.modelNameSnapshot,
      totalCompletedOutputs: admin.firestore.FieldValue.increment(-1),
      totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
      totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
});
