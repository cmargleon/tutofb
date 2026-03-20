import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Job } from '../../../shared/src/types';
import { PROVIDER_COSTS } from '../../../shared/src/constants/providerCosts';

export const rebuildAnalytics = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new Error('Permission denied: Admin only');
  }

  const db = admin.firestore();
  const jobsSnapshot = await db.collection('jobs').get();
  
  let totalJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let pendingJobs = 0;
  let totalCostUsd = 0;
  let totalDurationSeconds = 0;
  let totalCompletedOutputs = 0;

  const dailyStats: Record<string, any> = {};
  const providerStats: Record<string, any> = {};
  const clientStats: Record<string, any> = {};

  const getMexicoCityDate = (dateObj: Date) => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(dateObj);
  };

  jobsSnapshot.forEach((doc) => {
    const job = doc.data() as Job;
    totalJobs++;

    if (job.status === 'completed') {
      completedJobs++;
      totalCompletedOutputs++; // Assuming 1 output per completed job for this rebuild
      
      const cost = PROVIDER_COSTS[job.provider] || 0;
      totalCostUsd += cost;

      let duration = 0;
      if (job.startedAt && job.completedAt) {
        const start = job.startedAt.toDate ? job.startedAt.toDate().getTime() : new Date(job.startedAt).getTime();
        const end = job.completedAt.toDate ? job.completedAt.toDate().getTime() : new Date(job.completedAt).getTime();
        duration = Math.max(0, (end - start) / 1000);
        totalDurationSeconds += duration;
      }

      // Daily
      const dateStr = getMexicoCityDate(job.completedAt ? (job.completedAt.toDate ? job.completedAt.toDate() : new Date(job.completedAt)) : new Date());
      if (!dailyStats[dateStr]) dailyStats[dateStr] = { completed: 0, failed: 0, costUsd: 0 };
      dailyStats[dateStr].completed++;
      dailyStats[dateStr].costUsd += cost;

      // Provider
      if (!providerStats[job.provider]) providerStats[job.provider] = { completed: 0, failed: 0, totalCostUsd: 0, totalDurationSeconds: 0, totalCompletedOutputs: 0 };
      providerStats[job.provider].completed++;
      providerStats[job.provider].totalCostUsd += cost;
      providerStats[job.provider].totalDurationSeconds += duration;
      providerStats[job.provider].totalCompletedOutputs++;

      // Client
      if (!clientStats[job.clientId]) clientStats[job.clientId] = { clientNameSnapshot: job.clientNameSnapshot, completed: 0, totalCostUsd: 0 };
      clientStats[job.clientId].completed++;
      clientStats[job.clientId].totalCostUsd += cost;

    } else if (job.status === 'failed') {
      failedJobs++;
      
      // Daily
      const dateStr = getMexicoCityDate(job.updatedAt ? (job.updatedAt.toDate ? job.updatedAt.toDate() : new Date(job.updatedAt)) : new Date());
      if (!dailyStats[dateStr]) dailyStats[dateStr] = { completed: 0, failed: 0, costUsd: 0 };
      dailyStats[dateStr].failed++;

      // Provider
      if (!providerStats[job.provider]) providerStats[job.provider] = { completed: 0, failed: 0, totalCostUsd: 0, totalDurationSeconds: 0, totalCompletedOutputs: 0 };
      providerStats[job.provider].failed++;
    } else {
      pendingJobs++;
    }
  });

  const batch = db.batch();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  // Global
  batch.set(db.collection('analytics_summary').doc('global'), {
    totalJobs,
    completedJobs,
    failedJobs,
    pendingJobs,
    totalCostUsd,
    totalDurationSeconds,
    totalCompletedOutputs,
    updatedAt: timestamp
  });

  // Daily
  for (const [date, stats] of Object.entries(dailyStats)) {
    batch.set(db.collection('analytics_daily').doc(date), {
      date,
      ...stats,
      updatedAt: timestamp
    });
  }

  // Provider
  for (const [provider, stats] of Object.entries(providerStats)) {
    batch.set(db.collection('analytics_providers').doc(provider), {
      provider,
      ...stats,
      updatedAt: timestamp
    });
  }

  // Client
  for (const [clientId, stats] of Object.entries(clientStats)) {
    batch.set(db.collection('analytics_clients').doc(clientId), {
      clientId,
      ...stats,
      updatedAt: timestamp
    });
  }

  await batch.commit();

  return { success: true, message: 'Analytics rebuilt successfully' };
});
