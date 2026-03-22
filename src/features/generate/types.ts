import {
  AspectRatio,
  BackgroundConfig,
  ExperimentMode,
  GarmentSourceType,
  Provider,
} from '../../../shared/src/types';

export type SourceType = GarmentSourceType;

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

export interface UploadedGarmentDraft {
  id: string;
  name: string;
  sourceType: SourceType;
  files: File[];
  uploadFile: File;
  previewUrl: string;
  isMultiAngle: boolean;
  originalFileNames: string[];
  upload: GarmentUploadState;
}

export interface WizardExperimentState {
  enabled: boolean;
  mode: ExperimentMode;
  providers: Provider[];
}

export interface WizardState {
  step: number;
  selectedClientId: string | null;
  selectedModelId: string | null;
  selectedPoseIds: string[];
  garments: UploadedGarmentDraft[];
  provider: Provider;
  experiment: WizardExperimentState;
  prompt: string;
  aspectRatio: AspectRatio;
  backgroundConfig: BackgroundConfig;
}
