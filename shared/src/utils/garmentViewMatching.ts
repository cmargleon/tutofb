import { GarmentBodyArea, GarmentView, Pose, PoseAiClassification, PoseBodyFocus, UploadedGarmentPhotoInput } from '../types';

const GARMENT_VIEW_ORDER: GarmentView[] = ['front', 'back', 'side'];

export const isPoseBodyFocusCompatibleWithGarmentBodyArea = (
  poseBodyFocus: PoseBodyFocus,
  garmentBodyArea: GarmentBodyArea,
): boolean => {
  switch (garmentBodyArea) {
    case 'upper_body':
      return poseBodyFocus === 'full_body' || poseBodyFocus === 'upper_body';
    case 'lower_body':
      return poseBodyFocus === 'full_body' || poseBodyFocus === 'lower_body';
    case 'footwear':
      return poseBodyFocus === 'full_body' || poseBodyFocus === 'lower_body' || poseBodyFocus === 'feet';
    case 'head_accessory':
      return poseBodyFocus === 'full_body' || poseBodyFocus === 'upper_body';
    case 'full_body':
      return poseBodyFocus === 'full_body';
    default:
      return true;
  }
};

export const isPoseFaceVisibilityCompatibleWithGarmentBodyArea = (
  faceVisible: boolean | null | undefined,
  garmentBodyArea: GarmentBodyArea,
): boolean => {
  switch (garmentBodyArea) {
    case 'head_accessory':
      return faceVisible === true;
    default:
      return true;
  }
};

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
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews' | 'bodyFocus' | 'faceVisible'> | null | undefined,
  availableViews: readonly GarmentView[],
  garmentBodyArea?: GarmentBodyArea | null,
): boolean => {
  if (!canMatchPoseToGarmentViews(aiClassification, availableViews)) {
    return false;
  }

  if (!garmentBodyArea) {
    return true;
  }

  if (!isPoseFaceVisibilityCompatibleWithGarmentBodyArea(aiClassification?.faceVisible, garmentBodyArea)) {
    return false;
  }

  if (!aiClassification?.bodyFocus) {
    return true;
  }

  return isPoseBodyFocusCompatibleWithGarmentBodyArea(aiClassification.bodyFocus, garmentBodyArea);
};

export const isPoseCompatibleWithGarmentViews = (
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews' | 'bodyFocus' | 'faceVisible'> | null | undefined,
  availableViews: readonly GarmentView[],
  garmentBodyArea?: GarmentBodyArea | null,
): boolean => {
  if (!hasExplicitPoseGarmentViewMapping(aiClassification)) {
    return true;
  }

  return isPoseSuggestedForGarmentViews(aiClassification, availableViews, garmentBodyArea);
};

export const getSuggestedPoseIdsForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends { availableViews: readonly GarmentView[]; garmentBodyArea?: GarmentBodyArea | null },
>(
  poses: readonly TPose[],
  garments: readonly TGarment[],
): string[] => {
  if (garments.length === 0) {
    return [];
  }

  return poses
    .filter((pose) =>
      garments.some((garment) =>
        isPoseSuggestedForGarmentViews(pose.aiClassification, garment.availableViews, garment.garmentBodyArea),
      ),
    )
    .map((pose) => pose.id);
};

export const countCompatibleGarmentsForPose = <
  TGarment extends { availableViews: readonly GarmentView[]; garmentBodyArea?: GarmentBodyArea | null },
>(
  aiClassification: Pick<PoseAiClassification, 'usableForGarmentViews' | 'bodyFocus' | 'faceVisible'> | null | undefined,
  garments: readonly TGarment[],
): number =>
  garments.filter((garment) =>
    isPoseCompatibleWithGarmentViews(aiClassification, garment.availableViews, garment.garmentBodyArea),
  ).length;

export const countCompatiblePoseMatchesForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends { availableViews: readonly GarmentView[]; garmentBodyArea?: GarmentBodyArea | null },
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

      return isPoseCompatibleWithGarmentViews(pose.aiClassification, garment.availableViews, garment.garmentBodyArea);
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
  isPoseBodyFocusCompatibleWithGarmentBodyArea,
  isPoseSuggestedForGarmentViews,
  isPoseCompatibleWithGarmentViews,
  getSuggestedPoseIdsForGarments,
  countCompatibleGarmentsForPose,
  countCompatiblePoseMatchesForGarments,
  selectBestGarmentPhotoForPose,
};
