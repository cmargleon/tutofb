export type CreateTab = 'upload' | 'generate' | 'reference';
export type GeneratedPhotoSource = 'candidate' | 'pose' | 'reference';
export type ReferenceIdentityMode = 'exact' | 'similar';
export type ReferenceBackgroundMode = 'preserve' | 'custom';
export type ReferenceClothingMode = 'preserve' | 'custom';

export type PoseRecipe = {
  id: string;
  label: string;
  group: string;
  shotType: string;
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
  source: GeneratedPhotoSource;
  loading?: boolean;
  error?: boolean;
}
