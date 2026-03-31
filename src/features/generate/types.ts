import {
  BatchOutputMode,
  FalBananaProImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
  GarmentPhotoClassificationSource,
  GarmentSourceType,
  GarmentView,
  OpenAIImageConfig,
  ProductDraftInput,
  ProviderImageConfig,
  Provider,
} from '../../../shared/src/types';

export type SourceType = GarmentSourceType;
export type GenerateWizardStepId = 1 | 2 | 3 | 4 | 5;
export type GenerateSubmitStage = 'idle' | 'uploading' | 'creating-batch';
export type PoseSuggestionStatus = 'idle' | 'preparing' | 'ready' | 'failed';
export type ProductDraftPreparationStatus = 'idle' | 'preparing' | 'ready' | 'failed';

export type GarmentUploadStatus = 'idle' | 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';

export interface GarmentUploadState {
  status: GarmentUploadStatus;
  progress: number;
  attempts: number;
  error: string | null;
  storagePath: string | null;
  draftBatchId: string | null;
}

export const createInitialGarmentUploadState = (): GarmentUploadState => ({
  status: 'idle',
  progress: 0,
  attempts: 0,
  error: null,
  storagePath: null,
  draftBatchId: null,
});

export type GarmentPhotoClassificationStatus = 'idle' | 'classifying' | 'classified' | 'failed';

export interface GarmentPhotoClassificationState {
  status: GarmentPhotoClassificationStatus;
  view: GarmentView | null;
  confidence: number | null;
  reasoning: string | null;
  classifiedBy: GarmentPhotoClassificationSource | null;
  error: string | null;
}

export const createInitialGarmentPhotoClassificationState = (
  initial: Partial<GarmentPhotoClassificationState> = {},
): GarmentPhotoClassificationState => ({
  status: initial.status ?? 'idle',
  view: initial.view ?? null,
  confidence: initial.confidence ?? null,
  reasoning: initial.reasoning ?? null,
  classifiedBy: initial.classifiedBy ?? null,
  error: initial.error ?? null,
});

export interface GarmentOriginalPhotoDraft {
  id: string;
  file: File;
  fileName: string;
  sourceIndex: number;
  previewUrl: string;
  upload: GarmentUploadState;
  classification: GarmentPhotoClassificationState;
}

export interface UploadedGarmentDraft {
  id: string;
  name: string;
  sourceType: SourceType;
  files: File[];
  previewUrl: string;
  isMultiAngle: boolean;
  originalFileNames: string[];
  originalPhotos: GarmentOriginalPhotoDraft[];
  upload: GarmentUploadState;
}

export interface PoseSuggestionState {
  status: PoseSuggestionStatus;
  error: string | null;
  suggestedPoseIds: string[];
  signature: string | null;
  missingPoseClassificationCount: number;
}

export const createInitialPoseSuggestionState = (): PoseSuggestionState => ({
  status: 'idle',
  error: null,
  suggestedPoseIds: [],
  signature: null,
  missingPoseClassificationCount: 0,
});

export interface ProductDraftPreparationState {
  status: ProductDraftPreparationStatus;
  error: string | null;
  signature: string | null;
}

export const createInitialProductDraftPreparationState = (): ProductDraftPreparationState => ({
  status: 'idle',
  error: null,
  signature: null,
});

export interface UploadSummary {
  total: number;
  uploaded: number;
  failed: number;
  queued: number;
  inFlight: number;
  idle: number;
  started: number;
}

export interface WizardState {
  step: GenerateWizardStepId;
  selectedClientId: string | null;
  selectedModelId: string | null;
  outputMode: BatchOutputMode;
  selectedSpreadsheetTemplateId: string | null;
  selectedSpreadsheetCategoryId: string | null;
  selectedPoseIds: string[];
  garments: UploadedGarmentDraft[];
  poseSuggestions: PoseSuggestionState;
  productDrafts: ProductDraftInput[];
  productDraftPreparation: ProductDraftPreparationState;
  provider: Provider;
  providerImageConfigs: {
    'fal-seedream': FalSeedreamImageConfig;
    'fal-banana-pro': FalBananaProImageConfig;
    'openai-gpt-image-1.5': OpenAIImageConfig;
    'fal-nano-banana-2': FalNanoBanana2ImageConfig;
    'fal-seedream-5': FalSeedream5ImageConfig;
  };
  prompt: string;
}

export type WizardProviderImageConfig = ProviderImageConfig;
