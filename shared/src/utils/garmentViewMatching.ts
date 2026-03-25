import { GarmentView, Pose, PoseAiClassification, UploadedGarmentPhotoInput } from '../types';

const GARMENT_VIEW_ORDER: GarmentView[] = ['front', 'back', 'side'];

export const getSortedUniqueGarmentViews = (views: readonly GarmentView[]): GarmentView[] =>
  GARMENT_VIEW_ORDER.filter((view) => views.includes(view));

export const getPoseUsableGarmentViews = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
): GarmentView[] =>
  getSortedUniqueGarmentViews(aiClassification?.usableForGarmentViews || []);

export const hasExplicitPoseGarmentViewMapping = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
): boolean => getPoseUsableGarmentViews(aiClassification).length > 0;

export const canMatchPoseToGarmentViews = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
  availableViews: readonly GarmentView[],
): boolean => {
  const usableViews = getPoseUsableGarmentViews(aiClassification);
  if (usableViews.length === 0) {
    return false;
  }

  const availableViewSet = new Set(availableViews);
  return usableViews.some((view) => availableViewSet.has(view));
};

export const isPoseSuggestedForGarmentViews = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
  availableViews: readonly GarmentView[],
): boolean => canMatchPoseToGarmentViews(aiClassification, availableViews);

export const isPoseCompatibleWithGarmentViews = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
  availableViews: readonly GarmentView[],
): boolean => {
  if (!hasExplicitPoseGarmentViewMapping(aiClassification)) {
    return true;
  }

  return canMatchPoseToGarmentViews(aiClassification, availableViews);
};

export const getSuggestedPoseIdsForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends { availableViews: readonly GarmentView[] },
>(
  poses: readonly TPose[],
  garments: readonly TGarment[],
): string[] => {
  if (garments.length === 0) {
    return [];
  }

  return poses
    .filter((pose) =>
      garments.some((garment) => isPoseSuggestedForGarmentViews(pose.aiClassification, garment.availableViews)),
    )
    .map((pose) => pose.id);
};

export const countCompatibleGarmentsForPose = <
  TGarment extends { availableViews: readonly GarmentView[] },
>(
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
  garments: readonly TGarment[],
): number =>
  garments.filter((garment) => isPoseCompatibleWithGarmentViews(aiClassification, garment.availableViews)).length;

export const countCompatiblePoseMatchesForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends { availableViews: readonly GarmentView[] },
>(
  poses: readonly TPose[],
  garments: readonly TGarment[],
  selectedPoseIds?: readonly string[],
): number => {
  const selectedPoseIdSet = selectedPoseIds ? new Set(selectedPoseIds) : null;

  return garments.reduce((total, garment) => {
    const compatiblePoseCount = poses.filter((pose) => {
      if (selectedPoseIdSet && !selectedPoseIdSet.has(pose.id)) {
        return false;
      }

      return isPoseCompatibleWithGarmentViews(pose.aiClassification, garment.availableViews);
    }).length;

    return total + compatiblePoseCount;
  }, 0);
};

export const selectBestGarmentPhotoForPose = <
  TPhoto extends Pick<UploadedGarmentPhotoInput, 'view'> & Partial<Pick<UploadedGarmentPhotoInput, 'sourceIndex'>>,
>(
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews'> | null | undefined,
  photos: readonly TPhoto[],
): TPhoto | null => {
  if (photos.length === 0) {
    return null;
  }

  const sortedPhotos = [...photos].sort(
    (left, right) => (left.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (right.sourceIndex ?? Number.MAX_SAFE_INTEGER),
  );
  const usableViews = getPoseUsableGarmentViews(aiClassification);

  for (const view of usableViews) {
    const matchingPhoto = sortedPhotos.find((photo) => photo.view === view);
    if (matchingPhoto) {
      return matchingPhoto;
    }
  }

  const frontFallback = sortedPhotos.find((photo) => photo.view === 'front');
  return frontFallback || sortedPhotos[0] || null;
};

export default {
  getSortedUniqueGarmentViews,
  getPoseUsableGarmentViews,
  hasExplicitPoseGarmentViewMapping,
  canMatchPoseToGarmentViews,
  isPoseSuggestedForGarmentViews,
  isPoseCompatibleWithGarmentViews,
  getSuggestedPoseIdsForGarments,
  countCompatibleGarmentsForPose,
  countCompatiblePoseMatchesForGarments,
  selectBestGarmentPhotoForPose,
};
