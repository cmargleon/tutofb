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
  isGarmentUploadedForBatch,
} from '../state';

interface UseGenerateWizardSubmitParams {
  state: WizardState;
  draftBatchId: string | null;
  experimentProviderError: string | null;
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
  experimentProviderError,
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
    if (
      !state.selectedClientId ||
      !state.selectedModelId ||
      state.selectedPoseIds.length === 0 ||
      state.garments.length === 0
    ) {
      setFlowError('Completa cliente, modelo, poses y prendas antes de crear el lote.');
      return;
    }

    if (experimentProviderError) {
      setFlowError(experimentProviderError);
      return;
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

      navigate(`/evaluacion?batchId=${result.batchId}`);
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
