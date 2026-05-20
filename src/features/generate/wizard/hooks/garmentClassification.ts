import * as garmentViewMatchingNamespace from '../../../../../shared/src/utils/garmentViewMatching';
import { classifyGarmentViewsWithGemini } from '../../firebase';
import { UploadedGarmentDraft } from '../../types';

const garmentViewMatchingModule =
  ((garmentViewMatchingNamespace as { default?: unknown }).default as typeof import('../../../../../shared/src/utils/garmentViewMatching'))
  ?? (garmentViewMatchingNamespace as typeof import('../../../../../shared/src/utils/garmentViewMatching'));

export const { countCompatiblePoseMatchesForGarments, getSuggestedPoseIdsForGarments } =
  garmentViewMatchingModule as typeof import('../../../../../shared/src/utils/garmentViewMatching');

export const markGarmentsAsClassifying = (
  garments: UploadedGarmentDraft[],
  garmentIds: Set<string>,
): UploadedGarmentDraft[] =>
  garments.map((garment) =>
    garmentIds.has(garment.id)
      ? {
          ...garment,
          originalPhotos: garment.originalPhotos.map((photo) => ({
            ...photo,
            classification: {
              ...photo.classification,
              status: 'classifying',
              error: null,
            },
          })),
        }
      : garment,
  );

export const mergeGarmentClassificationResults = (
  garments: UploadedGarmentDraft[],
  response: Awaited<ReturnType<typeof classifyGarmentViewsWithGemini>>,
): UploadedGarmentDraft[] => {
  const garmentsById = new Map(response.garments.map((garment) => [garment.garmentId, garment]));

  return garments.map((garment) => {
    const classifiedGarment = garmentsById.get(garment.id);
    if (!classifiedGarment) {
      return garment;
    }

    const photosById = new Map(classifiedGarment.photos.map((photo) => [photo.id, photo]));
    return {
      ...garment,
      garmentBodyArea: classifiedGarment.garmentBodyArea ?? garment.garmentBodyArea ?? null,
      garmentAccessoryType: classifiedGarment.garmentAccessoryType ?? garment.garmentAccessoryType ?? null,
      matchedCategoryId: classifiedGarment.matchedCategoryId ?? garment.matchedCategoryId ?? null,
      matchedCategoryLabel: classifiedGarment.matchedCategoryLabel ?? garment.matchedCategoryLabel ?? null,
      matchedCategoryConfidence: classifiedGarment.matchedCategoryConfidence ?? garment.matchedCategoryConfidence ?? null,
      matchedCategoryReasoning: classifiedGarment.matchedCategoryReasoning ?? garment.matchedCategoryReasoning ?? null,
      matchedColor: classifiedGarment.matchedColor ?? garment.matchedColor ?? null,
      matchedColorConfidence: classifiedGarment.matchedColorConfidence ?? garment.matchedColorConfidence ?? null,
      matchedColorReasoning: classifiedGarment.matchedColorReasoning ?? garment.matchedColorReasoning ?? null,
      originalPhotos: garment.originalPhotos.map((photo) => {
        const classifiedPhoto = photosById.get(photo.id);
        if (!classifiedPhoto) {
          return photo;
        }

        return {
          ...photo,
          classification: {
            status: 'classified',
            view: classifiedPhoto.view,
            confidence: classifiedPhoto.confidence ?? null,
            reasoning: classifiedPhoto.reasoning ?? null,
            classifiedBy: classifiedPhoto.classifiedBy,
            error: null,
          },
        };
      }),
    };
  });
};

export const markGarmentsClassificationFailed = (
  garments: UploadedGarmentDraft[],
  garmentIds: Set<string>,
  message: string,
): UploadedGarmentDraft[] =>
  garments.map((garment) =>
    garmentIds.has(garment.id)
      ? {
          ...garment,
          originalPhotos: garment.originalPhotos.map((photo) => ({
            ...photo,
            classification: {
              ...photo.classification,
              status: photo.classification.status === 'classified' ? 'classified' : 'failed',
              error: photo.classification.status === 'classified' ? null : message,
            },
          })),
        }
      : garment,
  );
