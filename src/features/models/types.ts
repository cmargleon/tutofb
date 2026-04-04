export type CreateTab = 'upload' | 'generate' | 'reference';
export type GeneratedPhotoSource = 'candidate' | 'pose' | 'reference';
export type ReferenceIdentityMode = 'exact' | 'similar';
export type ReferenceBackgroundMode = 'preserve' | 'custom';
export type ReferenceClothingMode = 'preserve' | 'custom';
export type PosePromptCategory = 'full_body' | 'half_body' | 'lower_body' | 'portrait';
export type PosePromptOrientation =
  | 'front'
  | 'front_three_quarter'
  | 'profile_left'
  | 'back'
  | 'back_three_quarter';
export type PosePromptModifier = 'walking' | 'contrapposto';

export type PosePromptProfile = {
  category: PosePromptCategory;
  orientation: PosePromptOrientation;
  modifiers?: PosePromptModifier[];
};

export type PoseRecipe = {
  id: string;
  label: string;
  group: string;
  shotType: string;
  promptProfile: PosePromptProfile;
  promptDirectives?: string[];
  usesReferenceImage?: boolean;
};

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
