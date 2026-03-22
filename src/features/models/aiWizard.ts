import { GeneratedPhotoState, PoseRecipe } from './types';

interface GeneratedPhotoLike {
  storagePath: string;
  contentType: string;
}

export const toCandidatePhotoState = (photo: GeneratedPhotoLike): GeneratedPhotoState => ({
  storagePath: photo.storagePath,
  contentType: photo.contentType,
  rejected: false,
  source: 'candidate',
});

export const buildPendingPosePhotos = (poseRecipes: PoseRecipe[]): GeneratedPhotoState[] =>
  poseRecipes.map((pose) => ({
    storagePath: '',
    contentType: '',
    rejected: false,
    label: pose.label,
    source: 'pose',
    loading: true,
    error: false,
  }));

export const buildReferencePosePhotoState = (
  candidate: GeneratedPhotoLike,
  pose: PoseRecipe,
): GeneratedPhotoState => ({
  storagePath: candidate.storagePath,
  contentType: candidate.contentType,
  rejected: false,
  label: pose.label,
  source: 'pose',
  loading: false,
  error: false,
});

export const buildGeneratedPosePhotoState = (
  photo: GeneratedPhotoLike | null | undefined,
  pose: PoseRecipe,
): GeneratedPhotoState => ({
  storagePath: photo?.storagePath ?? '',
  contentType: photo?.contentType ?? '',
  rejected: !photo,
  label: pose.label,
  source: 'pose',
  loading: false,
  error: !photo,
});

export const getAcceptedPoseCount = (posePhotos: GeneratedPhotoState[]): number =>
  posePhotos.filter((photo) => !photo.rejected && !photo.loading).length;

export const isAiWizardStepComplete = ({
  stepId,
  candidates,
  selectedCandidate,
}: {
  stepId: number;
  candidates: GeneratedPhotoState[];
  selectedCandidate: GeneratedPhotoState | null;
}): boolean => {
  switch (stepId) {
    case 1:
      return candidates.length > 0;
    case 2:
      return selectedCandidate !== null;
    case 3:
      return true;
    default:
      return false;
  }
};
