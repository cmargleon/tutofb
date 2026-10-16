import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { Client, Model } from '../../../../../shared/src/types';
import { classifyGarmentViewsWithGemini, previewProductDrafts } from '../../firebase';
import {
  applyGarmentAccessoryInference,
  getEffectiveGarmentAccessoryType,
  getEffectiveGarmentBodyArea,
  getGarmentAvailableViews,
} from '../../garments';
import { uploadGarmentDrafts } from '../../storage';
import {
  UploadedGarmentDraft,
  WizardState,
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

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message
    ? error.message
    : fallback;

const shouldClassifyGarmentSpreadsheetData = (
  outputMode: WizardState['outputMode'],
  clientId: string | null | undefined,
  spreadsheetTemplateId: string | null,
): boolean => outputMode === 'spreadsheet' && Boolean(clientId) && Boolean(spreadsheetTemplateId);

const getGarmentsNeedingClassification = (
  garments: UploadedGarmentDraft[],
  shouldClassifySpreadsheetData: boolean,
): UploadedGarmentDraft[] =>
  garments.filter((garment) => {
    const needsPhotoViews = garment.originalPhotos.some((photo) => photo.classification.status !== 'classified');
    const needsBodyArea = !garment.garmentBodyArea;
    const needsAccessoryType = garment.garmentBodyArea === 'carry_accessory' && !garment.garmentAccessoryType;
    const needsSpreadsheetMatch = shouldClassifySpreadsheetData && (!garment.matchedCategoryId || !garment.matchedColor);

    if (shouldClassifySpreadsheetData) {
      return needsPhotoViews || needsBodyArea || needsAccessoryType || needsSpreadsheetMatch;
    }

    return needsBodyArea || needsAccessoryType || (garment.originalPhotos.length > 1 && needsPhotoViews);
  });

const buildProductDraftPreviewGarments = (garments: UploadedGarmentDraft[]) =>
  garments.map((garment) => ({
    id: garment.id,
    name: garment.name,
    storagePath: garment.originalPhotos[0]?.upload.storagePath || garment.upload.storagePath || '',
    isMultiAngle: garment.isMultiAngle,
    sourceType: garment.sourceType,
    originalFileNames: garment.originalFileNames,
    originalPhotoCount: garment.originalPhotos.length,
    garmentBodyArea: garment.garmentBodyArea ?? null,
    garmentAccessoryType: garment.garmentAccessoryType ?? null,
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
  }));

interface GarmentPreparationParams {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  draftBatchId: string | null;
  setDraftBatchId: (id: string | null) => void;
  setFlowError: (error: string | null) => void;
  missingPoseClassificationCount: number;
  selectedModel: Model | null;
  selectedClient: Client | null;
  selectedSpreadsheetCategoryLabel: string | null;
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
  selectedSpreadsheetCategoryLabel,
  suggestionSignature,
  productDraftSignature,
}: GarmentPreparationParams) => {
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const patchGarmentUpload = (
    garmentId: string,
    patch: Parameters<typeof patchGarmentUploadState>[2],
  ) => {
    setState((current) => ({
      ...current,
      garments: patchGarmentUploadState(current.garments, garmentId, patch),
    }));
  };

  const ensureGarmentsUploadedForSuggestions = async (
    signature: string,
  ): Promise<{ activeDraftBatchId: string; garments: UploadedGarmentDraft[] }> => {
    const currentState = stateRef.current;
    const activeDraftBatchId = draftBatchId ?? crypto.randomUUID();

    if (!draftBatchId) {
      setDraftBatchId(activeDraftBatchId);
    }

    const garmentsToUpload = currentState.garments.filter(
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

    const nextGarments = mergeGarmentUploadResults(
      stateRef.current.garments,
      uploadResult,
      activeDraftBatchId,
    );

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
    const currentState = stateRef.current;

    if (!selectedModel || currentState.garments.length === 0) {
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
      const latestState = stateRef.current;
      const shouldClassifySpreadsheetData = shouldClassifyGarmentSpreadsheetData(
        latestState.outputMode,
        selectedClient?.id,
        latestState.selectedSpreadsheetTemplateId,
      );
      const garmentsNeedingClassification = getGarmentsNeedingClassification(
        uploadedGarments,
        shouldClassifySpreadsheetData,
      );

      const accessoryInferenceTexts = [selectedSpreadsheetCategoryLabel];
      let preparedGarments = uploadedGarments.map((garment) =>
        applyGarmentAccessoryInference(garment, accessoryInferenceTexts),
      );

      if (garmentsNeedingClassification.length > 0) {
        const garmentIds = new Set(garmentsNeedingClassification.map((garment) => garment.id));
        setState((current) => ({
          ...current,
          garments: markGarmentsAsClassifying(current.garments, garmentIds),
        }));

        const classificationResult = await classifyGarmentViewsWithGemini({
          clientId: selectedClient?.id || null,
          spreadsheetTemplateId: latestState.selectedSpreadsheetTemplateId || null,
          fallbackCategoryId: latestState.selectedSpreadsheetCategoryId || null,
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

        preparedGarments = mergeGarmentClassificationResults(uploadedGarments, classificationResult)
          .map((garment) => applyGarmentAccessoryInference(garment, accessoryInferenceTexts));
        setState((current) => ({
          ...current,
          garments: mergeGarmentClassificationResults(current.garments, classificationResult)
            .map((garment) => applyGarmentAccessoryInference(garment, accessoryInferenceTexts)),
        }));
      }

      const suggestedPoseIds = getSuggestedPoseIdsForGarments(
        selectedModel.poses,
        preparedGarments.map((garment) => ({
          availableViews: getGarmentAvailableViews(garment),
          garmentBodyArea: getEffectiveGarmentBodyArea(garment, accessoryInferenceTexts),
          garmentAccessoryType: getEffectiveGarmentAccessoryType(garment, accessoryInferenceTexts),
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
    } catch (prepareError) {
      const message = getErrorMessage(
        prepareError,
        'No se pudieron sugerir las poses automáticamente. Puedes seguir con selección manual.',
      );

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
    const currentState = stateRef.current;

    if (
      currentState.outputMode !== 'spreadsheet'
      || !selectedClient
      || !selectedModel
      || !currentState.selectedSpreadsheetTemplateId
      || (currentState.sourceSpreadsheet !== null && currentState.sourceSpreadsheet.status !== 'uploaded')
      || currentState.garments.length === 0
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
      const latestState = stateRef.current;
      const result = await previewProductDrafts({
        clientId: selectedClient.id!,
        modelId: selectedModel.id!,
        spreadsheetTemplateId: latestState.selectedSpreadsheetTemplateId,
        fallbackCategoryId: latestState.selectedSpreadsheetCategoryId || null,
        garments: buildProductDraftPreviewGarments(uploadedGarments),
        sourceSpreadsheet:
          latestState.sourceSpreadsheet?.status === 'uploaded' && latestState.sourceSpreadsheet.storagePath
            ? {
                storagePath: latestState.sourceSpreadsheet.storagePath,
                originalFileName: latestState.sourceSpreadsheet.originalFileName,
              }
            : null,
      });

      setState((current) => ({
        ...current,
        productDrafts: result.productDrafts,
        sourceSpreadsheetSummary: result.sourceSpreadsheetSummary || null,
        productDraftPreparation: {
          status: 'ready',
          error: null,
          signature,
        },
      }));
    } catch (prepareError) {
      const message = getErrorMessage(
        prepareError,
        'No se pudieron preparar los drafts del producto. Puedes reintentar desde este paso.',
      );

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
      state.generationKind !== 'garment'
      || state.step !== 3
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
    state.generationKind,
    suggestionSignature,
  ]);

  useEffect(() => {
    if (
      state.generationKind !== 'garment'
      || state.step !== 4
      || state.outputMode !== 'spreadsheet'
      || !state.selectedSpreadsheetTemplateId
      || state.garments.length === 0
      || state.productDraftPreparation.status === 'preparing'
      || (
        state.productDraftPreparation.status === 'ready'
        && state.productDraftPreparation.signature === productDraftSignature
      )
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
    state.generationKind,
  ]);
};
