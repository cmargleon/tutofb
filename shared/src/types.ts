export type TimestampLike = any;

export type Role = 'admin' | 'operador' | 'revisor';
export type Provider = 'fal-seedream' | 'fal-banana-pro' | 'openai-gpt-image-1.5';
export type AspectRatio = '9:16' | '3:4' | '2:3' | '1:1' | '4:3' | '3:2' | '16:9';
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type GarmentSourceType = 'single' | 'folder-root' | 'subfolder';

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
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  lastLoginAt?: TimestampLike | null;
}

export interface Client {
  id?: string;
  name: string;
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
  poses: Pose[];
  poseCount: number;
  coverPoseId?: string | null;
  coverPosePath?: string | null;
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
}

export interface ProviderUsageStats {
  completedOutputs: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
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
  garmentSourceType?: GarmentSourceType;
  garmentOriginalFileNames?: string[];
  garmentIsMultiAngle: boolean;
  aspectRatio: AspectRatio;
  provider: Provider;
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
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
  createdByUid: string;
  lastError: string | null;
}

export type JobLogType =
  | 'claim'
  | 'provider_request'
  | 'provider_response'
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
  totalCostUsd: number;
  updatedAt: TimestampLike;
}

export interface AnalyticsData {
  summary: AnalyticsSummary | null;
  dailyVolume: AnalyticsDailyVolume[];
  dailyCost?: AnalyticsDailyCost[];
  byProvider: AnalyticsProviderStats[];
  topClients: AnalyticsClientStats[];
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
  promptBase: string;
  aspectRatio: AspectRatio;
  backgroundConfig: BackgroundConfig;
}

export interface CreateGenerationBatchResponse {
  batchId: string;
  createdJobs: number;
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
