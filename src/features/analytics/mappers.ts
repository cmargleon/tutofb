import { 
  AnalyticsSummary, 
  AnalyticsDailyVolume, 
  AnalyticsProviderStats, 
  AnalyticsClientStats,
  AnalyticsClientProviderStats,
} from '../../../shared/src/types';

export const mapSummary = (data: any): AnalyticsSummary => {
  const completed = data.completedJobs || 0;
  const failed = data.failedJobs || 0;
  const totalDuration = data.totalDurationSeconds || 0;
  const totalCompletedOutputs = data.totalCompletedOutputs || completed; // fallback

  return {
    totalJobs: data.totalJobs || 0,
    completedJobs: completed,
    failedJobs: failed,
    pendingJobs: data.pendingJobs || 0,
    processingJobs: data.processingJobs || 0,
    successRate: (completed + failed) > 0 ? Math.round((completed / (completed + failed)) * 100) : 0,
    avgDurationSeconds: totalCompletedOutputs > 0 ? Math.round(totalDuration / totalCompletedOutputs) : 0,
    totalCompletedOutputs: totalCompletedOutputs,
    totalCostUsd: data.totalCostUsd || 0,
    projectedMonthlyCostUsd: 0, // Will be calculated in the hook based on daily data
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

export const mapDailyVolume = (data: any): AnalyticsDailyVolume => {
  return {
    date: data.date,
    completed: data.completed || 0,
    failed: data.failed || 0,
    costUsd: data.costUsd || 0,
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

export const mapProviderStats = (data: any): AnalyticsProviderStats => {
  const completed = data.completed || 0;
  const totalDuration = data.totalDurationSeconds || 0;
  const totalCompletedOutputs = data.totalCompletedOutputs || completed;
  const totalCostUsd = data.totalCostUsd || 0;

  return {
    provider: data.provider,
    completed: completed,
    failed: data.failed || 0,
    avgDurationSeconds: totalCompletedOutputs > 0 ? Math.round(totalDuration / totalCompletedOutputs) : 0,
    costPerImageUsd: totalCompletedOutputs > 0 ? Number((totalCostUsd / totalCompletedOutputs).toFixed(3)) : 0,
    totalCostUsd: totalCostUsd,
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

export const mapClientStats = (data: any): AnalyticsClientStats => {
  return {
    clientId: data.clientId,
    clientNameSnapshot: data.clientNameSnapshot || 'Cliente Desconocido',
    completed: data.completed || 0,
    totalCostUsd: data.totalCostUsd || 0,
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};

export const mapClientProviderStats = (id: string, data: any): AnalyticsClientProviderStats => {
  return {
    id,
    clientId: data.clientId,
    clientNameSnapshot: data.clientNameSnapshot || 'Cliente Desconocido',
    provider: data.provider,
    completed: data.completed || 0,
    totalCostUsd: data.totalCostUsd || 0,
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};
