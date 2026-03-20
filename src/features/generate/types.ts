import { AspectRatio, BackgroundConfig, GarmentSourceType, Provider } from '../../../shared/src/types';

export type SourceType = GarmentSourceType;

export interface UploadedGarmentDraft {
  id: string;
  name: string;
  sourceType: SourceType;
  files: File[];
  uploadFile: File;
  previewUrl: string;
  isMultiAngle: boolean;
  originalFileNames: string[];
}

export interface WizardState {
  step: number;
  selectedClientId: string | null;
  selectedModelId: string | null;
  selectedPoseIds: string[];
  garments: UploadedGarmentDraft[];
  provider: Provider;
  prompt: string;
  aspectRatio: AspectRatio;
  backgroundConfig: BackgroundConfig;
}
