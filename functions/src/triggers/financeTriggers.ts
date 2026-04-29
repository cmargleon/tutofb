import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { Batch, GeminiUsageRecord, Job, JobOutput, ModelGenerationLog } from '../../../shared/src/types';
import { buildMoneySnapshot, getFinanceSettingsCached } from '../finance/currency';
import { getFinancePeriod, recordFinanceEventOnce } from '../finance/events';
import { estimateBatchRevenue, getActiveClientPricing } from '../finance/pricing';

const terminalBatchStatuses = new Set(['completed', 'partial_failed', 'failed']);

export const onJobOutputFinanceCreate = onDocumentCreated('jobs/{jobId}/outputs/{outputId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const output = snapshot.data() as JobOutput;
  const settings = await getFinanceSettingsCached();
  const money = buildMoneySnapshot({
    amount: Number(output.costUsd || 0),
    currency: 'USD',
    settings,
    date: output.createdAt,
  });

  await recordFinanceEventOnce({
    eventId: `job_output_${event.params.jobId}_${event.params.outputId}_provider_cost`,
    type: 'cost',
    category: 'provider_generation',
    description: `Costo proveedor ${output.provider} para ${output.garmentName}`,
    money,
    clientId: output.clientId,
    clientNameSnapshot: output.clientNameSnapshot,
    batchId: output.batchId,
    jobId: output.jobId,
    modelId: output.modelId,
    modelNameSnapshot: output.modelNameSnapshot,
    provider: output.provider,
    quantity: 1,
    sourceCollection: `jobs/${event.params.jobId}/outputs`,
    sourceId: event.params.outputId,
    costSnapshot: {
      provider: output.provider,
      imageConfig: output.imageConfig || null,
      costUsd: output.costUsd || 0,
      generationAttempt: output.generationAttempt || null,
    },
    sourceCreatedAt: output.createdAt,
  });
});

export const onGeminiUsageFinanceCreate = onDocumentCreated('analytics_gemini_usage/{usageId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const usage = { id: snapshot.id, ...snapshot.data() } as GeminiUsageRecord;
  const settings = await getFinanceSettingsCached();
  const money = buildMoneySnapshot({
    amount: Number(usage.estimatedCostUsd || 0),
    currency: 'USD',
    settings,
    date: usage.createdAt,
  });

  await recordFinanceEventOnce({
    eventId: `gemini_usage_${usage.id}_cost`,
    type: 'cost',
    category: 'gemini_usage',
    description: `Costo Gemini ${usage.feature}`,
    money,
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
    costSnapshot: {
      feature: usage.feature,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      status: usage.status,
    },
    sourceCreatedAt: usage.createdAt,
  });
});

export const onModelGenerationFinanceCreate = onDocumentCreated('model_generation_logs/{logId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  const log = { id: snapshot.id, ...snapshot.data() } as ModelGenerationLog;
  const settings = await getFinanceSettingsCached();
  const money = buildMoneySnapshot({
    amount: Number(log.estimatedCostUsd || 0),
    currency: 'USD',
    settings,
    date: log.createdAt,
  });

  await recordFinanceEventOnce({
    eventId: `model_generation_${log.id}_cost`,
    type: 'cost',
    category: 'model_generation',
    description: `Costo de generación de fotos de modelo (${log.stage || 'general'})`,
    money,
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
    costSnapshot: {
      provider: log.provider,
      requestedPhotos: log.requestedPhotos,
      completedPhotos: log.completedPhotos,
      stage: log.stage || null,
      estimatedCostUsd: log.estimatedCostUsd,
    },
    sourceCreatedAt: log.createdAt,
  });
});

export const onJobHumanFinanceUpdate = onDocumentWritten('jobs/{jobId}', async (event) => {
  const before = event.data?.before.data() as Job | undefined;
  const after = event.data?.after.data() as Job | undefined;
  if (!after) return;

  const beforeCount = Number(before?.reviewSignals?.humanInterventionCount || before?.manualRegenerationCount || 0);
  const afterCount = Number(after.reviewSignals?.humanInterventionCount || after.manualRegenerationCount || 0);
  if (afterCount <= beforeCount) return;

  const settings = await getFinanceSettingsCached();
  const events = [];
  for (let index = beforeCount + 1; index <= afterCount; index += 1) {
    const money = buildMoneySnapshot({
      amount: settings.humanCostPerInterventionMxn,
      currency: 'MXN',
      settings,
      date: after.updatedAt,
    });
    events.push(recordFinanceEventOnce({
      eventId: `job_${event.params.jobId}_human_intervention_${index}`,
      type: 'cost',
      category: 'human_operation',
      description: `Costo humano por intervención #${index}`,
      money,
      clientId: after.clientId,
      clientNameSnapshot: after.clientNameSnapshot,
      batchId: after.batchId,
      jobId: event.params.jobId,
      modelId: after.modelId,
      modelNameSnapshot: after.modelNameSnapshot,
      provider: after.provider,
      userUid: after.reviewSignals?.lastHumanDecisionByUid || null,
      flow: after.reviewSignals?.lastHumanDecision || 'manual_intervention',
      quantity: 1,
      sourceCollection: 'jobs',
      sourceId: event.params.jobId,
      costSnapshot: {
        humanCostPerInterventionMxn: settings.humanCostPerInterventionMxn,
        interventionIndex: index,
        lastHumanDecision: after.reviewSignals?.lastHumanDecision || null,
      },
      sourceCreatedAt: after.updatedAt,
    }));
  }

  await Promise.all(events);
});

export const onBatchFinanceClose = onDocumentWritten('batches/{batchId}', async (event) => {
  const before = event.data?.before.data() as Batch | undefined;
  const after = event.data?.after.data() as Batch | undefined;
  if (!after || !terminalBatchStatuses.has(after.status)) return;
  if (before && terminalBatchStatuses.has(before.status)) return;

  const pricing = await getActiveClientPricing(after.clientId);
  const estimate = estimateBatchRevenue(pricing, after);
  if (!estimate || estimate.amount <= 0) return;

  const settings = await getFinanceSettingsCached();
  const money = buildMoneySnapshot({
    amount: estimate.amount,
    currency: estimate.currency,
    settings,
    date: after.updatedAt,
  });

  await recordFinanceEventOnce({
    eventId: `batch_${event.params.batchId}_estimated_revenue_v1`,
    period: getFinancePeriod(after.updatedAt),
    type: 'revenue',
    category: 'estimated_revenue',
    description: estimate.description,
    money,
    clientId: after.clientId,
    clientNameSnapshot: after.clientNameSnapshot,
    batchId: event.params.batchId,
    jobId: null,
    modelId: after.modelId,
    modelNameSnapshot: after.modelNameSnapshot,
    provider: after.provider,
    quantity: estimate.quantity,
    sourceCollection: 'batches',
    sourceId: event.params.batchId,
    pricingSnapshot: pricing,
    costSnapshot: {
      batchStatus: after.status,
      totalJobs: after.totalJobs,
      completedJobs: after.completedJobs,
      completedOutputCount: after.completedOutputCount || 0,
    },
    sourceCreatedAt: after.updatedAt,
  });
});
