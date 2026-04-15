import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_TRY_ON_PROMPT } from '../../../../../shared/src/domain';
import { useSystemConfig } from '../../../system/useSystemConfig';
import { buildGarmentSuggestionSignature, getGarmentAvailableViews, handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { deleteGarmentDraftByStoragePath, uploadWizardSourceSpreadsheet } from '../../storage';
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
import { useGarmentPreparation } from './useGarmentPreparation';
import { countCompatiblePoseMatchesForGarments, getSuggestedPoseIdsForGarments } from './garmentClassification';
import {
  replaceWizardProductDraftRows,
  resetWizardGeneratedOutputs,
  resetWizardProductDraftPreparation,
  resetWizardProductDrafts,
} from '../stateTransitions';
import {
  buildGarmentUploadSummary,
  createInitialGenerateWizardState,
  GENERATE_WIZARD_MAX_STEP,
  getGenerateWizardCanAdvance,
  getGenerateWizardLastAccessibleStep,
  getGenerateWizardTotalJobs,
  isGenerateWizardStepComplete,
} from '../state';

const resolvePromptBase = (
  clientPromptBase: string | null | undefined,
  systemPromptOverride: string | null | undefined,
): string => {
  const clientPrompt = clientPromptBase?.trim();
  if (clientPrompt) {
    return clientPrompt;
  }

  const globalPrompt = systemPromptOverride?.trim();
  if (globalPrompt) {
    return globalPrompt;
  }

  return DEFAULT_TRY_ON_PROMPT;
};

const resolvePromptSourceLabel = (
  clientName: string | undefined,
  clientPromptBase: string | null | undefined,
  systemPromptOverride: string | null | undefined,
): string => {
  if (clientPromptBase?.trim() && clientName) {
    return `el cliente ${clientName}`;
  }

  if (systemPromptOverride?.trim()) {
    return 'la configuración global';
  }

  return 'el prompt interno por defecto';
};

const buildProductDraftSignature = (state: WizardState): string =>
  JSON.stringify({
    outputMode: state.outputMode,
    clientId: state.selectedClientId,
    modelId: state.selectedModelId,
    templateId: state.selectedSpreadsheetTemplateId,
    categoryId: state.selectedSpreadsheetCategoryId,
    sourceSpreadsheetStoragePath: state.sourceSpreadsheet?.storagePath || null,
    garments: state.garments.map((garment) => ({
      id: garment.id,
      photos: garment.originalPhotos.map((photo) => ({
        id: photo.id,
        storagePath: photo.upload.storagePath,
      })),
    })),
  });

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message
    ? error.message
    : fallback;

const getStepFromSearchParams = (searchParams: URLSearchParams): GenerateWizardStepId => {
  const rawStep = Number(searchParams.get('step'));

  if (!Number.isInteger(rawStep)) {
    return 1;
  }

  return clampWizardStep(rawStep, 1, GENERATE_WIZARD_MAX_STEP) as GenerateWizardStepId;
};

export const useGenerateWizard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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
    selectedClientHasSpreadsheetTemplates,
    loadingSpreadsheetTemplates,
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
    return resolvePromptBase(selectedClient?.generationPromptBase, systemConfig.systemPromptOverride);
  }, [selectedClient?.generationPromptBase, systemConfig.systemPromptOverride]);

  const promptSourceLabel = useMemo(() => {
    return resolvePromptSourceLabel(
      selectedClient?.name,
      selectedClient?.generationPromptBase,
      systemConfig.systemPromptOverride,
    );
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

  useEffect(() => {
    if (!state.selectedClientId || loadingSpreadsheetTemplates || selectedClientHasSpreadsheetTemplates) {
      return;
    }

    setState((current) => {
      if (current.outputMode === 'photos_only') {
        return current;
      }

      return resetWizardProductDrafts({
        ...current,
        outputMode: 'photos_only',
        selectedSpreadsheetTemplateId: null,
        selectedSpreadsheetCategoryId: null,
      });
    });
  }, [loadingSpreadsheetTemplates, selectedClientHasSpreadsheetTemplates, state.selectedClientId]);

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
    const garmentsForMatching = state.garments.map((garment) => ({
      availableViews: getGarmentAvailableViews(garment),
      garmentBodyArea: garment.garmentBodyArea ?? null,
    }));
    const compatiblePairCount = countCompatiblePoseMatchesForGarments(
      selectedModel?.poses || [],
      garmentsForMatching,
      state.selectedPoseIds,
    );

    return getGenerateWizardTotalJobs(state, compatiblePairCount);
  }, [selectedModel?.poses, state]);

  const compatiblePoseIds = useMemo(
    () =>
      getSuggestedPoseIdsForGarments(
        selectedModel?.poses || [],
        state.garments.map((garment) => ({
          availableViews: getGarmentAvailableViews(garment),
          garmentBodyArea: garment.garmentBodyArea ?? null,
        })),
      ),
    [selectedModel?.poses, state.garments],
  );

  const compatiblePoseIdSet = useMemo(() => new Set(compatiblePoseIds), [compatiblePoseIds]);

  const uploadSummary = useMemo(() => buildGarmentUploadSummary(state.garments), [state.garments]);
  const allPosesSelected = useMemo(
    () =>
      Boolean(
        compatiblePoseIds.length > 0 &&
          compatiblePoseIds.every((poseId) => state.selectedPoseIds.includes(poseId)),
      ),
    [compatiblePoseIds, state.selectedPoseIds],
  );
  const canAdvance = useMemo(() => getGenerateWizardCanAdvance(state), [state]);
  const lastAccessibleStep = useMemo(() => getGenerateWizardLastAccessibleStep(state), [state]);
  const suggestionSignature = useMemo(
    () => buildGarmentSuggestionSignature(state.selectedModelId, state.garments),
    [state.selectedModelId, state.garments],
  );
  const productDraftSignature = useMemo(() => buildProductDraftSignature(state), [state]);

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

  const syncStepToUrl = (targetStep: GenerateWizardStepId, replace = false) => {
    const currentUrlStep = searchParams.get('step');
    if (currentUrlStep === String(targetStep)) {
      return;
    }

    setSearchParams((currentSearchParams) => {
      const nextSearchParams = new URLSearchParams(currentSearchParams);
      nextSearchParams.set('step', String(targetStep));
      return nextSearchParams;
    }, { replace });
  };

  const updateStep = (targetStep: number, replaceHistory = false) => {
    const nextStep = clampWizardStep(targetStep, 1, GENERATE_WIZARD_MAX_STEP) as GenerateWizardStepId;

    setState((current) => {
      if (nextStep === current.step) {
        return current;
      }

      return { ...current, step: nextStep };
    });

    syncStepToUrl(nextStep, replaceHistory);
  };

  const handleStepSelect = (targetStep: number) => {
    if (!canSelectStep(targetStep)) {
      return;
    }
    updateStep(targetStep);
  };

  const goToStep = (targetStep: number) => {
    updateStep(targetStep);
  };

  useEffect(() => {
    if (!searchParams.has('step')) {
      syncStepToUrl(state.step, true);
      return;
    }

    const requestedStep = getStepFromSearchParams(searchParams);
    const normalizedStep = canSelectStep(requestedStep) ? requestedStep : lastAccessibleStep;
    const currentUrlStep = searchParams.get('step');

    if (currentUrlStep !== String(normalizedStep)) {
      syncStepToUrl(normalizedStep, true);
    }

    if (normalizedStep !== state.step) {
      setState((current) => (
        current.step === normalizedStep
          ? current
          : { ...current, step: normalizedStep }
      ));
    }
  }, [canSelectStep, lastAccessibleStep, searchParams, state.step]);

  useEffect(() => {
    if (state.step > lastAccessibleStep) {
      updateStep(lastAccessibleStep, true);
    }
  }, [lastAccessibleStep, state.step]);

  const handleFiles = async (files: File[]) => {
    try {
      const nextGarments = await handleGarmentFiles(files, state.garments);
      setState((current) => resetWizardGeneratedOutputs({
        ...current,
        garments: nextGarments,
      }));
      setFlowError(null);
    } catch (uploadError) {
      console.error(uploadError);
      setFlowError(getErrorMessage(uploadError, 'No se pudieron preparar las prendas.'));
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
      return resetWizardGeneratedOutputs({
        ...current,
        garments: current.garments.filter((item) => item.id !== garmentId),
      });
    });
  };

  const handleClientChange = (clientId: string | null) => {
    const nextClient = clients.find((client) => client.id === clientId) ?? null;
    const nextPrompt = resolvePromptBase(nextClient?.generationPromptBase, systemConfig.systemPromptOverride);
    const previousSourceSpreadsheetPath = state.sourceSpreadsheet?.storagePath || null;

    if (previousSourceSpreadsheetPath) {
      void deleteGarmentDraftByStoragePath(previousSourceSpreadsheetPath);
    }

    setIsPromptDirty(false);
    setState((current) => resetWizardGeneratedOutputs({
      ...current,
      selectedClientId: clientId,
      selectedModelId: null,
      outputModeChosen: false,
      selectedSpreadsheetTemplateId: null,
      selectedSpreadsheetCategoryId: null,
      sourceSpreadsheet: null,
      prompt: nextPrompt,
    }));
  };

  const handleModelSelect = (modelId: string | null) => {
    setState((current) => resetWizardGeneratedOutputs({
      ...current,
      selectedModelId: modelId,
    }));
  };

  const handleOutputModeChange = (outputMode: WizardState['outputMode']) => {
    if (outputMode === 'spreadsheet' && !selectedClientHasSpreadsheetTemplates) {
      return;
    }

    setState((current) => resetWizardProductDrafts({
      ...current,
      outputMode,
      outputModeChosen: true,
      selectedSpreadsheetTemplateId: outputMode === 'spreadsheet' ? current.selectedSpreadsheetTemplateId : null,
      selectedSpreadsheetCategoryId: outputMode === 'spreadsheet' ? current.selectedSpreadsheetCategoryId : null,
    }));
  };

  const handleSpreadsheetTemplateChange = (templateId: string | null) => {
    const nextTemplate = spreadsheetTemplates.find((template) => template.id === templateId) ?? null;
    setState((current) => resetWizardProductDrafts({
      ...current,
      selectedSpreadsheetTemplateId: templateId,
      selectedSpreadsheetCategoryId: nextTemplate?.defaultCategoryId ?? null,
    }));
  };

  const handleSpreadsheetCategoryChange = (categoryId: string | null) => {
    setState((current) => resetWizardProductDrafts({
      ...current,
      selectedSpreadsheetCategoryId: categoryId,
    }));
  };

  const handleSourceSpreadsheetFile = async (file: File | null) => {
    const previousStoragePath = state.sourceSpreadsheet?.storagePath || null;

    if (!file) {
      if (previousStoragePath) {
        void deleteGarmentDraftByStoragePath(previousStoragePath);
      }
      setState((current) => resetWizardProductDrafts({
        ...current,
        sourceSpreadsheet: null,
      }));
      setFlowError(null);
      return;
    }

    setFlowError(null);
    setState((current) => resetWizardProductDrafts({
      ...current,
      sourceSpreadsheet: {
        originalFileName: file.name,
        storagePath: null,
        status: 'uploading',
        error: null,
      },
    }));

    try {
      const uploaded = await uploadWizardSourceSpreadsheet(file);

      if (previousStoragePath) {
        void deleteGarmentDraftByStoragePath(previousStoragePath);
      }

      setState((current) => resetWizardProductDrafts({
        ...current,
        sourceSpreadsheet: {
          originalFileName: uploaded.originalFileName,
          storagePath: uploaded.storagePath,
          status: 'uploaded',
          error: null,
        },
      }));
    } catch (uploadError) {
      const message = getErrorMessage(uploadError, 'No se pudo subir el spreadsheet fuente.');
      setState((current) => resetWizardProductDrafts({
        ...current,
        sourceSpreadsheet: {
          originalFileName: file.name,
          storagePath: null,
          status: 'failed',
          error: message,
        },
      }));
      setFlowError(message);
    }
  };

  const handlePoseToggle = (poseId: string) => {
    if (!compatiblePoseIdSet.has(poseId)) {
      return;
    }

    setState((current) => ({
      ...current,
      selectedPoseIds: current.selectedPoseIds.includes(poseId)
        ? current.selectedPoseIds.filter((id) => id !== poseId)
        : [...current.selectedPoseIds, poseId],
    }));
  };

  const handleToggleAllPoses = () => {
    if (compatiblePoseIds.length === 0) {
      return;
    }

    setState((current) => ({
      ...current,
      selectedPoseIds: compatiblePoseIds.every((poseId) => current.selectedPoseIds.includes(poseId))
        ? current.selectedPoseIds.filter((poseId) => !compatiblePoseIdSet.has(poseId))
        : [...new Set([...current.selectedPoseIds, ...compatiblePoseIds])],
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
    setState((current) => replaceWizardProductDraftRows(current, draft.garmentId, rows));
  };

  const handleRetryProductDraftPreparation = () => {
    setFlowError(null);
    setState((current) => resetWizardProductDraftPreparation(current));
  };

  return {
    state,
    clients,
    models,
    spreadsheetTemplates,
    spreadsheetCategories,
    selectedClientHasSpreadsheetTemplates,
    loadingSpreadsheetTemplates,
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
    compatiblePoseIds,
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
    handleSourceSpreadsheetFile,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleProviderChange,
    handleProviderImageConfigChange,
    handlePromptChange,
    handleRetryPoseSuggestions,
    handleRetryProductDraftPreparation,
    handleProductDraftRowsChange,
  };
};
