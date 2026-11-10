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
  const analysisInFlight = useRef(false);
  const latestDraftSignature = useRef(productDraftSignature);
  latestDraftSignature.current = productDraftSignature;

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

  const ensureGarmentsUploaded = async (): Promise<{ activeDraftBatchId: string; garments: UploadedGarmentDraft[] }> => {
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
      throw new Error(message);
    }

    return { activeDraftBatchId, garments: nextGarments };
  };

  const classificationInput = (garments: UploadedGarmentDraft[]) => garments.map((garment) => ({
    garmentId: garment.id,
    garmentName: garment.name,
    photos: garment.originalPhotos.map((photo) => {
      if (!photo.upload.storagePath) throw new Error(`La foto ${photo.fileName} todavía no se ha subido.`);
      return { id: photo.id, fileName: photo.fileName, storagePath: photo.upload.storagePath, sourceIndex: photo.sourceIndex };
    }),
  }));

  const prepareItemAnalysis = async (garmentIds: Set<string>) => {
    analysisInFlight.current = true;
    setFlowError(null);
    setState((current) => ({
      ...current,
      garments: markGarmentsAsClassifying(current.garments, garmentIds).map((garment) =>
        garmentIds.has(garment.id) ? { ...garment, analysisStatus: 'preparing', analysisError: null } : garment),
    }));
    try {
      const { garments } = await ensureGarmentsUploaded();
      const result = await classifyGarmentViewsWithGemini({
        garments: classificationInput(garments.filter((garment) => garmentIds.has(garment.id))),
      });
      if (!result.success || [...garmentIds].some((id) => !result.garments.some((garment) => garment.garmentId === id))) {
        throw new Error('El análisis no devolvió todos los artículos. Reintenta las fotos pendientes.');
      }
      setState((current) => ({ ...current, garments: mergeGarmentClassificationResults(current.garments, result) }));
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudieron analizar las fotos. Puedes reintentar sin volver a subirlas.');
      setState((current) => ({
        ...current,
        garments: markGarmentsClassificationFailed(current.garments, garmentIds, message).map((garment) =>
          garmentIds.has(garment.id) ? { ...garment, analysisStatus: 'failed', analysisError: message } : garment),
      }));
      setFlowError(message);
    } finally {
      analysisInFlight.current = false;
    }
  };

  const preparePoseSuggestions = (signature: string) => {
    if (!selectedModel) return;
    const accessoryInferenceTexts = [selectedSpreadsheetCategoryLabel];
    const garments = state.garments.map((garment) => applyGarmentAccessoryInference(garment, accessoryInferenceTexts));
    const suggestedPoseIds = getSuggestedPoseIdsForGarments(selectedModel.poses, garments.map((garment) => ({
      availableViews: getGarmentAvailableViews(garment),
      garmentBodyArea: getEffectiveGarmentBodyArea(garment, accessoryInferenceTexts),
      garmentAccessoryType: getEffectiveGarmentAccessoryType(garment, accessoryInferenceTexts),
    })));
    setState((current) => ({
      ...current, selectedPoseIds: suggestedPoseIds,
      poseSuggestions: { status: 'ready', error: null, suggestedPoseIds, signature, missingPoseClassificationCount },
    }));
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
      const { garments: uploadedGarments } = await ensureGarmentsUploaded();
      if (latestDraftSignature.current !== signature) return;
      const latestState = stateRef.current;
      const classificationKey = JSON.stringify([latestState.selectedClientId, latestState.selectedSpreadsheetTemplateId, latestState.selectedSpreadsheetCategoryId]);
      const needsCategories = uploadedGarments.filter((garment) => garment.spreadsheetClassificationKey !== classificationKey);
      let preparedGarments = uploadedGarments;
      if (needsCategories.length > 0) {
        const classification = await classifyGarmentViewsWithGemini({
          clientId: latestState.selectedClientId,
          spreadsheetTemplateId: latestState.selectedSpreadsheetTemplateId,
          fallbackCategoryId: latestState.selectedSpreadsheetCategoryId,
          garments: classificationInput(needsCategories),
        });
        if (latestDraftSignature.current !== signature) return;
        if (!classification.success || needsCategories.some((garment) => !classification.garments.some((entry) => entry.garmentId === garment.id))) {
          throw new Error('No se pudieron clasificar las categorías de todos los artículos.');
        }
        const classifiedIds = new Set(needsCategories.map((garment) => garment.id));
        const mergeCategories = (garments: UploadedGarmentDraft[]) => mergeGarmentClassificationResults(garments, classification, true)
          .map((garment) => classifiedIds.has(garment.id) ? { ...garment, spreadsheetClassificationKey: classificationKey } : garment);
        preparedGarments = mergeCategories(uploadedGarments);
        setState((current) => ({ ...current, garments: mergeCategories(current.garments) }));
      }
      const result = await previewProductDrafts({
        clientId: selectedClient.id!,
        modelId: selectedModel.id!,
        spreadsheetTemplateId: latestState.selectedSpreadsheetTemplateId,
        fallbackCategoryId: latestState.selectedSpreadsheetCategoryId || null,
        garments: buildProductDraftPreviewGarments(preparedGarments),
        sourceSpreadsheet:
          latestState.sourceSpreadsheet?.status === 'uploaded' && latestState.sourceSpreadsheet.storagePath
            ? {
                storagePath: latestState.sourceSpreadsheet.storagePath,
                originalFileName: latestState.sourceSpreadsheet.originalFileName,
              }
            : null,
      });

      if (latestDraftSignature.current !== signature) return;
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
      if (latestDraftSignature.current !== signature) return;
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
    } finally {
      setState((current) => current.productDraftPreparation.status === 'preparing'
        && current.productDraftPreparation.signature === signature
        ? { ...current, productDraftPreparation: { status: 'idle', error: null, signature: null } } : current);
    }
  };

  useEffect(() => {
    if (state.step !== 1 || !state.selectedClientId || analysisInFlight.current) return;
    const pending = state.garments.filter((garment) => !garment.analysisStatus || garment.analysisStatus === 'idle');
    if (pending.length) void prepareItemAnalysis(new Set(pending.map((garment) => garment.id)));
  }, [state.step, state.selectedClientId, state.garments]);

  useEffect(() => {
    if (
      state.marketplacePhotoPlan
      || state.generationKind !== 'garment'
      || state.step !== 2
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
      || state.step !== 3
      || state.outputMode !== 'spreadsheet'
      || !state.selectedSpreadsheetTemplateId
      || state.garments.length === 0
      || state.productDraftPreparation.status === 'preparing'
      || (state.productDraftPreparation.status === 'failed' && state.productDraftPreparation.signature === productDraftSignature)
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
    selectedClient,
    selectedModel,
    state.garments.length,
    state.outputMode,
    state.selectedSpreadsheetTemplateId,
    state.productDraftPreparation.signature,
    state.productDraftPreparation.status,
    state.step,
    state.generationKind,
  ]);
};
