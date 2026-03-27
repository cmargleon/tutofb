export type TimestampLike = any;

export type Role = 'admin' | 'operador' | 'revisor';
export type Provider = 'fal-seedream' | 'fal-banana-pro' | 'openai-gpt-image-1.5';
export type AspectRatio = '9:16' | '3:4' | '2:3' | '1:1' | '4:3' | '3:2' | '16:9';
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type GarmentSourceType = 'single' | 'folder-root' | 'subfolder';
export type CatalogEntityStatus = 'active' | 'archived';
export type GarmentView = 'front' | 'back' | 'side';
export type GarmentPhotoClassificationSource = 'assumed_single_front' | 'gemini';
export type GarmentReferenceImageType = 'single_view' | 'multi_angle_composite';
export type PoseOrientationGroup = 'front' | 'back' | 'side' | 'ambiguous';
export type PoseOrientationDetail =
  | 'front'
  | 'front_three_quarter'
  | 'back'
  | 'back_three_quarter'
  | 'left_profile'
  | 'right_profile'
  | 'ambiguous';
export type PoseFraming = 'full_body' | 'three_quarter_body' | 'medium_body' | 'unknown';

export interface PoseAiClassification {
  orientationGroup: PoseOrientationGroup;
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  autoCategory: string;
  usableForGarmentViews: GarmentView[];
  confidence: number | null;
  taggedBy: 'gemini';
  taggedAt: TimestampLike;
  version: number;
  reasoning?: string | null;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  status?: CatalogEntityStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  lastLoginAt?: TimestampLike | null;
}

export interface Client {
  id?: string;
  name: string;
  status?: CatalogEntityStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  batchCount: number;
  lastBatchCreatedAt: TimestampLike | null;
  createdByUid: string;
}

export interface Pose {
  id: string;
  storagePath: string;
  fileName: string;
  previewStoragePath?: string | null;
  width?: number | null;
  height?: number | null;
  aiClassification?: PoseAiClassification | null;
  createdAt: TimestampLike;
}

export interface Model {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  name: string;
  status?: CatalogEntityStatus;
  archivedAt?: TimestampLike | null;
  archivedByUid?: string | null;
  storageRootPath?: string;
  poses: Pose[];
  poseCount: number;
  coverPoseId?: string | null;
  coverPosePath?: string | null;
  generatedPhotoCount?: number;
  generatedPhotoCostUsd?: number;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
}

export interface BatchClientSnapshot {
  id: string;
  name: string;
}

export interface BatchModelSnapshot {
  id: string;
  clientId: string;
  name: string;
  poseCount: number;
  coverPoseId: string | null;
  coverPosePath: string | null;
}

export interface Batch {
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  clientSnapshot?: BatchClientSnapshot;
  modelId: string;
  modelNameSnapshot: string;
  modelSnapshot?: BatchModelSnapshot;
  provider: Provider;
  aspectRatio: AspectRatio;
  promptBase: string;
  poseIds: string[];
  garmentCount: number;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  completedOutputCount?: number;
  status: BatchStatus;
  latestJobCreatedAt: TimestampLike | null;
  lastJobCompletedAt?: TimestampLike | null;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
  createdByDisplayName?: string | null;
}

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
  resultImagePath: string;
  contentType: string;
  remoteUrl: string | null;
  requestId: string | null;
  costUsd: number;
  durationSeconds: number | null;
  providerResponseSummary?: Record<string, unknown> | null;
  generationAttempt?: number | null;
  autoReview?: JobAutoReview | null;
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
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  garmentPhotoId?: string | null;
  garmentPhotoFileName?: string | null;
  garmentView?: GarmentView | null;
  garmentSourceType?: GarmentSourceType;
  garmentOriginalFileNames?: string[];
  garmentIsMultiAngle: boolean;
  garmentReferenceImageType?: GarmentReferenceImageType;
  aspectRatio: AspectRatio;
  provider: Provider;
  requestedPromptBase?: string;
  promptBase: string;
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

export interface ArchiveClientSummary {
  id: string;
  name: string;
  batchCount: number;
  lastBatchCreatedAt: TimestampLike | null;
}

export interface ArchiveBatchSummary {
  batchId: string;
  clientId: string;
  clientNameSnapshot: string;
  modelId: string;
  modelNameSnapshot: string;
  totalJobs: number;
  completedImages: number;
  latestCreatedAt: TimestampLike | null;
  latestJobId: string;
}

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

export type GeminiUsageFeature = 'image_review' | 'garment_view_classification' | 'pose_classification';
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

export type HealthStatus = 'healthy' | 'degraded' | 'down';

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

export interface GarmentPhotoAssetInput {
  id: string;
  fileName: string;
  storagePath: string;
  sourceIndex: number;
}

export interface UploadedGarmentPhotoInput extends GarmentPhotoAssetInput {
  view: GarmentView;
  confidence?: number | null;
  reasoning?: string | null;
  classifiedBy: GarmentPhotoClassificationSource;
}

export interface UploadedGarmentInput {
  id: string;
  name: string;
  storagePath: string;
  isMultiAngle: boolean;
  sourceType?: GarmentSourceType;
  originalFileNames?: string[];
  originalPhotoCount?: number;
  photos?: UploadedGarmentPhotoInput[];
}

export interface CreateGenerationBatchRequest {
  clientId: string;
  modelId: string;
  poseIds: string[];
  garments: UploadedGarmentInput[];
  provider: Provider;
  promptBase: string;
  aspectRatio: AspectRatio;
}

export interface CreateGenerationBatchResponse {
  batchId: string;
  createdJobs: number;
}

export interface ClassifyGarmentViewsGarmentInput {
  garmentId: string;
  garmentName: string;
  photos: GarmentPhotoAssetInput[];
}

export interface ClassifyGarmentViewsRequest {
  garments: ClassifyGarmentViewsGarmentInput[];
}

export interface ClassifiedGarmentPhoto extends UploadedGarmentPhotoInput {}

export interface ClassifiedGarmentViewsGarmentResult {
  garmentId: string;
  garmentName: string;
  photos: ClassifiedGarmentPhoto[];
  availableViews: GarmentView[];
  usedGemini: boolean;
}

export interface ClassifyGarmentViewsResponse {
  success: boolean;
  garments: ClassifiedGarmentViewsGarmentResult[];
}

export interface PermanentDeleteCatalogEntityRequest {
  id: string;
}

export interface PermanentDeleteCatalogEntityResponse {
  success: boolean;
  id: string;
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

export interface PermanentDeleteAppUserRequest {
  uid: string;
}

export interface PermanentDeleteAppUserResponse {
  success: boolean;
  uid: string;
}

export interface ArchiveAppUserRequest {
  uid: string;
}

export interface ArchiveAppUserResponse {
  success: boolean;
  uid: string;
}

export interface RestoreAppUserRequest {
  uid: string;
}

export interface RestoreAppUserResponse {
  success: boolean;
  uid: string;
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

export interface RegenerateFailedBatchJobsRequest {
  batchId: string;
}

export interface RegenerateFailedBatchJobsResponse {
  success: boolean;
  batchId: string;
  queuedJobs: number;
  skippedJobs: number;
  skippedJobIds: string[];
}

export interface CancelPendingBatchJobsRequest {
  batchId: string;
}

export interface CancelPendingBatchJobsResponse {
  success: boolean;
  batchId: string;
  cancelledJobs: number;
}

export interface ArchiveSearchRequest {
  clientId?: string | null;
  provider?: Provider | null;
  batchStatus?: BatchStatus | null;
  jobStatus?: JobStatus | null;
  modelQuery?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number | null;
  batchPageSize?: number | null;
  cursor?: ArchiveSearchCursor | null;
}

export interface ArchiveSearchCursor {
  batchId: string;
}

export interface ArchiveSearchBatchMatch {
  batch: Batch;
  matchedJobCount: number;
  matchedJobIds: string[];
  matchedGarments: string[];
  latestMatchedAt: TimestampLike | null;
}

export interface ArchiveSearchResponse {
  success: boolean;
  results: ArchiveSearchBatchMatch[];
  scannedBatches: number;
  hasMore: boolean;
  nextCursor: ArchiveSearchCursor | null;
}

export interface RegenerateJobsBulkItem {
  jobId: string;
  provider?: Provider | null;
  prompt?: string | null;
}

export interface RegenerateJobsBulkRequest {
  jobs: RegenerateJobsBulkItem[];
}

export interface RegenerateJobsBulkResponse {
  success: boolean;
  queuedJobs: number;
  skippedJobs: number;
  skippedJobIds: string[];
}

export type ModelPhotoProvider =
  | 'fal-seedream-v4.5'
  | 'fal-banana-pro'
  | 'openai-dalle';

export type ModelPhotoGenerationStage = 'identity' | 'pose';

export interface GenerateModelPhotoRequest {
  prompt: string;
  provider: ModelPhotoProvider;
  aspectRatio: AspectRatio;
  count: number;
  tempSessionId: string;
  clientId: string;
  modelId?: string | null;
  stage?: ModelPhotoGenerationStage | null;
  referenceStoragePath?: string | null;
}

export interface GeneratedModelPhoto {
  index: number;
  storagePath: string;
  contentType: string;
}

export interface GeneratedModelPhotoError {
  index: number;
  message: string;
}

export interface GenerateModelPhotoResponse {
  success: boolean;
  photos: GeneratedModelPhoto[];
  errors: GeneratedModelPhotoError[];
  estimatedCostUsd: number;
}

export interface ModelPoseTaggingRequest {
  modelId?: string;
  targetModelName?: string;
  dryRun?: boolean;
  deleteOtherModels?: boolean;
}

export interface TaggedModelPoseSummary {
  poseId: string;
  fileName: string;
  storagePath: string;
  orientationGroup: PoseOrientationGroup;
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  autoCategory: string;
  usableForGarmentViews: GarmentView[];
  confidence: number | null;
}

export interface ModelPoseTaggingModelSummary {
  id: string;
  name: string;
  status: CatalogEntityStatus;
  poseCount: number;
  action: 'keep' | 'delete';
}

export interface ModelPoseTaggingResponse {
  success: boolean;
  targetModelName: string;
  targetModelId: string;
  dryRun: boolean;
  models: ModelPoseTaggingModelSummary[];
  taggedPoses: TaggedModelPoseSummary[];
  deletedModelIds: string[];
  warnings: string[];
}

export interface ModelGenerationLog {
  id?: string;
  provider: ModelPhotoProvider;
  requestedPhotos: number;
  completedPhotos: number;
  estimatedCostUsd: number;
  clientId: string;
  modelId?: string | null;
  stage?: ModelPhotoGenerationStage | null;
  createdByUid: string;
  createdByDisplayName?: string | null;
  createdAt: TimestampLike;
}
