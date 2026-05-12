import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGenerationBatch } from '../../firebase';
import { uploadGarmentDrafts } from '../../storage';
import { GenerateSubmitStage, UploadSummary, WizardState } from '../../types';
import {
  buildCreateGenerationBatchRequest,
  getUploadFailureMessage,
  getUploadedGarmentsForBatch,
  mergeGarmentUploadResults,
  patchGarmentUploadState,
} from '../submit';
import {
  getGenerateWizardSubmitButtonLabel,
  getSelectedProviderImageConfig,
  isGarmentUploadedForBatch,
} from '../state';

interface UseGenerateWizardSubmitParams {
  state: WizardState;
  draftBatchId: string | null;
  totalJobs: number;
  uploadSummary: UploadSummary;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  setFlowError: (error: string | null) => void;
  setDraftBatchId: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UseGenerateWizardSubmitReturn {
  isSubmitting: boolean;
  submitStage: GenerateSubmitStage;
  draftBatchId: string | null;
  uploadedGarmentCount: number;
  submitButtonLabel: string;
  handleSubmit: () => Promise<void>;
  resetDraftBatch: () => void;
}

export const useGenerateWizardSubmit = ({
  state,
  draftBatchId,
  totalJobs,
  uploadSummary,
  setState,
  setFlowError,
  setDraftBatchId,
}: UseGenerateWizardSubmitParams): UseGenerateWizardSubmitReturn => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<GenerateSubmitStage>('idle');

  const uploadedGarmentCount = useMemo(
    () => state.garments.filter((garment) => isGarmentUploadedForBatch(garment, draftBatchId)).length,
    [draftBatchId, state.garments],
  );

  const submitButtonLabel = useMemo(
    () =>
      getGenerateWizardSubmitButtonLabel({
        isSubmitting,
        submitStage,
        uploadedGarmentCount,
        garmentCount: state.garments.length,
        totalJobs,
        uploadSummary,
      }),
    [isSubmitting, state.garments.length, submitStage, totalJobs, uploadSummary, uploadedGarmentCount],
  );

  const patchGarmentUpload = (garmentId: string, patch: Parameters<typeof patchGarmentUploadState>[2]) => {
    setState((current) => ({
      ...current,
      garments: patchGarmentUploadState(current.garments, garmentId, patch),
    }));
  };

  const handleSubmit = async () => {
    const requiresSpreadsheet = state.outputMode === 'spreadsheet';

    if (
      !state.selectedClientId ||
      !state.selectedModelId ||
      state.selectedPoseIds.length === 0 ||
      state.garments.length === 0 ||
      (requiresSpreadsheet && !state.selectedSpreadsheetTemplateId) ||
      (requiresSpreadsheet && state.productDrafts.length === 0)
    ) {
      setFlowError(
        requiresSpreadsheet
          ? 'Completa cliente, modelo, spreadsheet, poses, prendas y drafts antes de crear el lote.'
          : 'Completa cliente, modelo, poses y prendas antes de crear el lote.',
      );
      return;
    }

    if (state.outputMode === 'spreadsheet' && state.sourceSpreadsheet?.status === 'uploading') {
      setFlowError('Espera a que termine la subida del spreadsheet fuente antes de crear el lote.');
      return;
    }

    if (state.outputMode === 'spreadsheet' && state.sourceSpreadsheet?.status === 'failed') {
      setFlowError('El spreadsheet fuente falló al subir. Vuelve a cargarlo o quítalo antes de crear el lote.');
      return;
    }

    const selectedProviderImageConfig = getSelectedProviderImageConfig(state);
    if (
      selectedProviderImageConfig.provider === 'fal-seedream'
      && typeof selectedProviderImageConfig.imageSize !== 'string'
    ) {
      const { width, height } = selectedProviderImageConfig.imageSize;
      const totalPixels = width * height;

      if (width < 512 || height < 512 || width > 4096 || height > 4096) {
        setFlowError('Seedream admite pixeles custom entre 512 y 4096 por lado.');
        return;
      }

      if (totalPixels < 921600) {
        setFlowError('Con Seedream custom necesitas al menos 921,600 px en total. Un ejemplo valido es 1280x720.');
        return;
      }
    }

    if (
      selectedProviderImageConfig.provider === 'fal-gpt-image-2'
      && typeof selectedProviderImageConfig.imageSize !== 'string'
    ) {
      const { width, height } = selectedProviderImageConfig.imageSize;
      const totalPixels = width * height;
      const shortestSide = Math.min(width, height);
      const longestSide = Math.max(width, height);

      if (width % 16 !== 0 || height % 16 !== 0) {
        setFlowError('GPT Image 2 requiere dimensiones custom en múltiplos de 16.');
        return;
      }

      if (longestSide > 3840 || shortestSide <= 0 || longestSide / shortestSide > 3) {
        setFlowError('GPT Image 2 admite lado máximo 3840 px y relación máxima 3:1.');
        return;
      }

      if (totalPixels < 655360 || totalPixels > 8294400) {
        setFlowError('GPT Image 2 requiere entre 655,360 y 8,294,400 px en total.');
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitStage('uploading');
    setFlowError(null);
    const activeDraftBatchId = draftBatchId ?? crypto.randomUUID();
    if (!draftBatchId) {
      setDraftBatchId(activeDraftBatchId);
    }

    try {
      const garmentsToUpload = state.garments.filter(
        (garment) => !isGarmentUploadedForBatch(garment, activeDraftBatchId),
      );

      const uploadResult =
        garmentsToUpload.length > 0
          ? await uploadGarmentDrafts(activeDraftBatchId, garmentsToUpload, {
              concurrency: 4,
              maxRetries: 2,
              onProgress: (event) => {
                patchGarmentUpload(event.garmentId, {
                  status: event.status,
                  progress: event.progress,
                  attempts: event.attempts,
                  error: event.error,
                  storagePath: event.storagePath,
                  draftBatchId: activeDraftBatchId,
                });
              },
            })
          : { uploaded: [], failed: [] };

      const nextGarments = mergeGarmentUploadResults(state.garments, uploadResult, activeDraftBatchId);

      if (uploadResult.uploaded.length > 0 || uploadResult.failed.length > 0) {
        setState((current) => ({
          ...current,
          garments: mergeGarmentUploadResults(current.garments, uploadResult, activeDraftBatchId),
        }));
      }

      if (uploadResult.failed.length > 0) {
        setFlowError(getUploadFailureMessage(nextGarments, uploadResult.failed.length, activeDraftBatchId));
        return;
      }

      const uploadedGarments = getUploadedGarmentsForBatch(nextGarments, activeDraftBatchId);
      if (uploadedGarments.length === 0) {
        setFlowError('No hay prendas listas para crear el lote.');
        return;
      }

      setSubmitStage('creating-batch');
      const result = await createGenerationBatch(buildCreateGenerationBatchRequest(state, uploadedGarments));

      navigate(`/catalogo?clientId=${state.selectedClientId}&batchId=${result.batchId}`);
    } catch (submitError: any) {
      console.error(submitError);
      setFlowError(
        submitError.message ||
          'No se pudo crear el lote. Las prendas ya subidas quedaron listas para reintentar sin volver a cargarlas.',
      );
    } finally {
      setIsSubmitting(false);
      setSubmitStage('idle');
    }
  };

  return {
    isSubmitting,
    submitStage,
    draftBatchId,
    uploadedGarmentCount,
    submitButtonLabel,
    handleSubmit,
    resetDraftBatch: () => setDraftBatchId(null),
  };
};
