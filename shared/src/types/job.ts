import type {
  TimestampLike,
  Provider,
  AspectRatio,
  JobStatus,
  GarmentSourceType,
  GarmentReferenceImageType,
  GarmentView,
  GarmentBodyArea,
  GarmentAccessoryType,
  PoseFraming,
  PoseOrientationDetail,
  PoseOrientationGroup,
  PoseBodyFocus,
  AccessoryDisplaySlot,
  TryOnPromptCaseKey,
} from './common';
import type { ModelIdentityTraits } from './model';
import type { ProviderImageConfig } from './provider';

export interface ProviderUsageStats {
  completedOutputs: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
}

export type JobAutoReviewVerdict = 'approved' | 'rejected';

export interface JobAutoReviewCriterion {
  key: string;
  label: string;
  passed: boolean;
  notes: string;
}

export interface JobAutoReviewMarketplaceData {
  title: string | null;
  description: string | null;
  brand: string | null;
  gender: string | null;
  garmentType: string | null;
  primaryColor: string | null;
  sport: string | null;
  isSportswear: boolean | null;
}

export interface JobAutoReview {
  model: string;
  verdict: JobAutoReviewVerdict;
  summary: string;
  reviewPrompt: string;
  revisedPrompt: string | null;
  criteria: JobAutoReviewCriterion[];
  marketplaceData: JobAutoReviewMarketplaceData;
  attemptNumber: number;
  reviewedAt: TimestampLike;
}

export type JobHumanReviewDecision =
  | 'selected_auto_approved_output'
  | 'selected_auto_rejected_output'
  | 'selected_alternative_output'
  | 'regenerated_after_auto_approved'
  | 'regenerated_after_auto_rejected'
  | 'regenerated_without_auto_review'
  | 'cleared_manual_selection';

export interface JobReviewSignals {
  firstAutoReviewVerdict: JobAutoReviewVerdict | null;
  latestAutoReviewVerdict: JobAutoReviewVerdict | null;
  hasHumanIntervention: boolean;
  humanInterventionCount: number;
  manualSelectionCount: number;
  hasGeminiFalsePositive: boolean;
  hasGeminiFalseNegative: boolean;
  lastHumanDecision: JobHumanReviewDecision | null;
  lastHumanDecisionAt: TimestampLike | null;
  lastHumanDecisionByUid: string | null;
  lastHumanDecisionByDisplayName: string | null;
  lastSelectedOutputId?: string | null;
  lastSelectedOutputVerdict?: JobAutoReviewVerdict | 'unreviewed' | null;
}

export interface JobTraceabilitySummary {
  batchCreatedAt?: TimestampLike | null;
  batchCreatedByUid?: string | null;
  batchCreatedByDisplayName?: string | null;
  lastAttemptStartedAt?: TimestampLike | null;
  lastCompletedAt?: TimestampLike | null;
  lastManualRegenerationAt?: TimestampLike | null;
  lastManualRegeneratedByUid?: string | null;
  lastManualRegeneratedByDisplayName?: string | null;
  lastProviderErrorAt?: TimestampLike | null;
  lastProviderErrorMessage?: string | null;
}

export type JobFailureSource = 'provider' | 'gemini' | 'operator' | 'system';

export type JobFailureStage = 'generation' | 'validation' | 'delivery' | 'manual' | 'system';

export type JobFailureReasonCode =
  | 'provider_http_error'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_missing_request_id'
  | 'provider_failed_status'
  | 'provider_no_image'
  | 'provider_image_download_failed'
  | 'provider_configuration_missing'
  | 'gemini_api_error'
  | 'gemini_timeout'
  | 'gemini_empty_response'
  | 'gemini_finish_reason'
  | 'gemini_prompt_blocked'
  | 'gemini_rejected_output'
  | 'manual_cancellation'
  | 'job_timeout'
  | 'legacy_error'
  | 'unknown';

export interface JobFailureInfo {
  source: JobFailureSource;
  stage: JobFailureStage;
  reasonCode: JobFailureReasonCode;
  title: string;
  userMessage: string;
  technicalMessage?: string | null;
  retryable: boolean;
  provider?: Provider | null;
  requestId?: string | null;
  outputId?: string | null;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
  httpStatus?: number | null;
  providerStatus?: string | null;
  finishReason?: string | null;
  promptFeedback?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
  occurredAt?: TimestampLike | null;
}

export interface JobOutput {
  id: string;
  jobId: string;
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  poseImageId: string;
  garmentId: string;
  garmentName: string;
  provider: Provider;
  requestedPromptBase?: string;
  promptBase: string;
  finalPrompt: string;
  aspectRatio: AspectRatio;
  imageConfig?: ProviderImageConfig | null;
  resultImagePath: string;
  contentType: string;
  remoteUrl: string | null;
  requestId: string | null;
  costUsd: number;
  durationSeconds: number | null;
  providerResponseSummary?: Record<string, unknown> | null;
  generationAttempt?: number | null;
  autoReview?: JobAutoReview | null;
  failureInfo?: JobFailureInfo | null;
  isCurrent: boolean;
  storageDeletedAt?: TimestampLike | null;
  createdAt: TimestampLike;
}

export interface Job {
  id?: string;
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  poseImageId: string;
  poseImagePath: string;
  poseFileName?: string;
  poseOrientationGroup?: PoseOrientationGroup | null;
  poseOrientationDetail?: PoseOrientationDetail | null;
  poseFraming?: PoseFraming | null;
  poseBodyFocus?: PoseBodyFocus | null;
  poseAccessoryDisplaySlots?: AccessoryDisplaySlot[];
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  garmentPhotoId?: string | null;
  garmentPhotoFileName?: string | null;
  garmentView?: GarmentView | null;
  garmentBodyArea?: GarmentBodyArea | null;
  garmentAccessoryType?: GarmentAccessoryType | null;
  productDraftId?: string | null;
  garmentSourceType?: GarmentSourceType;
  garmentOriginalFileNames?: string[];
  garmentIsMultiAngle: boolean;
  garmentReferenceImageType?: GarmentReferenceImageType;
  aspectRatio: AspectRatio;
  imageConfig?: ProviderImageConfig | null;
  provider: Provider;
  modelIdentityTraitsSnapshot?: ModelIdentityTraits | null;
  requestedPromptBase?: string;
  promptBase: string;
  promptCaseKey?: TryOnPromptCaseKey | null;
  promptCaseText?: string | null;
  finalPrompt: string;
  status: JobStatus;
  queuePriority: number;
  retryCount: number;
  maxRetries: number;
  retryNotBefore?: TimestampLike | null;
  claimToken: string | null;
  claimedBy: string | null;
  claimExpiresAt: TimestampLike | null;
  timeoutAt: TimestampLike | null;
  lastAttemptStartedAt: TimestampLike | null;
  startedAt: TimestampLike | null;
  completedAt: TimestampLike | null;
  latestOutputCreatedAt?: TimestampLike | null;
  currentOutputId: string | null;
  currentOutput: JobOutput | null;
  userSelectedOutputId?: string | null;
  userSelectedOutput?: JobOutput | null;
  completedOutputCount: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
  providerUsage?: Partial<Record<Provider, ProviderUsageStats>>;
  generationAttemptCount?: number;
  autoReviewMaxAttempts?: number;
  latestAutoReview?: JobAutoReview | null;
  manualRegenerationCount: number;
  manuallyFlagged?: boolean;
  manuallyFlaggedAt?: TimestampLike | null;
  manuallyFlaggedByUid?: string | null;
  reviewSignals?: JobReviewSignals;
  traceability?: JobTraceabilitySummary;
  failureInfo?: JobFailureInfo | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
  lastError: string | null;
}

export type JobLogType =
  | 'claim'
  | 'provider_request'
  | 'provider_response'
  | 'quality_review'
  | 'retry_scheduled'
  | 'completed'
  | 'failed'
  | 'cleanup'
  | 'system';

export type JobLogLevel = 'info' | 'warn' | 'error';

export interface JobLog {
  id?: string;
  type: JobLogType;
  level: JobLogLevel;
  message: string;
  outputId?: string | null;
  payload: unknown;
  createdAt: TimestampLike;
}

export interface RegenerateJobRequest {
  jobId: string;
  provider: Provider;
  prompt: string;
}

export interface RegenerateJobResponse {
  success: boolean;
  jobId: string;
}

export interface RetryJobAutoReviewRequest {
  jobId: string;
}

export interface RetryJobAutoReviewResponse {
  success: boolean;
  jobId: string;
  verdict: JobAutoReviewVerdict;
}

export interface CancelJobGenerationRequest {
  jobId: string;
}

export interface CancelJobGenerationResponse {
  success: boolean;
  jobId: string;
}

export interface SelectJobOutputRequest {
  jobId: string;
  outputId: string | null;
}

export interface SelectJobOutputResponse {
  success: boolean;
  jobId: string;
  outputId: string | null;
}
