import { Timestamp } from 'firebase-admin/firestore';
import {
  AnalyticsClientStats,
  AnalyticsClientModelStats,
  AnalyticsClientProviderStats,
  AnalyticsDailyVolume,
  AnalyticsProviderStats,
  AnalyticsSummary,
  Job,
  JobOutput,
  Provider,
} from '../../../shared/src/types';
import { PROVIDER_COSTS } from '../../../shared/src/constants/providerCosts';

export interface AnalyticsRebuildData {
  summary: AnalyticsSummary;
  daily: AnalyticsDailyVolume[];
  providers: AnalyticsProviderStats[];
  clients: AnalyticsClientStats[];
  clientProviders: AnalyticsClientProviderStats[];
  clientModels: AnalyticsClientModelStats[];
}

export interface JobStateDelta {
  summary: Partial<Record<'totalJobs' | 'completedJobs' | 'failedJobs' | 'pendingJobs' | 'processingJobs', number>>;
  providerFailed: Partial<Record<Provider, number>>;
  dailyFailed: Array<{ date: string; delta: number }>;
}

const toDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }

  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMexicoCityDate = (value: unknown): string => {
  const date = toDate(value) || new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(date);
};

const emptyStateSummary = (): AnalyticsSummary => ({
  totalJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  pendingJobs: 0,
  processingJobs: 0,
  firstPassApprovedJobs: 0,
  firstPassApprovalRatePct: 0,
  successRate: 0,
  avgDurationSeconds: null,
  totalCompletedOutputs: 0,
  totalCostUsd: 0,
  projectedMonthlyCostUsd: null,
  updatedAt: new Date(),
});

const isFirstPassApprovedJob = (job: Job): boolean => job.status === 'completed' && (job.manualRegenerationCount || 0) === 0;

const isRegeneratedCompletedJob = (job: Job): boolean =>
  job.status === 'completed' && (job.manualRegenerationCount || 0) > 0;

const increment = <T extends string>(target: Partial<Record<T, number>>, key: T, delta: number): void => {
  target[key] = (target[key] || 0) + delta;
};

const applyJobStatus = (
  target: Partial<Record<'completedJobs' | 'failedJobs' | 'pendingJobs' | 'processingJobs', number>>,
  status: Job['status'],
  delta: number,
): void => {
  if (status === 'completed') {
    increment(target, 'completedJobs', delta);
    return;
  }

  if (status === 'failed') {
    increment(target, 'failedJobs', delta);
    return;
  }

  if (status === 'processing') {
    increment(target, 'processingJobs', delta);
    return;
  }

  increment(target, 'pendingJobs', delta);
};

export const getJobStateDelta = (before: Job | undefined, after: Job | undefined): JobStateDelta => {
  const summary: JobStateDelta['summary'] = {};
  const providerFailed: JobStateDelta['providerFailed'] = {};
  const dailyFailed: JobStateDelta['dailyFailed'] = [];

  if (!before && after) {
    increment(summary, 'totalJobs', 1);
    applyJobStatus(summary, after.status, 1);

    if (after.status === 'failed') {
      providerFailed[after.provider] = (providerFailed[after.provider] || 0) + 1;
      dailyFailed.push({ date: formatMexicoCityDate(after.updatedAt), delta: 1 });
    }

    return { summary, providerFailed, dailyFailed };
  }

  if (before && !after) {
    increment(summary, 'totalJobs', -1);
    applyJobStatus(summary, before.status, -1);

    if (before.status === 'failed') {
      providerFailed[before.provider] = (providerFailed[before.provider] || 0) - 1;
      dailyFailed.push({ date: formatMexicoCityDate(before.updatedAt), delta: -1 });
    }

    return { summary, providerFailed, dailyFailed };
  }

  if (!before || !after) {
    return { summary, providerFailed, dailyFailed };
  }

  if (before.status !== after.status) {
    applyJobStatus(summary, before.status, -1);
    applyJobStatus(summary, after.status, 1);
  }

  if (before.status === 'failed') {
    providerFailed[before.provider] = (providerFailed[before.provider] || 0) - 1;
    dailyFailed.push({ date: formatMexicoCityDate(before.updatedAt), delta: -1 });
  }

  if (after.status === 'failed') {
    providerFailed[after.provider] = (providerFailed[after.provider] || 0) + 1;
    dailyFailed.push({ date: formatMexicoCityDate(after.updatedAt), delta: 1 });
  }

  return { summary, providerFailed, dailyFailed };
};

export const buildAnalyticsSnapshot = (jobs: Job[], outputs: JobOutput[]): AnalyticsRebuildData => {
  const summary = emptyStateSummary();
  const dailyMap = new Map<string, AnalyticsDailyVolume>();
  const providerMap = new Map<Provider, AnalyticsProviderStats>();
  const clientMap = new Map<string, AnalyticsClientStats>();
  const clientProviderMap = new Map<string, AnalyticsClientProviderStats>();
  const clientModelMap = new Map<string, AnalyticsClientModelStats>();

  jobs.forEach((job) => {
    summary.totalJobs += 1;
    if (job.status === 'completed') {
      summary.completedJobs += 1;
      if (isFirstPassApprovedJob(job)) {
        summary.firstPassApprovedJobs += 1;
      }
    } else if (job.status === 'failed') {
      summary.failedJobs += 1;

      const date = formatMexicoCityDate(job.updatedAt);
      const currentDaily = dailyMap.get(date) || {
        date,
        completed: 0,
        failed: 0,
        costUsd: 0,
        updatedAt: new Date(),
      };
      currentDaily.failed += 1;
      dailyMap.set(date, currentDaily);

      const providerStats = providerMap.get(job.provider) || {
        provider: job.provider,
        completed: 0,
        failed: 0,
        avgDurationSeconds: null,
        costPerImageUsd: PROVIDER_COSTS[job.provider],
        totalCostUsd: 0,
        updatedAt: new Date(),
      };
      providerStats.failed += 1;
      providerMap.set(job.provider, providerStats);
    } else if (job.status === 'processing') {
      summary.processingJobs += 1;
    } else {
      summary.pendingJobs += 1;
    }

    const clientStats = clientMap.get(job.clientId) || {
      clientId: job.clientId,
      clientNameSnapshot: job.clientNameSnapshot,
      completed: 0,
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      firstPassApprovedJobs: 0,
      regeneratedCompletedJobs: 0,
      manualRegenerationCount: 0,
      totalCostUsd: 0,
      totalDurationSeconds: 0,
      updatedAt: new Date(),
    };
    clientStats.totalJobs += 1;
    clientStats.manualRegenerationCount += job.manualRegenerationCount || 0;
    if (job.status === 'completed') clientStats.completedJobs += 1;
    if (job.status === 'failed') clientStats.failedJobs += 1;
    if (job.status === 'pending') clientStats.pendingJobs += 1;
    if (job.status === 'processing') clientStats.processingJobs += 1;
    if (isFirstPassApprovedJob(job)) clientStats.firstPassApprovedJobs += 1;
    if (isRegeneratedCompletedJob(job)) clientStats.regeneratedCompletedJobs += 1;
    clientStats.updatedAt = new Date();
    clientMap.set(job.clientId, clientStats);

    const clientModelKey = `${job.clientId}__${job.modelId}`;
    const clientModelStats = clientModelMap.get(clientModelKey) || {
      id: clientModelKey,
      clientId: job.clientId,
      clientNameSnapshot: job.clientNameSnapshot,
      modelId: job.modelId,
      modelNameSnapshot: job.modelNameSnapshot,
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      firstPassApprovedJobs: 0,
      regeneratedCompletedJobs: 0,
      manualRegenerationCount: 0,
      totalCompletedOutputs: 0,
      totalCostUsd: 0,
      totalDurationSeconds: 0,
      updatedAt: new Date(),
    };
    clientModelStats.totalJobs += 1;
    clientModelStats.manualRegenerationCount += job.manualRegenerationCount || 0;
    if (job.status === 'completed') clientModelStats.completedJobs += 1;
    if (job.status === 'failed') clientModelStats.failedJobs += 1;
    if (job.status === 'pending') clientModelStats.pendingJobs += 1;
    if (job.status === 'processing') clientModelStats.processingJobs += 1;
    if (isFirstPassApprovedJob(job)) clientModelStats.firstPassApprovedJobs += 1;
    if (isRegeneratedCompletedJob(job)) clientModelStats.regeneratedCompletedJobs += 1;
    clientModelStats.updatedAt = new Date();
    clientModelMap.set(clientModelKey, clientModelStats);
  });

  outputs.forEach((output) => {
    summary.totalCompletedOutputs += 1;
    summary.totalCostUsd += output.costUsd || 0;
    summary.avgDurationSeconds = null;

    const providerStats = providerMap.get(output.provider) || {
      provider: output.provider,
      completed: 0,
      failed: 0,
      avgDurationSeconds: null,
      costPerImageUsd: PROVIDER_COSTS[output.provider],
      totalCostUsd: 0,
      updatedAt: new Date(),
    };
    providerStats.completed += 1;
    providerStats.totalCostUsd += output.costUsd || 0;
    providerStats.updatedAt = new Date();
    providerMap.set(output.provider, providerStats);

    const clientStats = clientMap.get(output.clientId) || {
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      completed: 0,
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      firstPassApprovedJobs: 0,
      regeneratedCompletedJobs: 0,
      manualRegenerationCount: 0,
      totalCostUsd: 0,
      totalDurationSeconds: 0,
      updatedAt: new Date(),
    };
    clientStats.completed += 1;
    clientStats.totalCostUsd += output.costUsd || 0;
    clientStats.totalDurationSeconds += output.durationSeconds || 0;
    clientStats.updatedAt = new Date();
    clientMap.set(output.clientId, clientStats);

    const clientProviderKey = `${output.clientId}__${output.provider}`;
    const clientProviderStats = clientProviderMap.get(clientProviderKey) || {
      id: clientProviderKey,
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      provider: output.provider,
      completed: 0,
      totalCostUsd: 0,
      updatedAt: new Date(),
    };
    clientProviderStats.completed += 1;
    clientProviderStats.totalCostUsd += output.costUsd || 0;
    clientProviderStats.updatedAt = new Date();
    clientProviderMap.set(clientProviderKey, clientProviderStats);

    const clientModelKey = `${output.clientId}__${output.modelId}`;
    const clientModelStats = clientModelMap.get(clientModelKey) || {
      id: clientModelKey,
      clientId: output.clientId,
      clientNameSnapshot: output.clientNameSnapshot,
      modelId: output.modelId,
      modelNameSnapshot: output.modelNameSnapshot,
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      processingJobs: 0,
      firstPassApprovedJobs: 0,
      regeneratedCompletedJobs: 0,
      manualRegenerationCount: 0,
      totalCompletedOutputs: 0,
      totalCostUsd: 0,
      totalDurationSeconds: 0,
      updatedAt: new Date(),
    };
    clientModelStats.totalCompletedOutputs += 1;
    clientModelStats.totalCostUsd += output.costUsd || 0;
    clientModelStats.totalDurationSeconds += output.durationSeconds || 0;
    clientModelStats.updatedAt = new Date();
    clientModelMap.set(clientModelKey, clientModelStats);

    const date = formatMexicoCityDate(output.createdAt);
    const daily = dailyMap.get(date) || {
      date,
      completed: 0,
      failed: 0,
      costUsd: 0,
      updatedAt: new Date(),
    };
    daily.completed += 1;
    daily.costUsd += output.costUsd || 0;
    daily.updatedAt = new Date();
    dailyMap.set(date, daily);
  });

  const totalDuration = outputs.reduce((sum, output) => sum + (output.durationSeconds || 0), 0);
  summary.successRate =
    summary.completedJobs + summary.failedJobs > 0
      ? Math.round((summary.completedJobs / (summary.completedJobs + summary.failedJobs)) * 100)
      : 0;
  summary.firstPassApprovalRatePct =
    summary.completedJobs > 0 ? Math.round((summary.firstPassApprovedJobs / summary.completedJobs) * 100) : 0;
  summary.avgDurationSeconds =
    summary.totalCompletedOutputs > 0 ? Math.round(totalDuration / summary.totalCompletedOutputs) : null;
  summary.updatedAt = new Date();

  const providers = Array.from(providerMap.values()).map((providerStats) => {
    const providerOutputs = outputs.filter((output) => output.provider === providerStats.provider);
    const durationTotal = providerOutputs.reduce((sum, output) => sum + (output.durationSeconds || 0), 0);
    const completed = providerStats.completed;

    return {
      ...providerStats,
      avgDurationSeconds: completed > 0 ? Math.round(durationTotal / completed) : null,
      costPerImageUsd: completed > 0 ? Number((providerStats.totalCostUsd / completed).toFixed(4)) : PROVIDER_COSTS[providerStats.provider],
      totalCostUsd: Number(providerStats.totalCostUsd.toFixed(4)),
      updatedAt: new Date(),
    };
  });

  const clients = Array.from(clientMap.values())
    .sort((left, right) => right.completed - left.completed)
    .slice(0, 10)
    .map((client) => ({
      ...client,
      totalCostUsd: Number(client.totalCostUsd.toFixed(4)),
      totalDurationSeconds: Math.round(client.totalDurationSeconds),
      updatedAt: new Date(),
    }));

  const clientProviders = Array.from(clientProviderMap.values())
    .sort((left, right) => right.totalCostUsd - left.totalCostUsd)
    .map((entry) => ({
      ...entry,
      totalCostUsd: Number(entry.totalCostUsd.toFixed(4)),
      updatedAt: new Date(),
    }));

  const clientModels = Array.from(clientModelMap.values())
    .sort((left, right) => {
      if (right.completedJobs !== left.completedJobs) {
        return right.completedJobs - left.completedJobs;
      }

      return right.totalCostUsd - left.totalCostUsd;
    })
    .map((entry) => ({
      ...entry,
      totalCostUsd: Number(entry.totalCostUsd.toFixed(4)),
      totalDurationSeconds: Math.round(entry.totalDurationSeconds),
      updatedAt: new Date(),
    }));

  const daily = Array.from(dailyMap.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({
      ...entry,
      costUsd: Number(entry.costUsd.toFixed(4)),
      updatedAt: new Date(),
    }));

  return {
    summary: {
      ...summary,
      totalCostUsd: Number(summary.totalCostUsd.toFixed(4)),
    },
    daily,
    providers,
    clients,
    clientProviders,
    clientModels,
  };
};
