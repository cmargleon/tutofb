import type { TimestampLike, HealthStatus } from './common';

export type SystemAlertId =
  | 'daily_cost'
  | 'recent_error_rate'
  | 'queue_backlog'
  | 'stale_processing_jobs'
  | 'provider_status';

export interface SystemAlert {
  id: SystemAlertId;
  status: HealthStatus;
  title: string;
  description: string;
  metricLabel?: string | null;
  currentValue?: number | string | null;
  thresholdValue?: number | string | null;
  checkedAt: TimestampLike;
}

export interface SystemAlertSettings {
  dailyCostUsdThreshold: number | null;
  recentErrorRateThreshold: number;
  pendingJobsThreshold: number;
  staleProcessingJobsThreshold: number;
  updatedAt?: TimestampLike;
  updatedByUid?: string | null;
  updatedByDisplayName?: string | null;
}

export interface SystemConfig {
  jobMaxRetries: number;
  jobRetryDelayMs: number;
  batchMaxJobs: number;
  geminiImageReviewModel: string;
  disabledProviders: string[];
  systemPromptOverride: string | null;
  systemPromptFullOutfit: string | null;
  systemPromptTopOnly: string | null;
  systemPromptBottomOnly: string | null;
  updatedAt?: TimestampLike | null;
  updatedByUid?: string | null;
  updatedByDisplayName?: string | null;
}

export interface UpdateSystemConfigRequest extends Partial<Omit<SystemConfig, 'updatedAt' | 'updatedByUid' | 'updatedByDisplayName'>> {}
export interface UpdateSystemConfigResponse { success: boolean; config: SystemConfig }
export interface GetSystemConfigResponse { config: SystemConfig }

export interface ProviderHealthCheck {
  provider: 'fal.ai' | 'OpenAI' | 'Gemini';
  status: HealthStatus;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  detail: string;
  checkedAt: TimestampLike;
}

export interface QueueHealthSnapshot {
  pendingJobs: number;
  processingJobs: number;
  staleProcessingJobs: number;
  recentCompletedJobs: number;
  recentFailedJobs: number;
  recentTerminalJobs: number;
  recentErrorRate: number;
  windowHours: number;
}

export interface SystemHealthSnapshot {
  overallStatus: HealthStatus;
  summary: string;
  providers: ProviderHealthCheck[];
  queue: QueueHealthSnapshot;
  alerts: SystemAlert[];
  settings: SystemAlertSettings;
  todayCostUsd: number;
  checkedAt: TimestampLike;
}

export interface UpdateSystemAlertSettingsRequest {
  dailyCostUsdThreshold: number | null;
  recentErrorRateThreshold: number;
  pendingJobsThreshold: number;
  staleProcessingJobsThreshold: number;
}

export interface UpdateSystemAlertSettingsResponse {
  success: boolean;
  settings: SystemAlertSettings;
}
