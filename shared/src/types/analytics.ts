import type { TimestampLike, Provider } from './common';

export interface AnalyticsSummary {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  processingJobs: number;
  firstPassApprovedJobs: number;
  firstPassApprovalRatePct: number;
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
  humanInterventionRatePct: number;
  humanReviewAvoidedRatePct: number;
  geminiPrecisionPct: number;
  geminiFalsePositiveRatePct: number;
  geminiFalseNegativeRatePct: number;
  successRate: number;
  avgDurationSeconds: number | null;
  totalCompletedOutputs: number;
  totalCostUsd: number;
  projectedMonthlyCostUsd: number | null;
  updatedAt: TimestampLike;
}

export interface AnalyticsDailyVolume {
  date: string;
  completed: number;
  failed: number;
  costUsd: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsDailyCost {
  date: string;
  costUsd: number;
}

export interface AnalyticsProviderStats {
  provider: Provider;
  completed: number;
  failed: number;
  avgDurationSeconds: number | null;
  costPerImageUsd: number;
  totalCostUsd: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsClientStats {
  clientId: string;
  clientNameSnapshot: string;
  completed: number;
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
  totalCostUsd: number;
  totalDurationSeconds: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsClientProviderStats {
  id: string;
  clientId: string;
  clientNameSnapshot: string;
  provider: Provider;
  completed: number;
  totalCostUsd: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsClientModelStats {
  id: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
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
  totalCompletedOutputs: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsData {
  summary: AnalyticsSummary | null;
  dailyVolume: AnalyticsDailyVolume[];
  dailyCost?: AnalyticsDailyCost[];
  byProvider: AnalyticsProviderStats[];
  topClients: AnalyticsClientStats[];
  costByClientProvider: AnalyticsClientProviderStats[];
  productivityByClientModel: AnalyticsClientModelStats[];
}

export type GeminiUsageFeature =
  | 'image_review'
  | 'garment_view_classification'
  | 'garment_view_category_color_classification'
  | 'pose_classification'
  | 'product_draft_enrichment';
export type GeminiUsageStatus = 'success' | 'error';

export interface GeminiUsageRecord {
  id: string;
  provider: 'gemini';
  feature: GeminiUsageFeature;
  operation: 'generateContent';
  model: string;
  status: GeminiUsageStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
  batchId?: string | null;
  jobId?: string | null;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
  modelId?: string | null;
  modelNameSnapshot?: string | null;
  garmentId?: string | null;
  garmentName?: string | null;
  poseId?: string | null;
  poseFileName?: string | null;
  userUid?: string | null;
  createdAt: TimestampLike;
}
