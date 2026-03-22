import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Provider } from '../../../../../shared/src/types';
import { canSelectWizardStep, clampWizardStep } from '../../../wizard/navigation';
import { createGenerationBatch } from '../../firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { deleteGarmentDraftByStoragePath, uploadGarmentDrafts } from '../../storage';
import { GenerateSubmitStage, GenerateWizardStepId, UploadedGarmentDraft, WizardState } from '../../types';
import { useGenerateWizardCatalog } from './useGenerateWizardCatalog';
import {
  buildCreateGenerationBatchRequest,
  getUploadFailureMessage,
  getUploadedGarmentsForBatch,
  mergeGarmentUploadResults,
  patchGarmentUploadState,
} from '../submit';
import {
  buildGarmentUploadSummary,
  createInitialGenerateWizardState,
  GENERATE_WIZARD_EXPERIMENT_PROVIDER_OPTIONS,
  GENERATE_WIZARD_MAX_STEP,
  getGenerateWizardCanAdvance,
  getGenerateWizardExperimentProviderError,
  getGenerateWizardSubmitButtonLabel,
  getGenerateWizardTotalJobs,
  isGarmentUploadedForBatch,
  isGenerateWizardStepComplete,
} from '../state';

export const useGenerateWizard = () => {
  const navigate = useNavigate();
  const garmentUrlsRef = useRef<UploadedGarmentDraft[]>([]);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<GenerateWizardStepId>(1);
  const [state, setState] = useState<WizardState>(createInitialGenerateWizardState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<GenerateSubmitStage>('idle');
  const [draftBatchId, setDraftBatchId] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  const {
    clients,
    models,
    selectedModel,
    loadingData,
    error: catalogError,
  } = useGenerateWizardCatalog({
    selectedClientId: state.selectedClientId,
    selectedModelId: state.selectedModelId,
  });

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

  const totalJobs = useMemo(() => getGenerateWizardTotalJobs(state), [state]);
  const uploadSummary = useMemo(() => buildGarmentUploadSummary(state.garments), [state.garments]);
  const uploadedGarmentCount = useMemo(
    () => state.garments.filter((garment) => isGarmentUploadedForBatch(garment, draftBatchId)).length,
    [draftBatchId, state.garments],
  );
  const experimentProviderError = useMemo(
    () => getGenerateWizardExperimentProviderError(state),
    [state],
  );
  const allPosesSelected = useMemo(
    () =>
      Boolean(
        selectedModel
          && selectedModel.poses.length > 0
          && selectedModel.poses.every((pose) => state.selectedPoseIds.includes(pose.id)),
      ),
    [selectedModel, state.selectedPoseIds],
  );
  const canAdvance = useMemo(() => getGenerateWizardCanAdvance(state), [state]);
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

  const canSelectStep = (targetStep: number) =>
    canSelectWizardStep({
      targetStep,
      currentStep: state.step,
      maxStep: GENERATE_WIZARD_MAX_STEP,
      isBusy: isSubmitting,
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

    setState((current) => ({ ...current, step: clampWizardStep(targetStep, 1, GENERATE_WIZARD_MAX_STEP) as GenerateWizardStepId }));
  };

  const patchGarmentUpload = (garmentId: string, patch: Parameters<typeof patchGarmentUploadState>[2]) => {
    setState((current) => ({
      ...current,
      garments: patchGarmentUploadState(current.garments, garmentId, patch),
    }));
  };

  const handleFiles = async (files: File[]) => {
    try {
      const nextGarments = await handleGarmentFiles(files, state.garments);
      setState((current) => ({ ...current, garments: nextGarments }));
      setFlowError(null);
    } catch (uploadError: any) {
      console.error(uploadError);
      setFlowError(uploadError.message || 'No se pudieron preparar las prendas.');
    }
  };

  const removeGarment = (garmentId: string) => {
    const garmentToRemove = state.garments.find((item) => item.id === garmentId);
    if (garmentToRemove?.upload.storagePath) {
      void deleteGarmentDraftByStoragePath(garmentToRemove.upload.storagePath);
    }

    if (state.garments.length === 1 && state.garments[0]?.id === garmentId) {
      setDraftBatchId(null);
    }

    setState((current) => {
      const garment = current.garments.find((item) => item.id === garmentId);
      if (garment) {
        revokeGarmentUrls([garment]);
      }

      return {
        ...current,
        garments: current.garments.filter((item) => item.id !== garmentId),
      };
    });
  };

  const handleClientChange = (clientId: string | null) => {
    setState((current) => ({
      ...current,
      selectedClientId: clientId,
      selectedModelId: null,
      selectedPoseIds: [],
    }));
  };

  const handleModelSelect = (modelId: string | null) => {
    setState((current) => ({ ...current, selectedModelId: modelId, selectedPoseIds: [] }));
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

  const handleToggleExperiment = () => {
    setState((current) => ({
      ...current,
      experiment: { ...current.experiment, enabled: !current.experiment.enabled },
      provider: !current.experiment.enabled ? current.experiment.providers[0] : current.provider,
    }));
  };

  const handleExperimentModeChange = (mode: 'ab_paired' | 'ab_interleaved') => {
    setState((current) => ({ ...current, experiment: { ...current.experiment, mode } }));
  };

  const handleExperimentProviderChange = (index: number, provider: Provider) => {
    setState((current) => {
      const nextProviders = [...current.experiment.providers];
      nextProviders[index] = provider;

      return {
        ...current,
        provider: nextProviders[0],
        experiment: { ...current.experiment, providers: nextProviders },
      };
    });
  };

  const handleProviderChange = (provider: Provider) => {
    setState((current) => ({ ...current, provider }));
  };

  const handleAspectRatioChange = (aspectRatio: WizardState['aspectRatio']) => {
    setState((current) => ({ ...current, aspectRatio }));
  };

  const handlePromptChange = (prompt: string) => {
    setState((current) => ({ ...current, prompt }));
  };

  const handleSubmit = async () => {
    if (!state.selectedClientId || !state.selectedModelId || state.selectedPoseIds.length === 0 || state.garments.length === 0) {
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

      const uploadResult = garmentsToUpload.length > 0
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
        setState((current) => ({ ...current, garments: mergeGarmentUploadResults(current.garments, uploadResult, activeDraftBatchId) }));
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
      const result = await createGenerationBatch(
        buildCreateGenerationBatchRequest(state, uploadedGarments),
      );

      navigate(`/evaluacion?batchId=${result.batchId}`);
    } catch (submitError: any) {
      console.error(submitError);
      setFlowError(
        submitError.message
          || 'No se pudo crear el lote. Las prendas ya subidas quedaron listas para reintentar sin volver a cargarlas.',
      );
    } finally {
      setIsSubmitting(false);
      setSubmitStage('idle');
    }
  };

  return {
    state,
    clients,
    models,
    loadingData,
    isSubmitting,
    error,
    stepperRef,
    selectedModel,
    allPosesSelected,
    canAdvance,
    totalJobs,
    uploadSummary,
    experimentProviderError,
    experimentProviderOptions: GENERATE_WIZARD_EXPERIMENT_PROVIDER_OPTIONS,
    submitButtonLabel,
    goToStep,
    handleStepSelect,
    canSelectStep,
    handleFiles,
    removeGarment,
    handleSubmit,
    handleClientChange,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleToggleExperiment,
    handleExperimentModeChange,
    handleExperimentProviderChange,
    handleProviderChange,
    handleAspectRatioChange,
    handlePromptChange,
  };
};
