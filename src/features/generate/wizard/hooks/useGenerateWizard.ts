import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TRY_ON_PROMPT } from '../../../../../shared/src/domain';
import { useSystemConfig } from '../../../system/useSystemConfig';
import { buildGarmentSuggestionSignature, getGarmentAvailableViews, handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { deleteGarmentDraftByStoragePath } from '../../storage';
import {
  GenerateWizardStepId,
  UploadedGarmentDraft,
  WizardProviderImageConfig,
  WizardState,
  createInitialProductDraftPreparationState,
  createInitialPoseSuggestionState,
} from '../../types';
import { canSelectWizardStep, clampWizardStep } from '../../../wizard/navigation';
import { useGenerateWizardCatalog } from './useGenerateWizardCatalog';
import { useGenerateWizardSubmit } from './useGenerateWizardSubmit';
import { useGarmentPreparation } from './useGarmentPreparation';
import { countCompatiblePoseMatchesForGarments } from './garmentClassification';
import {
  buildGarmentUploadSummary,
  createInitialGenerateWizardState,
  GENERATE_WIZARD_MAX_STEP,
  getGenerateWizardCanAdvance,
  getGenerateWizardTotalJobs,
  isGenerateWizardStepComplete,
} from '../state';

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
    spreadsheetTemplates,
    spreadsheetCategories,
    selectedClient,
    selectedModel,
    selectedSpreadsheetCategory,
    loadingData,
    error: catalogError,
  } = useGenerateWizardCatalog({
    selectedClientId: state.selectedClientId,
    selectedModelId: state.selectedModelId,
    outputMode: state.outputMode,
    selectedSpreadsheetTemplateId: state.selectedSpreadsheetTemplateId,
    selectedSpreadsheetCategoryId: state.selectedSpreadsheetCategoryId,
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

  const error = useMemo(() => {
    if (flowError) {
      return flowError;
    }

    if (
      state.outputMode === 'photos_only'
      && (
        catalogError === 'No se pudieron cargar los spreadsheets del cliente.'
        || catalogError === 'No se pudieron cargar las categorías del spreadsheet.'
      )
    ) {
      return null;
    }

    return catalogError;
  }, [catalogError, flowError, state.outputMode]);

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

  const missingPoseClassificationCount = useMemo(
    () =>
      selectedModel
        ? selectedModel.poses.filter((pose) => (pose.aiClassification?.usableForGarmentViews || []).length === 0).length
        : 0,
    [selectedModel],
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
  const productDraftSignature = useMemo(
    () =>
      JSON.stringify({
        outputMode: state.outputMode,
        clientId: state.selectedClientId,
        modelId: state.selectedModelId,
        templateId: state.selectedSpreadsheetTemplateId,
        categoryId: state.selectedSpreadsheetCategoryId,
        garments: state.garments.map((garment) => ({
          id: garment.id,
          photos: garment.originalPhotos.map((photo) => ({
            id: photo.id,
            storagePath: photo.upload.storagePath,
          })),
        })),
      }),
    [
      state.garments,
      state.outputMode,
      state.selectedClientId,
      state.selectedModelId,
      state.selectedSpreadsheetCategoryId,
      state.selectedSpreadsheetTemplateId,
    ],
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

  useGarmentPreparation({
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

  const handleFiles = async (files: File[]) => {
    try {
      const nextGarments = await handleGarmentFiles(files, state.garments);
      setState((current) => ({
        ...current,
        garments: nextGarments,
        selectedPoseIds: [],
        poseSuggestions: createInitialPoseSuggestionState(),
        productDrafts: [],
        productDraftPreparation: createInitialProductDraftPreparationState(),
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
        productDrafts: [],
        productDraftPreparation: createInitialProductDraftPreparationState(),
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
      selectedSpreadsheetTemplateId: null,
      selectedSpreadsheetCategoryId: null,
      selectedPoseIds: [],
      poseSuggestions: createInitialPoseSuggestionState(),
      productDrafts: [],
      productDraftPreparation: createInitialProductDraftPreparationState(),
      prompt: nextPrompt,
    }));
  };

  const handleModelSelect = (modelId: string | null) => {
    setState((current) => ({
      ...current,
      selectedModelId: modelId,
      selectedPoseIds: [],
      poseSuggestions: createInitialPoseSuggestionState(),
      productDrafts: [],
      productDraftPreparation: createInitialProductDraftPreparationState(),
    }));
  };

  const handleOutputModeChange = (outputMode: WizardState['outputMode']) => {
    setState((current) => ({
      ...current,
      outputMode,
      selectedSpreadsheetTemplateId: outputMode === 'spreadsheet' ? current.selectedSpreadsheetTemplateId : null,
      selectedSpreadsheetCategoryId: outputMode === 'spreadsheet' ? current.selectedSpreadsheetCategoryId : null,
      productDrafts: [],
      productDraftPreparation: createInitialProductDraftPreparationState(),
    }));
  };

  const handleSpreadsheetTemplateChange = (templateId: string | null) => {
    const nextTemplate = spreadsheetTemplates.find((template) => template.id === templateId) ?? null;
    setState((current) => ({
      ...current,
      selectedSpreadsheetTemplateId: templateId,
      selectedSpreadsheetCategoryId: nextTemplate?.defaultCategoryId ?? null,
      productDrafts: [],
      productDraftPreparation: createInitialProductDraftPreparationState(),
    }));
  };

  const handleSpreadsheetCategoryChange = (categoryId: string | null) => {
    setState((current) => ({
      ...current,
      selectedSpreadsheetCategoryId: categoryId,
      productDrafts: [],
      productDraftPreparation: createInitialProductDraftPreparationState(),
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

  const handleProductDraftRowsChange = (
    draft: WizardState['productDrafts'][number],
    rows: WizardState['productDrafts'][number]['rows'],
  ) => {
    setState((current) => ({
      ...current,
      productDrafts: current.productDrafts.map((entry) =>
        entry.garmentId === draft.garmentId
          ? { ...entry, rows }
          : entry,
      ),
    }));
  };

  return {
    state,
    clients,
    models,
    spreadsheetTemplates,
    spreadsheetCategories,
    loadingData,
    isSubmitting: submit.isSubmitting,
    error,
    stepperRef,
    selectedModel,
    selectedSpreadsheetCategory,
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
    handleOutputModeChange,
    handleSpreadsheetTemplateChange,
    handleSpreadsheetCategoryChange,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleProviderChange,
    handleProviderImageConfigChange,
    handlePromptChange,
    handleRetryPoseSuggestions,
    handleProductDraftRowsChange,
  };
};
