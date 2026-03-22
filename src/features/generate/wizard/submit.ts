import { CreateGenerationBatchRequest } from '../../../../shared/src/types';
import { UploadGarmentDraftsResult } from '../storage';
import { GarmentUploadState, UploadedGarmentDraft, WizardState } from '../types';
import { isGarmentUploadedForBatch } from './state';

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
    .map((garment) => ({
      id: garment.id,
      name: garment.name,
      storagePath: garment.upload.storagePath!,
      isMultiAngle: garment.isMultiAngle,
      sourceType: garment.sourceType,
      originalFileNames: garment.originalFileNames,
    }));

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

export const buildCreateGenerationBatchRequest = (state: WizardState, garments: CreateGenerationBatchRequest['garments']): CreateGenerationBatchRequest => ({
  clientId: state.selectedClientId!,
  modelId: state.selectedModelId!,
  poseIds: state.selectedPoseIds,
  garments,
  provider: state.provider,
  experiment: state.experiment.enabled
    ? { enabled: true, mode: state.experiment.mode, providers: state.experiment.providers }
    : null,
  promptBase: state.prompt,
  aspectRatio: state.aspectRatio,
});
