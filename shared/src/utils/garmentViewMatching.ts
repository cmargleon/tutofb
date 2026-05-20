import {
  AccessoryDisplaySlot,
  GarmentAccessoryType,
  GarmentBodyArea,
  GarmentView,
  Pose,
  PoseAiClassification,
  PoseBodyFocus,
  PoseOrientationGroup,
  UploadedGarmentPhotoInput,
} from '../types';
import {
  canPoseShowCarryAccessory,
  deriveAccessoryDisplaySlots,
  normalizeAccessoryDisplaySlots,
} from './accessoryMatching';

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
      return poseBodyFocus === 'lower_body' || poseBodyFocus === 'feet';
    case 'head_accessory':
      return poseBodyFocus === 'upper_body';
    case 'carry_accessory':
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

const getPoseAccessoryDisplaySlots = (
  aiClassification: (
    Pick<PoseAiClassification, 'accessoryDisplaySlots' | 'orientationGroup' | 'bodyFocus' | 'faceVisible'>
  ) | null | undefined,
): AccessoryDisplaySlot[] => {
  const explicitSlots = normalizeAccessoryDisplaySlots(aiClassification?.accessoryDisplaySlots);
  if (explicitSlots.length > 0) {
    return explicitSlots;
  }

  return deriveAccessoryDisplaySlots({
    orientationGroup: aiClassification?.orientationGroup as PoseOrientationGroup | null | undefined,
    bodyFocus: aiClassification?.bodyFocus,
    faceVisible: aiClassification?.faceVisible,
  });
};

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
  aiClassification: Pick<
    PoseAiClassification,
    'usableForGarmentViews' | 'bodyFocus' | 'faceVisible' | 'orientationGroup' | 'accessoryDisplaySlots'
  > | null | undefined,
  availableViews: readonly GarmentView[],
  garmentBodyArea?: GarmentBodyArea | null,
  garmentAccessoryType?: GarmentAccessoryType | null,
): boolean => {
  if (getPoseUsableGarmentViews(aiClassification).length === 0) {
    return false;
  }

  if (!garmentBodyArea) {
    return canMatchPoseToGarmentViews(aiClassification, availableViews);
  }

  if (!isPoseFaceVisibilityCompatibleWithGarmentBodyArea(aiClassification?.faceVisible, garmentBodyArea)) {
    return false;
  }

  if (!aiClassification?.bodyFocus) {
    return true;
  }

  if (!isPoseBodyFocusCompatibleWithGarmentBodyArea(aiClassification.bodyFocus, garmentBodyArea)) {
    return false;
  }

  if (garmentBodyArea === 'carry_accessory') {
    return canPoseShowCarryAccessory(garmentAccessoryType, getPoseAccessoryDisplaySlots(aiClassification));
  }

  return canMatchPoseToGarmentViews(aiClassification, availableViews);
};

export const isPoseCompatibleWithGarmentViews = (
  aiClassification: Pick<
    PoseAiClassification,
    'usableForGarmentViews' | 'bodyFocus' | 'faceVisible' | 'orientationGroup' | 'accessoryDisplaySlots'
  > | null | undefined,
  availableViews: readonly GarmentView[],
  garmentBodyArea?: GarmentBodyArea | null,
  garmentAccessoryType?: GarmentAccessoryType | null,
): boolean => {
  if (!hasExplicitPoseGarmentViewMapping(aiClassification)) {
    return false;
  }

  return isPoseSuggestedForGarmentViews(aiClassification, availableViews, garmentBodyArea, garmentAccessoryType);
};

export const getSuggestedPoseIdsForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends {
    availableViews: readonly GarmentView[];
    garmentBodyArea?: GarmentBodyArea | null;
    garmentAccessoryType?: GarmentAccessoryType | null;
  },
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
        isPoseSuggestedForGarmentViews(
          pose.aiClassification,
          garment.availableViews,
          garment.garmentBodyArea,
          garment.garmentAccessoryType,
        ),
      ),
    )
    .map((pose) => pose.id);
};

export const countCompatibleGarmentsForPose = <
  TGarment extends {
    availableViews: readonly GarmentView[];
    garmentBodyArea?: GarmentBodyArea | null;
    garmentAccessoryType?: GarmentAccessoryType | null;
  },
>(
  aiClassification: Pick<
    PoseAiClassification,
    'usableForGarmentViews' | 'bodyFocus' | 'faceVisible' | 'orientationGroup' | 'accessoryDisplaySlots'
  > | null | undefined,
  garments: readonly TGarment[],
): number =>
  garments.filter((garment) =>
    isPoseCompatibleWithGarmentViews(
      aiClassification,
      garment.availableViews,
      garment.garmentBodyArea,
      garment.garmentAccessoryType,
    ),
  ).length;

export const countCompatiblePoseMatchesForGarments = <
  TPose extends Pick<Pose, 'id' | 'aiClassification'>,
  TGarment extends {
    availableViews: readonly GarmentView[];
    garmentBodyArea?: GarmentBodyArea | null;
    garmentAccessoryType?: GarmentAccessoryType | null;
  },
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

      return isPoseCompatibleWithGarmentViews(
        pose.aiClassification,
        garment.availableViews,
        garment.garmentBodyArea,
        garment.garmentAccessoryType,
      );
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
