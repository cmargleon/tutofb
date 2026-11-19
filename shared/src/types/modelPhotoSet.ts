import type { AspectRatio, GarmentBodyArea, ModelPhotoProvider, ProviderImageConfig } from './index';
import type { MarketplaceId } from '../marketplaces';
import type { PhotoBaseObservation, PhotoRecipeCategory } from './photoPlan';

export type ModelSetShot = 'front' | 'front_three_quarter' | 'commercial_back';
export interface ApproveModelIdentityRequest { modelId: string; poseId: string; performer: 'real' | 'synthetic' }
export interface ModelBaseSpec {
  version: 'model-marketplace-set-v1';
  /** Concrete operator-selected pose; absent on historical/general requirements. */
  poseRecipeId?: string;
  channel: MarketplaceId;
  category: PhotoRecipeCategory;
  audience: 'adult' | 'child' | 'baby';
  bodyArea: GarmentBodyArea;
  shot: ModelSetShot;
  role: 'main' | 'alternative';
  background: 'white' | 'neutral';
  aspectRatio: AspectRatio;
  framing: PhotoBaseObservation['framing'];
  faceVisible: boolean;
  rulesRevision?: number;
  lookingAtCamera?: boolean;
  standingFront?: boolean;
  validation?: import('./modelMarketplaceRules').ModelMarketplaceRule['validation'];
}
export interface ApprovedModelIdentity {
  traitsSnapshot: import('./model').ModelIdentityTraits | null;
  poseId: string;
  storagePath: string;
  sha256: string;
  storageGeneration: string;
  performer: 'synthetic' | 'real';
  approvedAt: string;
  approvedByUid: string;
}
export interface ModelBaseApproval {
  clientId: string;
  modelId: string;
  recipeRevision: number;
  verifierModel?: string;
  confidence?: number | null;
  spec: ModelBaseSpec;
  poseId: string;
  storagePath: string;
  sha256: string;
  storageGeneration: string;
  identitySha256: string;
  observation: PhotoBaseObservation;
  verifiedAt: string;
  verifiedByUid: string;
  verifierVersion: 'model-base-verifier-v1';
  /** Imported evidence remains available, but is never production authorization. */
  requiresReverification?: boolean;
}
export interface ModelPhotoSetsRequest {
  modelId: string;
  poseRecipeIds?: string[];
  channels?: MarketplaceId[];
  category: PhotoRecipeCategory;
  bodyArea: GarmentBodyArea;
  aspectRatio?: AspectRatio;
  provider?: ModelPhotoProvider;
  imageConfig?: ProviderImageConfig;
}
export interface ModelPhotoSetsPreview {
  id: string;
  identitySha256?: string;
  provider: ModelPhotoProvider;
  shots: Array<{ spec: ModelBaseSpec; issues?: string[]; poseId: string | null; candidatePoseIds: string[]; estimatedCostUsd: number }>;
  incompatible?: Array<{ channel: MarketplaceId; poseRecipeId: string; reason: string }>;
  missing: number;
  estimatedCostUsd: number;
  issues: string[];
}
export interface GenerateModelBaseRequest extends ModelPhotoSetsRequest {
  poseRecipeId?: string;
  shot: ModelSetShot;
  channel: MarketplaceId;
  requestId: string;
  approvedPreviewId: string;
}
export interface VerifyModelBaseRequest extends ModelPhotoSetsRequest {
  poseRecipeId?: string;
  shot: ModelSetShot;
  channel: MarketplaceId;
  poseId: string;
}
export interface VerifyModelBaseResponse {
  approved: boolean;
  poseId: string;
  issues: string[];
}
