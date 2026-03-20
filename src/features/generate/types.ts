import { Provider } from '../../../shared/src/types';

export type SourceType = 'single' | 'folder-root' | 'subfolder';

export interface UploadedGarmentDraft {
  id: string;
  name: string;
  sourceType: SourceType;
  files: File[];
  previewUrl: string;
  isMultiAngle: boolean;
}

export interface WizardState {
  step: number;
  // Step 1
  selectedClientId: string | null;
  selectedModelId: string | null;
  selectedPoseIds: string[];
  
  // Step 2
  garments: UploadedGarmentDraft[];
  
  // Step 3
  provider: Provider;
  prompt: string;
  aspectRatio: string;
}
