import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Job } from '../../../shared/src/types';
import { PROVIDER_COSTS } from '../../../shared/src/constants/providerCosts';

export const onJobAnalyticsUpdate = onDocumentWritten('jobs/{jobId}', async (event) => {
  const db = admin.firestore();
  const before = event.data?.before.data() as Job | undefined;
  const after = event.data?.after.data() as Job | undefined;

  // Determine changes
  const isCreate = !before && after;
  const isDelete = before && !after;
  const isUpdate = before && after;

  const batch = db.batch();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  // References
  const globalRef = db.collection('analytics_summary').doc('global');

  // Deltas
  let deltaTotal = 0;
  let deltaCompleted = 0;
  let deltaFailed = 0;
  let deltaPending = 0; // pending + processing
  let deltaCostUsd = 0;
  let deltaDurationSeconds = 0;

  if (isCreate) {
    deltaTotal = 1;
    if (after.status === 'completed') deltaCompleted = 1;
    else if (after.status === 'failed') deltaFailed = 1;
    else deltaPending = 1;
  } else if (isDelete) {
    deltaTotal = -1;
    if (before.status === 'completed') deltaCompleted = -1;
    else if (before.status === 'failed') deltaFailed = -1;
    else deltaPending = -1;
  } else if (isUpdate) {
    if (before.status !== after.status) {
      if (before.status === 'completed') deltaCompleted = -1;
      else if (before.status === 'failed') deltaFailed = -1;
      else deltaPending = -1;

      if (after.status === 'completed') deltaCompleted = 1;
      else if (after.status === 'failed') deltaFailed = 1;
      else deltaPending = 1;
    }
  }

  // Cost and Duration logic
  // We only count cost and duration for completed jobs.
  // If a job is regenerated, it might go from completed -> pending -> completed.
  // The user requested: "mantener costo por output completado real"
  // Let's implement this: every time a job becomes completed, we add its cost and duration.
  // If it goes from completed to pending, we DO NOT subtract the cost, because the API was already consumed.
  // Wait, the user said: "Si decides que cada regeneración también cuenta como costo real consumido... recomendación: mantener costo por output completado real... Documenta claramente esta decisión en el código."
  
  // DECISION DOCUMENTATION:
  // Cost and duration are accumulated every time a job transitions TO 'completed'.
  // We do NOT subtract cost or duration when a job transitions FROM 'completed' to another state (e.g., regeneration),
  // because the API call was already made and paid for.
  // However, the `completedJobs` counter represents the CURRENT state of jobs, so it can go down if a job is regenerated.
  
  let newlyCompleted = false;
  if (isCreate && after.status === 'completed') newlyCompleted = true;
  if (isUpdate && before.status !== 'completed' && after.status === 'completed') newlyCompleted = true;

  if (newlyCompleted && after) {
    const cost = PROVIDER_COSTS[after.provider] || 0;
    deltaCostUsd = cost;
    
    if (after.startedAt && after.completedAt) {
      const start = after.startedAt.toDate ? after.startedAt.toDate().getTime() : new Date(after.startedAt).getTime();
      const end = after.completedAt.toDate ? after.completedAt.toDate().getTime() : new Date(after.completedAt).getTime();
      deltaDurationSeconds = Math.max(0, (end - start) / 1000);
    }
  }

  // If no relevant changes, exit early
  if (deltaTotal === 0 && deltaCompleted === 0 && deltaFailed === 0 && deltaPending === 0 && deltaCostUsd === 0 && deltaDurationSeconds === 0) {
    return;
  }

  // 1. Update Global Summary
  const globalUpdate: any = {
    updatedAt: timestamp
  };
  if (deltaTotal !== 0) globalUpdate.totalJobs = admin.firestore.FieldValue.increment(deltaTotal);
  if (deltaCompleted !== 0) globalUpdate.completedJobs = admin.firestore.FieldValue.increment(deltaCompleted);
  if (deltaFailed !== 0) globalUpdate.failedJobs = admin.firestore.FieldValue.increment(deltaFailed);
  if (deltaPending !== 0) globalUpdate.pendingJobs = admin.firestore.FieldValue.increment(deltaPending);
  if (deltaCostUsd !== 0) globalUpdate.totalCostUsd = admin.firestore.FieldValue.increment(deltaCostUsd);
  if (deltaDurationSeconds !== 0) globalUpdate.totalDurationSeconds = admin.firestore.FieldValue.increment(deltaDurationSeconds);
  if (newlyCompleted) globalUpdate.totalCompletedOutputs = admin.firestore.FieldValue.increment(1);

  batch.set(globalRef, globalUpdate, { merge: true });

  // Helper to get Mexico City date string (yyyy-mm-dd)
  const getMexicoCityDate = (dateObj: Date) => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(dateObj);
  };

  const jobToUse = after || before;
  if (jobToUse) {
    // 2. Update Daily Stats
    const dateStr = getMexicoCityDate(new Date());
    const dailyRef = db.collection('analytics_daily').doc(dateStr);
    const dailyUpdate: any = {
      date: dateStr,
      updatedAt: timestamp
    };
    if (deltaCompleted !== 0) dailyUpdate.completed = admin.firestore.FieldValue.increment(deltaCompleted);
    if (deltaFailed !== 0) dailyUpdate.failed = admin.firestore.FieldValue.increment(deltaFailed);
    if (deltaCostUsd !== 0) dailyUpdate.costUsd = admin.firestore.FieldValue.increment(deltaCostUsd);
    
    batch.set(dailyRef, dailyUpdate, { merge: true });

    // 3. Update Provider Stats
    const providerRef = db.collection('analytics_providers').doc(jobToUse.provider);
    const providerUpdate: any = {
      provider: jobToUse.provider,
      updatedAt: timestamp
    };
    if (deltaCompleted !== 0) providerUpdate.completed = admin.firestore.FieldValue.increment(deltaCompleted);
    if (deltaFailed !== 0) providerUpdate.failed = admin.firestore.FieldValue.increment(deltaFailed);
    if (deltaCostUsd !== 0) providerUpdate.totalCostUsd = admin.firestore.FieldValue.increment(deltaCostUsd);
    if (deltaDurationSeconds !== 0) providerUpdate.totalDurationSeconds = admin.firestore.FieldValue.increment(deltaDurationSeconds);
    if (newlyCompleted) providerUpdate.totalCompletedOutputs = admin.firestore.FieldValue.increment(1);
    
    batch.set(providerRef, providerUpdate, { merge: true });

    // 4. Update Client Stats
    const clientRef = db.collection('analytics_clients').doc(jobToUse.clientId);
    const clientUpdate: any = {
      clientId: jobToUse.clientId,
      clientNameSnapshot: jobToUse.clientNameSnapshot,
      updatedAt: timestamp
    };
    if (deltaCompleted !== 0) clientUpdate.completed = admin.firestore.FieldValue.increment(deltaCompleted);
    if (deltaCostUsd !== 0) clientUpdate.totalCostUsd = admin.firestore.FieldValue.increment(deltaCostUsd);
    
    batch.set(clientRef, clientUpdate, { merge: true });
  }

  await batch.commit();
});
