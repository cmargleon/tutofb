import { useEffect, useMemo, useRef, useState } from 'react';
import { Provider } from '../../../../../shared/src/types';
import { canSelectWizardStep, clampWizardStep } from '../../../wizard/navigation';
import { handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { deleteGarmentDraftByStoragePath } from '../../storage';
import { GenerateWizardStepId, UploadedGarmentDraft, WizardState } from '../../types';
import { useGenerateWizardCatalog } from './useGenerateWizardCatalog';
import { useGenerateWizardSubmit } from './useGenerateWizardSubmit';
import {
  buildGarmentUploadSummary,
  createInitialGenerateWizardState,
  GENERATE_WIZARD_EXPERIMENT_PROVIDER_OPTIONS,
  GENERATE_WIZARD_MAX_STEP,
  getGenerateWizardCanAdvance,
  getGenerateWizardExperimentProviderError,
  getGenerateWizardTotalJobs,
  isGenerateWizardStepComplete,
} from '../state';

export const useGenerateWizard = () => {
  const garmentUrlsRef = useRef<UploadedGarmentDraft[]>([]);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<GenerateWizardStepId>(1);
  const [state, setState] = useState<WizardState>(createInitialGenerateWizardState);
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
  const experimentProviderError = useMemo(
    () => getGenerateWizardExperimentProviderError(state),
    [state],
  );
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

  const submit = useGenerateWizardSubmit({
    state,
    experimentProviderError,
    totalJobs,
    uploadSummary,
    setState,
    setFlowError,
  });

  const canSelectStep = (targetStep: number) =>
    canSelectWizardStep({
      targetStep,
      currentStep: state.step,
      maxStep: GENERATE_WIZARD_MAX_STEP,
      isBusy: submit.isSubmitting,
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
    experimentProviderError,
    experimentProviderOptions: GENERATE_WIZARD_EXPERIMENT_PROVIDER_OPTIONS,
    submitButtonLabel: submit.submitButtonLabel,
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
    handleToggleExperiment,
    handleExperimentModeChange,
    handleExperimentProviderChange,
    handleProviderChange,
    handleAspectRatioChange,
    handlePromptChange,
  };
};
