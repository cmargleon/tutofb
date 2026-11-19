export type CreateTab = 'upload' | 'generate' | 'reference';
export type GeneratedPhotoSource = 'candidate' | 'pose' | 'reference';
export type ReferenceIdentityMode = 'exact' | 'similar';
export type ReferenceBackgroundMode = 'preserve' | 'custom';
export type ReferenceClothingMode = 'preserve' | 'custom';
export type { PosePromptCategory, PosePromptOrientation, PosePromptModifier, PosePromptProfile, PoseRecipe } from '../../../shared/src/modelPoseRecipes';

export type PoseGroupOption = {
  id: string;
  label: string;
  poseIds: string[];
};

export interface GeneratedPhotoState {
  storagePath: string;
  contentType: string;
  rejected: boolean;
  label?: string;
  poseRecipeId?: string;
  source: GeneratedPhotoSource;
  loading?: boolean;
  error?: boolean;
}
