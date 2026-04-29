import { onCall } from 'firebase-functions/v2/https';
import {
  Batch,
  GeminiUsageRecord,
  Job,
  JobOutput,
  ModelGenerationLog,
  RebuildFinanceSnapshotsRequest,
  RebuildFinanceSnapshotsResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildMoneySnapshot, getFinanceSettingsCached } from '../finance/currency';
import { getFinancePeriod, recordFinanceEventOnce } from '../finance/events';
import { estimateBatchRevenue, getActiveClientPricing } from '../finance/pricing';

const matchesPeriod = (period: string, value: unknown) => getFinancePeriod(value || new Date()) === period;
const terminalStatuses = new Set(['completed', 'partial_failed', 'failed']);

export const rebuildFinanceSnapshots = onCall<RebuildFinanceSnapshotsRequest, Promise<RebuildFinanceSnapshotsResponse>>(
  { timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const period = typeof request.data?.period === 'string' && /^\d{4}-\d{2}$/.test(request.data.period)
      ? request.data.period
      : getFinancePeriod(new Date());
    const db = getAppFirestore();
    const settings = await getFinanceSettingsCached();
    let eventsCreated = 0;
    let skippedEvents = 0;

    const record = async (promise: Promise<boolean>) => {
      const created = await promise;
      if (created) eventsCreated += 1;
      else skippedEvents += 1;
    };

    const outputsSnapshot = await db.collectionGroup('outputs').limit(5000).get();
    for (const doc of outputsSnapshot.docs) {
      const output = doc.data() as JobOutput;
      if (!matchesPeriod(period, output.createdAt)) continue;
      await record(recordFinanceEventOnce({
        eventId: `job_output_${output.jobId || doc.ref.parent.parent?.id || 'unknown'}_${doc.id}_provider_cost`,
        period,
        type: 'cost',
        category: 'provider_generation',
        description: `Costo proveedor ${output.provider} para ${output.garmentName}`,
        money: buildMoneySnapshot({ amount: Number(output.costUsd || 0), currency: 'USD', settings, date: output.createdAt }),
        clientId: output.clientId,
        clientNameSnapshot: output.clientNameSnapshot,
        batchId: output.batchId,
        jobId: output.jobId || doc.ref.parent.parent?.id || null,
        modelId: output.modelId,
        modelNameSnapshot: output.modelNameSnapshot,
        provider: output.provider,
        quantity: 1,
        sourceCollection: `jobs/${output.jobId || doc.ref.parent.parent?.id}/outputs`,
        sourceId: doc.id,
        costSnapshot: { provider: output.provider, imageConfig: output.imageConfig || null, costUsd: output.costUsd || 0 },
        sourceCreatedAt: output.createdAt,
      }));
    }

    const geminiSnapshot = await db.collection('analytics_gemini_usage').limit(5000).get();
    for (const doc of geminiSnapshot.docs) {
      const usage = { id: doc.id, ...doc.data() } as GeminiUsageRecord;
      if (!matchesPeriod(period, usage.createdAt)) continue;
      await record(recordFinanceEventOnce({
        eventId: `gemini_usage_${usage.id}_cost`,
        period,
        type: 'cost',
        category: 'gemini_usage',
        description: `Costo Gemini ${usage.feature}`,
        money: buildMoneySnapshot({ amount: Number(usage.estimatedCostUsd || 0), currency: 'USD', settings, date: usage.createdAt }),
        clientId: usage.clientId || null,
        clientNameSnapshot: usage.clientNameSnapshot || null,
        batchId: usage.batchId || null,
        jobId: usage.jobId || null,
        modelId: usage.modelId || null,
        modelNameSnapshot: usage.modelNameSnapshot || null,
        provider: 'gemini',
        quantity: usage.totalTokens || null,
        sourceCollection: 'analytics_gemini_usage',
        sourceId: usage.id,
        costSnapshot: { feature: usage.feature, model: usage.model, estimatedCostUsd: usage.estimatedCostUsd },
        sourceCreatedAt: usage.createdAt,
      }));
    }

    const modelLogsSnapshot = await db.collection('model_generation_logs').limit(5000).get();
    for (const doc of modelLogsSnapshot.docs) {
      const log = { id: doc.id, ...doc.data() } as ModelGenerationLog;
      if (!matchesPeriod(period, log.createdAt)) continue;
      await record(recordFinanceEventOnce({
        eventId: `model_generation_${log.id}_cost`,
        period,
        type: 'cost',
        category: 'model_generation',
        description: `Costo de generación de fotos de modelo (${log.stage || 'general'})`,
        money: buildMoneySnapshot({ amount: Number(log.estimatedCostUsd || 0), currency: 'USD', settings, date: log.createdAt }),
        clientId: log.clientId,
        clientNameSnapshot: null,
        batchId: null,
        jobId: null,
        modelId: log.modelId || null,
        modelNameSnapshot: null,
        provider: log.provider,
        quantity: log.completedPhotos,
        sourceCollection: 'model_generation_logs',
        sourceId: log.id!,
        costSnapshot: { provider: log.provider, completedPhotos: log.completedPhotos, estimatedCostUsd: log.estimatedCostUsd },
        sourceCreatedAt: log.createdAt,
      }));
    }

    const jobsSnapshot = await db.collection('jobs').limit(5000).get();
    for (const doc of jobsSnapshot.docs) {
      const job = { id: doc.id, ...doc.data() } as Job;
      const interventions = Number(job.reviewSignals?.humanInterventionCount || job.manualRegenerationCount || 0);
      if (interventions <= 0 || !matchesPeriod(period, job.updatedAt)) continue;
      for (let index = 1; index <= interventions; index += 1) {
        await record(recordFinanceEventOnce({
          eventId: `job_${doc.id}_human_intervention_${index}`,
          period,
          type: 'cost',
          category: 'human_operation',
          description: `Costo humano por intervención #${index}`,
          money: buildMoneySnapshot({ amount: settings.humanCostPerInterventionMxn, currency: 'MXN', settings, date: job.updatedAt }),
          clientId: job.clientId,
          clientNameSnapshot: job.clientNameSnapshot,
          batchId: job.batchId,
          jobId: doc.id,
          modelId: job.modelId,
          modelNameSnapshot: job.modelNameSnapshot,
          provider: job.provider,
          quantity: 1,
          sourceCollection: 'jobs',
          sourceId: doc.id,
          costSnapshot: { humanCostPerInterventionMxn: settings.humanCostPerInterventionMxn, interventionIndex: index },
          sourceCreatedAt: job.updatedAt,
        }));
      }
    }

    const batchesSnapshot = await db.collection('batches').limit(5000).get();
    for (const doc of batchesSnapshot.docs) {
      const batch = { id: doc.id, ...doc.data() } as Batch;
      if (!terminalStatuses.has(batch.status) || !matchesPeriod(period, batch.updatedAt)) continue;
      const pricing = await getActiveClientPricing(batch.clientId);
      const estimate = estimateBatchRevenue(pricing, batch);
      if (!estimate || estimate.amount <= 0) continue;
      await record(recordFinanceEventOnce({
        eventId: `batch_${doc.id}_estimated_revenue_v1`,
        period,
        type: 'revenue',
        category: 'estimated_revenue',
        description: estimate.description,
        money: buildMoneySnapshot({ amount: estimate.amount, currency: estimate.currency, settings, date: batch.updatedAt }),
        clientId: batch.clientId,
        clientNameSnapshot: batch.clientNameSnapshot,
        batchId: doc.id,
        jobId: null,
        modelId: batch.modelId,
        modelNameSnapshot: batch.modelNameSnapshot,
        provider: batch.provider,
        quantity: estimate.quantity,
        sourceCollection: 'batches',
        sourceId: doc.id,
        pricingSnapshot: pricing,
        costSnapshot: { batchStatus: batch.status, totalJobs: batch.totalJobs, completedJobs: batch.completedJobs },
        sourceCreatedAt: batch.updatedAt,
      }));
    }

    return { success: true, period, eventsCreated, skippedEvents };
  },
);
