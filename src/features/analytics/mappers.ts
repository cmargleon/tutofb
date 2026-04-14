import { 
  AnalyticsSummary, 
  AnalyticsDailyVolume, 
  AnalyticsProviderStats, 
  AnalyticsClientStats,
  AnalyticsClientProviderStats,
  AnalyticsClientModelStats,
} from '../../../shared/src/types';

export const mapSummary = (data: any): AnalyticsSummary => {
  const completed = data.completedJobs || 0;
  const failed = data.failedJobs || 0;
  const totalDuration = data.totalDurationSeconds || 0;
  const totalCompletedOutputs = data.totalCompletedOutputs || completed; // fallback
  const firstPassApprovedJobs = data.firstPassApprovedJobs || 0;
  const autoReviewedJobs = data.autoReviewedJobs || 0;
  const geminiAgreedJobs = data.geminiAgreedJobs || 0;
  const geminiDisagreementJobs = data.geminiDisagreementJobs || 0;
  const geminiTruePositiveJobs = data.geminiTruePositiveJobs || 0;
  const geminiFalsePositiveJobs = data.geminiFalsePositiveJobs || 0;
  const geminiRejectedJobs = data.geminiRejectedJobs || 0;
  const geminiFalseNegativeJobs = data.geminiFalseNegativeJobs || 0;

  return {
    totalJobs: data.totalJobs || 0,
    completedJobs: completed,
    failedJobs: failed,
    pendingJobs: data.pendingJobs || 0,
    processingJobs: data.processingJobs || 0,
    autoReviewedJobs,
    geminiAgreedJobs,
    geminiDisagreementJobs,
    firstPassApprovedJobs,
    firstPassApprovalRatePct: completed > 0 ? Math.round((firstPassApprovedJobs / completed) * 100) : 0,
    jobsWithHumanIntervention: data.jobsWithHumanIntervention || 0,
    humanInterventionCount: data.humanInterventionCount || 0,
    manualSelectionCount: data.manualSelectionCount || 0,
    geminiApprovedJobs: data.geminiApprovedJobs || 0,
    geminiRejectedJobs,
    geminiTruePositiveJobs,
    geminiTrueNegativeJobs: data.geminiTrueNegativeJobs || 0,
    geminiFalsePositiveJobs,
    geminiFalseNegativeJobs,
    humanReviewAvoidedJobs: data.humanReviewAvoidedJobs || 0,
    humanInterventionRatePct:
      data.humanInterventionRatePct || ((data.totalJobs || 0) > 0 ? Math.round(((data.jobsWithHumanIntervention || 0) / data.totalJobs) * 100) : 0),
    humanReviewAvoidedRatePct:
      data.humanReviewAvoidedRatePct || ((data.totalJobs || 0) > 0 ? Math.round(((data.humanReviewAvoidedJobs || 0) / data.totalJobs) * 100) : 0),
    geminiPrecisionPct:
      data.geminiPrecisionPct || ((data.geminiApprovedJobs || 0) > 0
        ? Math.round((geminiTruePositiveJobs / data.geminiApprovedJobs) * 100)
        : 0),
    geminiFalsePositiveRatePct:
      data.geminiFalsePositiveRatePct || ((data.geminiApprovedJobs || 0) > 0 ? Math.round((geminiFalsePositiveJobs / data.geminiApprovedJobs) * 100) : 0),
    geminiFalseNegativeRatePct:
      data.geminiFalseNegativeRatePct || (geminiRejectedJobs > 0 ? Math.round((geminiFalseNegativeJobs / geminiRejectedJobs) * 100) : 0),
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
    totalJobs: data.totalJobs || 0,
    completedJobs: data.completedJobs || 0,
    failedJobs: data.failedJobs || 0,
    pendingJobs: data.pendingJobs || 0,
    processingJobs: data.processingJobs || 0,
    autoReviewedJobs: data.autoReviewedJobs || 0,
    geminiAgreedJobs: data.geminiAgreedJobs || 0,
    geminiDisagreementJobs: data.geminiDisagreementJobs || 0,
    firstPassApprovedJobs: data.firstPassApprovedJobs || 0,
    regeneratedCompletedJobs: data.regeneratedCompletedJobs || 0,
    jobsWithHumanIntervention: data.jobsWithHumanIntervention || 0,
    humanInterventionCount: data.humanInterventionCount || 0,
    manualSelectionCount: data.manualSelectionCount || 0,
    geminiApprovedJobs: data.geminiApprovedJobs || 0,
    geminiRejectedJobs: data.geminiRejectedJobs || 0,
    geminiTruePositiveJobs: data.geminiTruePositiveJobs || 0,
    geminiTrueNegativeJobs: data.geminiTrueNegativeJobs || 0,
    geminiFalsePositiveJobs: data.geminiFalsePositiveJobs || 0,
    geminiFalseNegativeJobs: data.geminiFalseNegativeJobs || 0,
    humanReviewAvoidedJobs: data.humanReviewAvoidedJobs || 0,
    manualRegenerationCount: data.manualRegenerationCount || 0,
    totalCostUsd: data.totalCostUsd || 0,
    totalDurationSeconds: data.totalDurationSeconds || 0,
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

export const mapClientModelStats = (id: string, data: any): AnalyticsClientModelStats => {
  return {
    id,
    clientId: data.clientId,
    clientNameSnapshot: data.clientNameSnapshot || 'Cliente Desconocido',
    modelId: data.modelId,
    modelNameSnapshot: data.modelNameSnapshot || 'Modelo desconocido',
    totalJobs: data.totalJobs || 0,
    completedJobs: data.completedJobs || 0,
    failedJobs: data.failedJobs || 0,
    pendingJobs: data.pendingJobs || 0,
    processingJobs: data.processingJobs || 0,
    autoReviewedJobs: data.autoReviewedJobs || 0,
    geminiAgreedJobs: data.geminiAgreedJobs || 0,
    geminiDisagreementJobs: data.geminiDisagreementJobs || 0,
    firstPassApprovedJobs: data.firstPassApprovedJobs || 0,
    regeneratedCompletedJobs: data.regeneratedCompletedJobs || 0,
    jobsWithHumanIntervention: data.jobsWithHumanIntervention || 0,
    humanInterventionCount: data.humanInterventionCount || 0,
    manualSelectionCount: data.manualSelectionCount || 0,
    geminiApprovedJobs: data.geminiApprovedJobs || 0,
    geminiRejectedJobs: data.geminiRejectedJobs || 0,
    geminiTruePositiveJobs: data.geminiTruePositiveJobs || 0,
    geminiTrueNegativeJobs: data.geminiTrueNegativeJobs || 0,
    geminiFalsePositiveJobs: data.geminiFalsePositiveJobs || 0,
    geminiFalseNegativeJobs: data.geminiFalseNegativeJobs || 0,
    humanReviewAvoidedJobs: data.humanReviewAvoidedJobs || 0,
    manualRegenerationCount: data.manualRegenerationCount || 0,
    totalCompletedOutputs: data.totalCompletedOutputs || 0,
    totalCostUsd: data.totalCostUsd || 0,
    totalDurationSeconds: data.totalDurationSeconds || 0,
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };
};
