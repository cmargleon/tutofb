export type TimestampLike = any;

export type Role = 'admin' | 'operador' | 'revisor';
export type Provider = 'fal-seedream' | 'fal-banana-pro' | 'openai-gpt-image-1.5';
export type ExperimentMode = 'ab_paired' | 'ab_interleaved';
export type AspectRatio = '9:16' | '3:4' | '2:3' | '1:1' | '4:3' | '3:2' | '16:9';
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type GarmentSourceType = 'single' | 'folder-root' | 'subfolder';
export type CatalogEntityStatus = 'active' | 'archived';

export type BackgroundMode =
  | 'white'
  | 'bokeh'
  | 'studio'
  | 'exterior_natural'
  | 'exterior_urbano'
  | 'interior_lifestyle'
  | 'custom';

export type BackgroundScene =
  | 'none'
  | 'arquitectura_moderna'
  | 'calle_limpia'
  | 'terraza'
  | 'fachada_neutra'
  | 'bosque'
  | 'mar'
  | 'sendero'
  | 'jardin'
  | 'campo'
  | 'living_minimalista'
  | 'estudio_creativo'
  | 'cafe_elegante'
  | 'vestidor'
  | 'gimnasio_premium'
  | 'papel_seamless'
  | 'cemento_suave';

export type BackgroundLighting =
  | 'clear_soft_daylight'
  | 'warm_soft_daylight'
  | 'cool_soft_daylight'
  | 'studio_diffused'
  | 'high_key'
  | 'editorial'
  | 'dramatic'
  | 'overcast_soft'
  | 'golden_hour';

export type BackgroundDominantColor =
  | 'white'
  | 'neutral gray'
  | 'warm beige'
  | 'soft blue'
  | 'forest green'
  | 'ocean blue'
  | 'sand'
  | 'black';

export type BackgroundProminence = 'minimal' | 'medium' | 'editorial';
export type BackgroundContrast = 'soft' | 'medium' | 'high';
export type BackgroundRealism = 'catalogo_realista' | 'campana_lifestyle';
export type BackgroundSeparation = 'standard' | 'strong' | 'maximum';

export interface BackgroundConfig {
  mode: BackgroundMode;
  scene: BackgroundScene;
  lighting: BackgroundLighting;
  bokehStrength: number;
  dominantColor: BackgroundDominantColor;
  prominence: BackgroundProminence;
  contrast: BackgroundContrast;
  realism: BackgroundRealism;
  separation: BackgroundSeparation;
  avoidExtraPeople: boolean;
  avoidDistractingProps: boolean;
  avoidTextSignage: boolean;
  customDetail: string;
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

export interface ExperimentArm {
  id: string;
  provider: Provider;
  label: string;
}

export interface GenerationExperimentConfig {
  enabled: boolean;
  mode: ExperimentMode;
  providers: Provider[];
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
  experimentEnabled?: boolean;
  experimentId?: string | null;
  experimentMode?: ExperimentMode | null;
  experimentArms?: ExperimentArm[] | null;
  aspectRatio: AspectRatio;
  promptBase: string;
  backgroundConfig: BackgroundConfig;
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

export interface JobAutoReview {
  model: string;
  verdict: JobAutoReviewVerdict;
  summary: string;
  revisedPrompt: string | null;
  criteria: JobAutoReviewCriterion[];
  attemptNumber: number;
  reviewedAt: TimestampLike;
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
  experimentEnabled?: boolean;
  experimentId?: string | null;
  experimentMode?: ExperimentMode | null;
  experimentArmId?: string | null;
  experimentArmLabel?: string | null;
  experimentComparisonKey?: string | null;
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
  experimentEnabled?: boolean;
  experimentId?: string | null;
  experimentMode?: ExperimentMode | null;
  experimentArmId?: string | null;
  experimentArmLabel?: string | null;
  experimentComparisonKey?: string | null;
  poseImageId: string;
  poseImagePath: string;
  poseFileName?: string;
  garmentId: string;
  garmentName: string;
  garmentFilePath: string;
  garmentSourceType?: GarmentSourceType;
  garmentOriginalFileNames?: string[];
  garmentIsMultiAngle: boolean;
  aspectRatio: AspectRatio;
  provider: Provider;
  requestedPromptBase?: string;
  promptBase: string;
  finalPrompt: string;
  backgroundConfig: BackgroundConfig;
  status: JobStatus;
  queuePriority: number;
  retryCount: number;
  maxRetries: number;
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
  completedOutputCount: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
  providerUsage?: Partial<Record<Provider, ProviderUsageStats>>;
  generationAttemptCount?: number;
  autoReviewMaxAttempts?: number;
  latestAutoReview?: JobAutoReview | null;
  manualRegenerationCount: number;
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

export interface ExperimentArmAnalytics {
  armId: string;
  label: string;
  provider: Provider;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  processingJobs: number;
  manualRegenerationCount: number;
  regeneratedJobs: number;
  regenerationRatePct: number;
  totalCostUsd: number;
  avgCostPerJobUsd: number;
  avgCostPerCompletedJobUsd: number;
  totalDurationSeconds: number;
  avgDurationPerJobSeconds: number;
  efficiencyScore: number;
}

export interface BatchExperimentAnalytics {
  batchId: string;
  experimentId: string;
  mode: ExperimentMode;
  totalJobs: number;
  comparableGroups: number;
  arms: ExperimentArmAnalytics[];
  winningArmId: string | null;
  winningProvider: Provider | null;
  recommendation: string;
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

export interface UploadedGarmentInput {
  id: string;
  name: string;
  storagePath: string;
  isMultiAngle: boolean;
  sourceType?: GarmentSourceType;
  originalFileNames?: string[];
}

export interface CreateGenerationBatchRequest {
  clientId: string;
  modelId: string;
  poseIds: string[];
  garments: UploadedGarmentInput[];
  provider: Provider;
  experiment?: GenerationExperimentConfig | null;
  promptBase: string;
  aspectRatio: AspectRatio;
  backgroundConfig: BackgroundConfig;
}

export interface CreateGenerationBatchResponse {
  batchId: string;
  createdJobs: number;
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
  | 'fal-flux-pro'
  | 'fal-flux-schnell'
  | 'fal-seedream-v4'
  | 'fal-seedream-v4.5'
  | 'fal-banana'
  | 'fal-banana-pro'
  | 'fal-banana-2'
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
