import type { AspectRatio, Provider, TimestampLike } from './common';

export type AutomationStatus = 'pending' | 'importing' | 'processing' | 'review' | 'completed' | 'failed' | 'needs_attention';
export type AutomationJobType = 'garment' | 'product';
export interface AutomationInput {
  itemId: string;
  fileName: string;
  storagePath?: string;
  url?: string;
}
export interface AutomationPreset {
  modelId?: string;
  poseIds?: string[];
  provider?: Provider;
  aspectRatio?: AspectRatio;
}
export interface CreateAutomationJobRequest {
  source: 'gmail' | 'manual' | 'api';
  externalId: string;
  gmailMessageId?: string;
  driveUrl?: string;
  clientId: string;
  jobType: AutomationJobType;
  modelId?: string;
  preset?: string;
  provider?: Provider;
  inputImages?: AutomationInput[];
  metadata?: Record<string, unknown>;
}
export interface AutomationJob extends CreateAutomationJobRequest {
  id: string;
  createdByUid: string;
  automationPrincipalId?: string;
  requestedPreset: string;
  status: AutomationStatus;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  startedAt: TimestampLike | null;
  completedAt: TimestampLike | null;
  failedAt: TimestampLike | null;
  error: { code: string; message: string } | null;
  inputImages: AutomationInput[];
  sourceImages?: AutomationInput[];
  outputImages: Array<{ storagePath: string; jobId: string; itemId: string; type: string }>;
  batchId: string | null;
  generationJobIds: string[];
  retryCount: number;
  leaseToken: string | null;
  leaseExpiresAt: TimestampLike | null;
  progress: { total: number; completed: number; failed: number };
}
export interface AutomationJobReceipt { jobId: string; status: AutomationStatus; duplicate?: boolean }
export interface RetryAutomationJobRequest { jobId: string; modelId?: string; preset?: string; provider?: Provider; inputImages?: AutomationInput[] }
