import React, { useEffect } from 'react';
import { Client, Model } from '../../../../../shared/src/types';
import { classifyGarmentViewsWithGemini, previewProductDrafts } from '../../firebase';
import { getGarmentAvailableViews, getGarmentBodyArea } from '../../garments';
import { uploadGarmentDrafts } from '../../storage';
import {
  UploadedGarmentDraft,
  WizardState,
  createInitialPoseSuggestionState,
} from '../../types';
import {
  getUploadFailureMessage,
  mergeGarmentUploadResults,
  patchGarmentUploadState,
} from '../submit';
import { isGarmentUploadedForBatch } from '../state';
import {
  getSuggestedPoseIdsForGarments,
  markGarmentsAsClassifying,
  markGarmentsClassificationFailed,
  mergeGarmentClassificationResults,
} from './garmentClassification';

interface GarmentPreparationParams {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  draftBatchId: string | null;
  setDraftBatchId: (id: string | null) => void;
  setFlowError: (error: string | null) => void;
  missingPoseClassificationCount: number;
  selectedModel: Model | null;
  selectedClient: Client | null;
  suggestionSignature: string;
  productDraftSignature: string;
}

export const useGarmentPreparation = ({
  state,
  setState,
  draftBatchId,
  setDraftBatchId,
  setFlowError,
  missingPoseClassificationCount,
  selectedModel,
  selectedClient,
  suggestionSignature,
  productDraftSignature,
}: GarmentPreparationParams) => {
  const patchGarmentUpload = (garmentId: string, patch: Parameters<typeof patchGarmentUploadState>[2]) => {
    setState((current) => ({
      ...current,
      garments: patchGarmentUploadState(current.garments, garmentId, patch),
    }));
  };

  const ensureGarmentsUploadedForSuggestions = async (
    signature: string,
  ): Promise<{ activeDraftBatchId: string; garments: UploadedGarmentDraft[] }> => {
    const activeDraftBatchId = draftBatchId ?? crypto.randomUUID();
    if (!draftBatchId) {
      setDraftBatchId(activeDraftBatchId);
    }

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
      const message = getUploadFailureMessage(nextGarments, uploadResult.failed.length, activeDraftBatchId);
      setState((current) => ({
        ...current,
        poseSuggestions: {
          ...current.poseSuggestions,
          status: 'failed',
          error: message,
          signature,
          missingPoseClassificationCount,
        },
      }));
      setFlowError(message);
      throw new Error(message);
    }

    return { activeDraftBatchId, garments: nextGarments };
  };

  const preparePoseSuggestions = async (signature: string) => {
    if (!selectedModel || state.garments.length === 0) {
      return;
    }

    setState((current) => ({
      ...current,
      poseSuggestions: {
        ...current.poseSuggestions,
        status: 'preparing',
        error: null,
        missingPoseClassificationCount,
      },
    }));
    setFlowError(null);

    try {
      const { garments: uploadedGarments } = await ensureGarmentsUploadedForSuggestions(signature);
      const shouldClassifySpreadsheetData = (
        state.outputMode === 'spreadsheet'
        && Boolean(selectedClient?.id)
        && Boolean(state.selectedSpreadsheetTemplateId)
      );
      const garmentsNeedingClassification = uploadedGarments.filter((garment) => {
        const needsPhotoViews = garment.originalPhotos.some((photo) => photo.classification.status !== 'classified');
        const needsSpreadsheetMatch = shouldClassifySpreadsheetData && (!garment.matchedCategoryId || !garment.matchedColor);

        if (shouldClassifySpreadsheetData) {
          return needsPhotoViews || needsSpreadsheetMatch;
        }

        return garment.originalPhotos.length > 1 && needsPhotoViews;
      });

      let preparedGarments = uploadedGarments;

      if (garmentsNeedingClassification.length > 0) {
        const garmentIds = new Set(garmentsNeedingClassification.map((garment) => garment.id));
        setState((current) => ({
          ...current,
          garments: markGarmentsAsClassifying(current.garments, garmentIds),
        }));

        const classificationResult = await classifyGarmentViewsWithGemini({
          clientId: selectedClient?.id || null,
          spreadsheetTemplateId: state.selectedSpreadsheetTemplateId || null,
          fallbackCategoryId: state.selectedSpreadsheetCategoryId || null,
          garments: garmentsNeedingClassification.map((garment) => ({
            garmentId: garment.id,
            garmentName: garment.name,
            photos: garment.originalPhotos.map((photo) => {
              if (!photo.upload.storagePath) {
                throw new Error(`La foto ${photo.fileName} todavía no tiene storagePath.`);
              }

              return {
                id: photo.id,
                fileName: photo.fileName,
                storagePath: photo.upload.storagePath,
                sourceIndex: photo.sourceIndex,
              };
            }),
          })),
        });

        preparedGarments = mergeGarmentClassificationResults(uploadedGarments, classificationResult);
        setState((current) => ({
          ...current,
          garments: mergeGarmentClassificationResults(current.garments, classificationResult),
        }));
      }

      const suggestedPoseIds = getSuggestedPoseIdsForGarments(
        selectedModel.poses,
        preparedGarments.map((garment) => ({
          availableViews: getGarmentAvailableViews(garment),
          garmentBodyArea: getGarmentBodyArea(garment),
        })),
      );

      setState((current) => ({
        ...current,
        garments: preparedGarments,
        selectedPoseIds: suggestedPoseIds,
        poseSuggestions: {
          status: 'ready',
          error: null,
          suggestedPoseIds,
          signature,
          missingPoseClassificationCount,
        },
      }));
      setFlowError(null);
    } catch (prepareError: any) {
      const message =
        prepareError?.message
        || 'No se pudieron sugerir las poses automáticamente. Puedes seguir con selección manual.';
      setState((current) => {
        const garmentIds = new Set<string>(
          current.garments
            .filter((garment) => garment.originalPhotos.some((photo) => photo.classification.status === 'classifying'))
            .map((garment) => garment.id),
        );

        return {
          ...current,
          garments: markGarmentsClassificationFailed(current.garments, garmentIds, message),
          poseSuggestions: {
            ...current.poseSuggestions,
            status: 'failed',
            error: message,
            signature,
            missingPoseClassificationCount,
          },
        };
      });

      setFlowError(message);
    }
  };

  const prepareProductDrafts = async (signature: string) => {
    if (
      state.outputMode !== 'spreadsheet'
      || !selectedClient
      || !selectedModel
      || !state.selectedSpreadsheetTemplateId
      || state.garments.length === 0
    ) {
      return;
    }

    setState((current) => ({
      ...current,
      productDraftPreparation: {
        status: 'preparing',
        error: null,
        signature,
      },
    }));
    setFlowError(null);

    try {
      const { garments: uploadedGarments } = await ensureGarmentsUploadedForSuggestions(signature);
      const result = await previewProductDrafts({
        clientId: selectedClient.id!,
        modelId: selectedModel.id!,
        spreadsheetTemplateId: state.selectedSpreadsheetTemplateId,
        fallbackCategoryId: state.selectedSpreadsheetCategoryId || null,
        garments: uploadedGarments.map((garment) => ({
          id: garment.id,
          name: garment.name,
          storagePath: garment.originalPhotos[0]?.upload.storagePath || garment.upload.storagePath || '',
          isMultiAngle: garment.isMultiAngle,
          sourceType: garment.sourceType,
          originalFileNames: garment.originalFileNames,
          originalPhotoCount: garment.originalPhotos.length,
          matchedCategoryId: garment.matchedCategoryId || null,
          matchedCategoryLabel: garment.matchedCategoryLabel || null,
          matchedCategoryConfidence: garment.matchedCategoryConfidence ?? null,
          matchedCategoryReasoning: garment.matchedCategoryReasoning || null,
          matchedColor: garment.matchedColor || null,
          matchedColorConfidence: garment.matchedColorConfidence ?? null,
          matchedColorReasoning: garment.matchedColorReasoning || null,
          photos: garment.originalPhotos
            .filter((photo) => photo.upload.storagePath)
            .map((photo) => ({
              id: photo.id,
              fileName: photo.fileName,
              storagePath: photo.upload.storagePath!,
              sourceIndex: photo.sourceIndex,
              view: photo.classification.view || 'front',
              confidence: photo.classification.confidence,
              reasoning: photo.classification.reasoning,
              classifiedBy: photo.classification.classifiedBy || 'assumed_single_front',
            })),
        })),
      });

      setState((current) => ({
        ...current,
        productDrafts: result.productDrafts,
        productDraftPreparation: {
          status: 'ready',
          error: null,
          signature,
        },
      }));
    } catch (prepareError: any) {
      const message =
        prepareError?.message
        || 'No se pudieron preparar los drafts del producto. Puedes reintentar desde este paso.';
      setState((current) => ({
        ...current,
        productDraftPreparation: {
          status: 'failed',
          error: message,
          signature,
        },
      }));
      setFlowError(message);
    }
  };

  useEffect(() => {
    if (
      state.step !== 3
      || !selectedModel
      || state.garments.length === 0
      || state.poseSuggestions.status === 'preparing'
      || state.poseSuggestions.signature === suggestionSignature
    ) {
      return;
    }

    void preparePoseSuggestions(suggestionSignature);
  }, [
    missingPoseClassificationCount,
    selectedModel,
    state.garments.length,
    state.poseSuggestions.signature,
    state.poseSuggestions.status,
    state.step,
    suggestionSignature,
  ]);

  useEffect(() => {
    if (
      state.step !== 4
      || state.outputMode !== 'spreadsheet'
      || !state.selectedSpreadsheetTemplateId
      || state.garments.length === 0
      || state.productDraftPreparation.status === 'preparing'
      || state.productDraftPreparation.signature === productDraftSignature
    ) {
      return;
    }

    void prepareProductDrafts(productDraftSignature);
  }, [
    productDraftSignature,
    state.garments.length,
    state.outputMode,
    state.selectedSpreadsheetTemplateId,
    state.productDraftPreparation.signature,
    state.productDraftPreparation.status,
    state.step,
  ]);
};
