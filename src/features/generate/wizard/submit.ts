import { CreateGenerationBatchRequest } from '../../../../shared/src/types';
import { resolveAspectRatioForImageConfig } from '../../../../shared/src/providerImageConfig';
import { UploadGarmentDraftsResult } from '../storage';
import { GarmentUploadState, UploadedGarmentDraft, WizardState } from '../types';
import { getSelectedProviderImageConfig, isGarmentUploadedForBatch } from './state';

type UploadedGarmentPhotoRequest = NonNullable<CreateGenerationBatchRequest['garments'][number]['photos']>[number];

export const patchGarmentUploadState = (
  garments: UploadedGarmentDraft[],
  garmentId: string,
  patch: Partial<GarmentUploadState>,
): UploadedGarmentDraft[] =>
  garments.map((garment) =>
    garment.id === garmentId
      ? { ...garment, upload: { ...garment.upload, ...patch } }
      : garment,
  );

export const mergeGarmentUploadResults = (
  garments: UploadedGarmentDraft[],
  uploadResult: UploadGarmentDraftsResult,
  draftBatchId: string,
): UploadedGarmentDraft[] => {
  const uploadedById = new Map(uploadResult.uploaded.map((item) => [item.garmentId, item]));
  const failedById = new Map(uploadResult.failed.map((item) => [item.garmentId, item]));

  return garments.map((garment) => {
    const uploaded = uploadedById.get(garment.id);
    if (uploaded) {
      return {
        ...garment,
        originalPhotos: garment.originalPhotos.map((photo) => {
          const uploadedPhoto = uploaded.photoUploads.find((entry) => entry.photoId === photo.id);
          return {
            ...photo,
            upload: {
              ...photo.upload,
              status: uploadedPhoto ? 'uploaded' : photo.upload.status,
              progress: uploadedPhoto ? 100 : photo.upload.progress,
              attempts: uploaded.attempts,
              error: uploadedPhoto ? null : photo.upload.error,
              storagePath: uploadedPhoto?.storagePath || null,
              draftBatchId,
            },
          };
        }),
        upload: {
          ...garment.upload,
          status: 'uploaded',
          progress: 100,
          attempts: uploaded.attempts,
          error: null,
          storagePath: uploaded.storagePath,
          draftBatchId,
        },
      };
    }

    const failed = failedById.get(garment.id);
    if (failed) {
      return {
        ...garment,
        originalPhotos: garment.originalPhotos.map((photo) => ({
          ...photo,
          upload: {
            ...photo.upload,
            status: 'failed',
            attempts: failed.attempts,
            error: failed.error,
            storagePath: null,
            draftBatchId,
          },
        })),
        upload: {
          ...garment.upload,
          status: 'failed',
          attempts: failed.attempts,
          error: failed.error,
          storagePath: null,
          draftBatchId,
        },
      };
    }

    return garment;
  });
};

export const getUploadedGarmentsForBatch = (
  garments: UploadedGarmentDraft[],
  draftBatchId: string,
): CreateGenerationBatchRequest['garments'] =>
  garments
    .filter((garment) => isGarmentUploadedForBatch(garment, draftBatchId))
    .map((garment) => {
      const photos = garment.originalPhotos.reduce<UploadedGarmentPhotoRequest[]>((result, photo) => {
        if (!photo.upload.storagePath) {
          return result;
        }

        result.push({
          id: photo.id,
          fileName: photo.fileName,
          storagePath: photo.upload.storagePath,
          sourceIndex: photo.sourceIndex,
          view: photo.classification.view || 'front',
          confidence: photo.classification.confidence,
          reasoning: photo.classification.reasoning,
          classifiedBy: photo.classification.classifiedBy || 'assumed_single_front',
        });

        return result;
      }, []);

      return {
        id: garment.id,
        name: garment.name,
        storagePath: photos[0]?.storagePath || garment.upload.storagePath!,
        isMultiAngle: garment.isMultiAngle,
        sourceType: garment.sourceType,
        originalFileNames: garment.originalFileNames,
        originalPhotoCount: garment.originalPhotos.length,
        photos,
      };
    });

export const getUploadFailureMessage = (
  garments: UploadedGarmentDraft[],
  failedCount: number,
  draftBatchId: string,
): string => {
  const readyCount = garments.filter((garment) => isGarmentUploadedForBatch(garment, draftBatchId)).length;

  if (readyCount > 0) {
    return `Se subieron ${readyCount} prenda${readyCount === 1 ? '' : 's'}, pero ${failedCount} falló/fallaron. Puedes reintentar y solo se volverán a subir las pendientes.`;
  }

  return 'No se pudo completar la subida del lote. Puedes reintentar y las prendas exitosas quedarán recuperadas.';
};

export const buildCreateGenerationBatchRequest = (
  state: WizardState,
  garments: CreateGenerationBatchRequest['garments'],
): CreateGenerationBatchRequest => {
  const imageConfig = getSelectedProviderImageConfig(state);

  return {
    clientId: state.selectedClientId!,
    modelId: state.selectedModelId!,
    poseIds: state.selectedPoseIds,
    garments,
    provider: state.provider,
    promptBase: state.prompt,
    aspectRatio: resolveAspectRatioForImageConfig(imageConfig),
    imageConfig,
  };
};
