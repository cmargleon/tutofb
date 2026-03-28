import { useEffect, useMemo, useRef, useState } from 'react';
import * as garmentViewMatchingNamespace from '../../../../../shared/src/utils/garmentViewMatching';
import { DEFAULT_TRY_ON_PROMPT } from '../../../../../shared/src/domain';
import { classifyGarmentViewsWithGemini } from '../../firebase';
import { useSystemConfig } from '../../../system/useSystemConfig';
import { buildGarmentSuggestionSignature, getGarmentAvailableViews, handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { deleteGarmentDraftByStoragePath, uploadGarmentDrafts } from '../../storage';
import {
  GenerateWizardStepId,
  UploadedGarmentDraft,
  WizardProviderImageConfig,
  WizardState,
  createInitialPoseSuggestionState,
} from '../../types';
import { canSelectWizardStep, clampWizardStep } from '../../../wizard/navigation';
import { useGenerateWizardCatalog } from './useGenerateWizardCatalog';
import { useGenerateWizardSubmit } from './useGenerateWizardSubmit';
import {
  getUploadFailureMessage,
  mergeGarmentUploadResults,
  patchGarmentUploadState,
} from '../submit';
import {
  buildGarmentUploadSummary,
  createInitialGenerateWizardState,
  GENERATE_WIZARD_MAX_STEP,
  getGenerateWizardCanAdvance,
  getGenerateWizardTotalJobs,
  isGarmentUploadedForBatch,
  isGenerateWizardStepComplete,
} from '../state';

const garmentViewMatchingModule =
  ((garmentViewMatchingNamespace as { default?: unknown }).default as typeof import('../../../../../shared/src/utils/garmentViewMatching'))
  ?? (garmentViewMatchingNamespace as typeof import('../../../../../shared/src/utils/garmentViewMatching'));

const { countCompatiblePoseMatchesForGarments, getSuggestedPoseIdsForGarments } =
  garmentViewMatchingModule as typeof import('../../../../../shared/src/utils/garmentViewMatching');

const markGarmentsAsClassifying = (
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

const mergeGarmentClassificationResults = (
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

const markGarmentsClassificationFailed = (
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

export const useGenerateWizard = () => {
  const garmentUrlsRef = useRef<UploadedGarmentDraft[]>([]);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<GenerateWizardStepId>(1);
  const [state, setState] = useState<WizardState>(createInitialGenerateWizardState);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [draftBatchId, setDraftBatchId] = useState<string | null>(null);
  const [isPromptDirty, setIsPromptDirty] = useState(false);

  const { config: systemConfig } = useSystemConfig();

  const {
    clients,
    models,
    selectedClient,
    selectedModel,
    loadingData,
    error: catalogError,
  } = useGenerateWizardCatalog({
    selectedClientId: state.selectedClientId,
    selectedModelId: state.selectedModelId,
  });

  const resolvedPromptBase = useMemo(() => {
    const clientPrompt = selectedClient?.generationPromptBase?.trim();
    if (clientPrompt) {
      return clientPrompt;
    }

    const globalPrompt = systemConfig.systemPromptOverride?.trim();
    if (globalPrompt) {
      return globalPrompt;
    }

    return DEFAULT_TRY_ON_PROMPT;
  }, [selectedClient?.generationPromptBase, systemConfig.systemPromptOverride]);

  const promptSourceLabel = useMemo(() => {
    if (selectedClient?.generationPromptBase?.trim()) {
      return `el cliente ${selectedClient.name}`;
    }

    if (systemConfig.systemPromptOverride?.trim()) {
      return 'la configuración global';
    }

    return 'el prompt interno por defecto';
  }, [selectedClient?.generationPromptBase, selectedClient?.name, systemConfig.systemPromptOverride]);

  useEffect(() => {
    if (isPromptDirty) {
      return;
    }

    setState((current) => (
      current.prompt === resolvedPromptBase
        ? current
        : { ...current, prompt: resolvedPromptBase }
    ));
  }, [isPromptDirty, resolvedPromptBase]);

  const error = flowError ?? catalogError;

  useEffect(() => {
    garmentUrlsRef.current = state.garments;
  }, [state.garments]);

  useEffect(() => {
    if (previousStepRef.current !== state.step) {
      stepperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      previousStepRef.current = state.step;
    }
  }, [state.step]);

  useEffect(
    () => () => {
      revokeGarmentUrls(garmentUrlsRef.current);
    },
    [],
  );

  const totalJobs = useMemo(() => {
    const compatiblePairCount = countCompatiblePoseMatchesForGarments(
      selectedModel?.poses || [],
      state.garments.map((garment) => ({
        availableViews: getGarmentAvailableViews(garment),
      })),
      state.selectedPoseIds,
    );

    return getGenerateWizardTotalJobs(state, compatiblePairCount);
  }, [selectedModel?.poses, state]);
  const uploadSummary = useMemo(() => buildGarmentUploadSummary(state.garments), [state.garments]);
  const allPosesSelected = useMemo(
    () =>
      Boolean(
        selectedModel &&
          selectedModel.poses.length > 0 &&
          selectedModel.poses.every((pose) => state.selectedPoseIds.includes(pose.id)),
      ),
    [selectedModel, state.selectedPoseIds],
  );
  const canAdvance = useMemo(() => getGenerateWizardCanAdvance(state), [state]);
  const suggestionSignature = useMemo(
    () => buildGarmentSuggestionSignature(state.selectedModelId, state.garments),
    [state.selectedModelId, state.garments],
  );
  const missingPoseClassificationCount = useMemo(
    () =>
      selectedModel
        ? selectedModel.poses.filter((pose) => (pose.aiClassification?.usableForGarmentViews || []).length === 0).length
        : 0,
    [selectedModel],
  );

  const submit = useGenerateWizardSubmit({
    state,
    draftBatchId,
    totalJobs,
    uploadSummary,
    setState,
    setFlowError,
    setDraftBatchId,
  });

  const canSelectStep = (targetStep: number) =>
    canSelectWizardStep({
      targetStep,
      currentStep: state.step,
      maxStep: GENERATE_WIZARD_MAX_STEP,
      isBusy: submit.isSubmitting || state.poseSuggestions.status === 'preparing',
      isStepComplete: (stepId) => isGenerateWizardStepComplete(state, stepId),
    });

  const goToStep = (targetStep: number) => {
    setState((current) => {
      const nextStep = clampWizardStep(targetStep, 1, GENERATE_WIZARD_MAX_STEP) as GenerateWizardStepId;
      if (nextStep === current.step) {
        return current;
      }
      return { ...current, step: nextStep };
    });
  };

  const handleStepSelect = (targetStep: number) => {
    if (!canSelectStep(targetStep)) {
      return;
    }
    setState((current) => ({
      ...current,
      step: clampWizardStep(targetStep, 1, GENERATE_WIZARD_MAX_STEP) as GenerateWizardStepId,
    }));
  };

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
      const garmentsNeedingClassification = uploadedGarments.filter(
        (garment) =>
          garment.originalPhotos.length > 1
          && garment.originalPhotos.some((photo) => photo.classification.status !== 'classified'),
      );

      let preparedGarments = uploadedGarments;

      if (garmentsNeedingClassification.length > 0) {
        const garmentIds = new Set(garmentsNeedingClassification.map((garment) => garment.id));
        setState((current) => ({
          ...current,
          garments: markGarmentsAsClassifying(current.garments, garmentIds),
        }));

        const classificationResult = await classifyGarmentViewsWithGemini({
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

  const handleFiles = async (files: File[]) => {
    try {
      const nextGarments = await handleGarmentFiles(files, state.garments);
      setState((current) => ({
        ...current,
        garments: nextGarments,
        selectedPoseIds: [],
        poseSuggestions: createInitialPoseSuggestionState(),
      }));
      setFlowError(null);
    } catch (uploadError: any) {
      console.error(uploadError);
      setFlowError(uploadError.message || 'No se pudieron preparar las prendas.');
    }
  };

  const removeGarment = (garmentId: string) => {
    const garmentToRemove = state.garments.find((item) => item.id === garmentId);
    if (garmentToRemove) {
      void Promise.allSettled(
        garmentToRemove.originalPhotos
          .map((photo) => photo.upload.storagePath)
          .filter((value): value is string => Boolean(value))
          .map((storagePath) => deleteGarmentDraftByStoragePath(storagePath)),
      );
    }

    if (state.garments.length === 1 && state.garments[0]?.id === garmentId) {
      setDraftBatchId(null);
      submit.resetDraftBatch();
    }

    setState((current) => {
      const garment = current.garments.find((item) => item.id === garmentId);
      if (garment) {
        revokeGarmentUrls([garment]);
      }
      return {
        ...current,
        garments: current.garments.filter((item) => item.id !== garmentId),
        selectedPoseIds: [],
        poseSuggestions: createInitialPoseSuggestionState(),
      };
    });
  };

  const handleClientChange = (clientId: string | null) => {
    const nextClient = clients.find((client) => client.id === clientId) ?? null;
    const nextPrompt =
      nextClient?.generationPromptBase?.trim()
      || systemConfig.systemPromptOverride?.trim()
      || DEFAULT_TRY_ON_PROMPT;

    setIsPromptDirty(false);
    setState((current) => ({
      ...current,
      selectedClientId: clientId,
      selectedModelId: null,
      selectedPoseIds: [],
      poseSuggestions: createInitialPoseSuggestionState(),
      prompt: nextPrompt,
    }));
  };

  const handleModelSelect = (modelId: string | null) => {
    setState((current) => ({
      ...current,
      selectedModelId: modelId,
      selectedPoseIds: [],
      poseSuggestions: createInitialPoseSuggestionState(),
    }));
  };

  const handlePoseToggle = (poseId: string) => {
    setState((current) => ({
      ...current,
      selectedPoseIds: current.selectedPoseIds.includes(poseId)
        ? current.selectedPoseIds.filter((id) => id !== poseId)
        : [...current.selectedPoseIds, poseId],
    }));
  };

  const handleToggleAllPoses = () => {
    if (!selectedModel) {
      return;
    }
    setState((current) => ({
      ...current,
      selectedPoseIds: allPosesSelected ? [] : selectedModel.poses.map((pose) => pose.id),
    }));
  };

  const handleProviderChange = (provider: WizardState['provider']) => {
    setState((current) => ({ ...current, provider }));
  };

  const handleProviderImageConfigChange = (imageConfig: WizardProviderImageConfig) => {
    setState((current) => ({
      ...current,
      providerImageConfigs: {
        ...current.providerImageConfigs,
        [imageConfig.provider]: imageConfig,
      },
    }));
  };

  const handlePromptChange = (prompt: string) => {
    setIsPromptDirty(true);
    setState((current) => ({ ...current, prompt }));
  };

  const handleRetryPoseSuggestions = () => {
    setFlowError(null);
    setState((current) => ({
      ...current,
      poseSuggestions: {
        ...createInitialPoseSuggestionState(),
      },
    }));
  };

  return {
    state,
    clients,
    models,
    loadingData,
    isSubmitting: submit.isSubmitting,
    error,
    stepperRef,
    selectedModel,
    allPosesSelected,
    canAdvance,
    totalJobs,
    uploadSummary,
    promptSourceLabel,
    submitButtonLabel: submit.submitButtonLabel,
    disabledProviders: systemConfig.disabledProviders,
    goToStep,
    handleStepSelect,
    canSelectStep,
    handleFiles,
    removeGarment,
    handleSubmit: submit.handleSubmit,
    handleClientChange,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleProviderChange,
    handleProviderImageConfigChange,
    handlePromptChange,
    handleRetryPoseSuggestions,
  };
};
