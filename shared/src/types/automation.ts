import type { AspectRatio, Provider, TimestampLike } from './common';
import type { ProviderImageConfig } from './provider';
import type { ProductSceneInput } from './productGeneration';

export type AutomationStatus = 'pending' | 'importing' | 'processing' | 'review' | 'completed' | 'failed' | 'needs_attention';
export type AutomationJobType = 'garment' | 'product';
export interface AutomationModelOption {
  gender: 'male' | 'female' | null;
  modelId: string;
  poseIds: string[];
}
export interface AutomationInput {
  itemId: string;
  fileName: string;
  storagePath?: string;
  normalizedSha256?: string;
  url?: string;
  driveFile?: { folderId: string; fileId: string; revisionId?: string; version?: string };
}
export interface AutomationPreset {
  modelId?: string;
  poseIds?: string[];
  provider?: Provider;
  aspectRatio?: AspectRatio;
  imageConfig?: ProviderImageConfig;
  prompt?: string;
  scenes?: ProductSceneInput[];
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
  budgetUsd?: number;
  maxReviewAttempts?: number;
  maxOperationalRetries?: number;
  authorizeClassification?: boolean;
  allowEstimatedCosts?: boolean;
}
export interface AutomationJob extends CreateAutomationJobRequest {
  manglarAuthorization?: { uid: string; connectionId: string; role: import('./common').Role; accessVersion: number };
  id: string;
  createdByUid: string;
  automationPrincipalId?: string;
  requestedPreset: string;
  clientNameSnapshot?: string;
  planId?: string;
  effectivePolicy?: AutomationPolicy;
  resolvedPreset?: AutomationPreset;
  modelOptions?: AutomationModelOption[];
  budget?: AutomationBudgetState;
  spendingPaused?: boolean;
  items?: AutomationItemState[];
  estimatedCostUsd?: number;
  analysisCache?: Record<string, import('./garment').ClassifyGarmentViewsResponse['garments'][number]>;
  classificationCache?: Record<string, import('./garment').UploadedGarmentInput>;
  status: AutomationStatus;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  startedAt: TimestampLike | null;
  completedAt: TimestampLike | null;
  failedAt: TimestampLike | null;
  error: { code: string; message: string } | null;
  inputImages: AutomationInput[];
  sourceImages?: AutomationInput[];
  outputImages: Array<{ storagePath: string; outputId?: string; jobId: string; itemId: string; type: string }>;
  batchId: string | null;
  batchIds?: string[];
  generationJobIds: string[];
  retryCount: number;
  leaseToken: string | null;
  leaseExpiresAt: TimestampLike | null;
  progress: { total: number; completed: number; failed: number };
}
export interface AutomationJobReceipt { jobId: string; status: AutomationStatus; duplicate?: boolean }
export interface RetryAutomationJobRequest { jobId: string; modelId?: string; preset?: string; provider?: Provider; inputImages?: AutomationInput[] }

export interface AutomationBudgetConfig {
  defaultBudgetUsd: number;
  maxBudgetUsd: number;
  maxReviewAttempts: number;
  maxOperationalRetries: number;
}
export interface ClientAutomationConfig {
  enabled?: boolean;
  driveFolderIds?: string[];
  defaultModelId?: string;
  defaultMaleModelId?: string;
  defaultFemaleModelId?: string;
  defaultPreset?: string;
  presets?: Record<string, AutomationPreset>;
  defaultBudgetUsd?: number;
  maxReviewAttempts?: number;
  maxOperationalRetries?: number;
}
export interface AutomationPolicy {
  budgetUsd: number;
  maxReviewAttempts: number;
  maxOperationalRetries: number;
  allowEstimatedCosts: boolean;
  authorizeClassification: boolean;
}
export interface AutomationBudgetState {
  limitUsd: number;
  reservedUsd: number;
  spentUsd: number;
  recordedUsd: number;
  providerConfirmedUsd: number | null;
}
export interface AutomationSceneState {
  jobId: string; scene: string;
  status: string; attempts: number; verdict: 'approved' | 'rejected' | null;
  reason: string | null;
}
export interface AutomationItemState {
  itemId: string; status: 'processing' | 'completed' | 'needs_attention';
  garmentGender?: import('./garment').GarmentGender | null;
  garmentGenderConfidence?: number | null;
  garmentGenderReasoning?: string | null;
  modelId?: string;
  issue?: { code: string; message: string };
  scenes: AutomationSceneState[];
}
export interface AutomationPlan {
  id: string; createdByUid: string; clientId: string; clientName: string;
  request: CreateAutomationJobRequest; presetName: string; preset: AutomationPreset;
  policy: AutomationPolicy; modelId: string | null;
  modelOptions?: AutomationModelOption[];
  items: Array<{ itemId: string; imageCount: number; sceneIds: string[]; estimatedCostUsd: number }>;
  estimatedCostUsd: number; classificationRequired: boolean;
  costGuarantee: 'estimated_authorization_required';
  createdAt: TimestampLike; executedJobId: string | null;
}
export interface UpdateClientAutomationRequest {
  clientId: string;
  automation: ClientAutomationConfig;
  /** Omitted by legacy callers that save the complete configuration. */
  section?: import('../clientAutomationSections').ClientAutomationSection;
  /** Optional optimistic concurrency guard for editors sharing a draft across tabs. */
  expectedAutomation?: ClientAutomationConfig | null;
}
export interface ResumeAutomationRequest { jobId: string; budgetUsd?: number }
export interface AutomationPlanSummary {
  planId: string; clientId: string; clientName: string; jobType: AutomationJobType;
  modelId: string | null; provider?: Provider; preset: string; imageConfig?: ProviderImageConfig;
  modelOptions?: AutomationModelOption[];
  items: AutomationPlan['items']; imageCount: number; policy: AutomationPolicy;
  estimatedCostUsd: number; classificationRequired: boolean; costGuarantee: string; executedJobId: string | null;
}
