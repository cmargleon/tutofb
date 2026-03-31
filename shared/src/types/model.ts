import type { TimestampLike, CatalogEntityStatus, GarmentView, PoseOrientationGroup, PoseOrientationDetail, PoseFraming, AspectRatio } from './common';
import type { ProviderImageConfig } from './provider';

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

export interface ModelIdentityTraits {
  sex: string | null;
  age: string | null;
  skin: string | null;
  hairColor: string | null;
  hairLength: string | null;
  build: string | null;
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
  identityTraits?: ModelIdentityTraits | null;
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

export type ModelPhotoProvider =
  | 'fal-seedream-v4.5'
  | 'fal-banana-pro'
  | 'openai-dalle'
  | 'fal-nano-banana-2'
  | 'fal-seedream-5';

export type ModelPhotoGenerationStage = 'identity' | 'pose';

export interface GenerateModelPhotoRequest {
  prompt: string;
  provider: ModelPhotoProvider;
  aspectRatio: AspectRatio;
  imageConfig?: ProviderImageConfig | null;
  count: number;
  tempSessionId: string;
  clientId: string;
  modelId?: string | null;
  stage?: ModelPhotoGenerationStage | null;
  referenceStoragePath?: string | null;
  preserveReferenceDetails?: boolean;
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
