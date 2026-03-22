export type CreateTab = 'upload' | 'generate';
export type GeneratedPhotoSource = 'candidate' | 'pose';

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
