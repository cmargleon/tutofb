import type { ProductSceneInput } from './productGeneration';
import type { TimestampLike, Provider, AspectRatio, BatchStatus, BatchOutputMode } from './common';
import type { ProviderImageConfig } from './provider';
import type { ModelIdentityTraits } from './model';
import type { UploadedGarmentInput } from './garment';
import type { ProductDraftInput, ProductDraftRow } from './spreadsheet';

export type BatchNotificationRetryState = 'queued' | 'failed_after_retry' | 'succeeded_after_retry';

export interface BatchNotificationState {
  retryState?: BatchNotificationRetryState | null;
  retryRequestedAt?: TimestampLike | null;
  retryRequestedByUid?: string | null;
  retryRequestedByDisplayName?: string | null;
  retryProvider?: Provider | null;
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
  identityTraits?: ModelIdentityTraits | null;
}

export interface Batch {
  automationJobId?: string;
  generationKind?: 'garment' | 'product';
  productScenes?: ProductSceneInput[];
  id?: string;
  clientId: string;
  clientNameSnapshot: string;
  clientSnapshot?: BatchClientSnapshot;
  modelId: string;
  modelNameSnapshot: string;
  modelSnapshot?: BatchModelSnapshot;
  outputMode?: BatchOutputMode | null;
  spreadsheetTemplateId?: string | null;
  spreadsheetTemplateNameSnapshot?: string | null;
  spreadsheetCategoryId?: string | null;
  spreadsheetCategoryNameSnapshot?: string | null;
  googleSheetId?: string | null;
  googleSheetUrl?: string | null;
  googleSheetCreatedAt?: TimestampLike | null;
  googleSheetUpdatedAt?: TimestampLike | null;
  googleSheetWorkbookHash?: string | null;
  provider: Provider;
  aspectRatio: AspectRatio;
  imageConfig?: ProviderImageConfig | null;
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
  notification?: BatchNotificationState | null;
}

export interface CreateGenerationBatchRequest {
  clientId: string;
  modelId: string;
  outputMode?: BatchOutputMode;
  spreadsheetTemplateId?: string | null;
  spreadsheetCategoryId?: string | null;
  poseIds: string[];
  garments: UploadedGarmentInput[];
  productDrafts: ProductDraftInput[];
  provider: Provider;
  promptBase: string;
  aspectRatio?: AspectRatio;
  imageConfig?: ProviderImageConfig;
}

export interface CreateGenerationBatchResponse {
  batchId: string;
  createdJobs: number;
}

export interface RegenerateFailedBatchJobsRequest {
  batchId: string;
  source?: 'catalog' | 'notification';
  provider?: Provider | null;
}

export interface RegenerateFailedBatchJobsResponse {
  success: boolean;
  batchId: string;
  queuedJobs: number;
  skippedJobs: number;
  skippedJobIds: string[];
  retryProvider?: Provider | null;
}

export interface CancelPendingBatchJobsRequest {
  batchId: string;
}

export interface CancelPendingBatchJobsResponse {
  success: boolean;
  batchId: string;
  cancelledJobs: number;
}

export interface CancelBatchProcessingRequest {
  batchId: string;
}

export interface CancelBatchProcessingResponse {
  success: boolean;
  batchId: string;
  cancelledJobs: number;
  cancelledPendingJobs: number;
  cancelledProcessingJobs: number;
}

export interface ExportBatchSpreadsheetRequest {
  batchId: string;
}

export interface ExportBatchSpreadsheetResponse {
  success: boolean;
  batchId: string;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
}

export interface EditBatchSpreadsheetRequest {
  batchId: string;
  refreshMode?: 'replace_existing' | 'create_new_version';
}

export interface EditBatchSpreadsheetResponse {
  success: boolean;
  batchId: string;
  sheetId: string;
  sheetUrl: string;
  created: boolean;
  updated: boolean;
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

export interface UpdateBatchProductDraftRequest {
  batchId: string;
  draftId: string;
  rows: ProductDraftRow[];
}

export interface UpdateBatchProductDraftResponse {
  success: boolean;
  batchId: string;
  draftId: string;
}
