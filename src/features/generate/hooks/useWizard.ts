import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Client, Model, Provider } from '../../../../shared/src/types';
import {
  DEFAULT_TRY_ON_PROMPT,
  PROVIDER_LABELS,
  defaultBackgroundConfig,
  isActiveCatalogEntity,
  normalizeBackgroundConfig,
} from '../../../../shared/src/domain';
import { EXPERIMENT_ALLOWED_PROVIDERS } from '../../../../shared/src/experiments';
import { subscribeToClients } from '../../clients/firebase';
import { subscribeToModels } from '../../models/firebase';
import { createGenerationBatch } from '../firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../garments';
import { deleteGarmentDraftByStoragePath, uploadGarmentDrafts } from '../storage';
import { GarmentUploadState, UploadedGarmentDraft, WizardState } from '../types';

const isGarmentUploadedForBatch = (garment: UploadedGarmentDraft, draftBatchId: string | null): boolean =>
  Boolean(
    draftBatchId
    && garment.upload.status === 'uploaded'
    && garment.upload.storagePath
    && garment.upload.draftBatchId === draftBatchId,
  );

export const useWizard = () => {
  const navigate = useNavigate();
  const garmentUrlsRef = useRef<UploadedGarmentDraft[]>([]);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<number>(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<'idle' | 'uploading' | 'creating-batch'>('idle');
  const [draftBatchId, setDraftBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    step: 1,
    selectedClientId: null,
    selectedModelId: null,
    selectedPoseIds: [],
    garments: [],
    provider: 'fal-seedream',
    experiment: {
      enabled: false,
      mode: 'ab_paired',
      providers: [...EXPERIMENT_ALLOWED_PROVIDERS],
    },
    prompt: DEFAULT_TRY_ON_PROMPT,
    aspectRatio: '3:4',
    backgroundConfig: defaultBackgroundConfig,
  });

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

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (nextClients) => {
        setClients(nextClients.filter(isActiveCatalogEntity));
        setLoadingData(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los clientes.');
        setLoadingData(false);
      },
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!state.selectedClientId) {
      setModels([]);
      return;
    }
    const unsubscribe = subscribeToModels(
      (nextModels) => {
        setModels(nextModels.filter((model) => model.clientId === state.selectedClientId && isActiveCatalogEntity(model)));
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los modelos.');
      },
    );
    return () => unsubscribe();
  }, [state.selectedClientId]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === state.selectedModelId) ?? null,
    [models, state.selectedModelId],
  );

  const experimentMultiplier =
    state.experiment.enabled && state.experiment.mode === 'ab_paired' ? state.experiment.providers.length : 1;
  const totalJobs = state.selectedPoseIds.length * state.garments.length * experimentMultiplier;

  const uploadedGarmentCount = useMemo(
    () => state.garments.filter((garment) => isGarmentUploadedForBatch(garment, draftBatchId)).length,
    [draftBatchId, state.garments],
  );

  const uploadSummary = useMemo(
    () =>
      state.garments.reduce(
        (summary, garment) => {
          summary.total += 1;
          switch (garment.upload.status) {
            case 'uploaded': summary.uploaded += 1; break;
            case 'failed': summary.failed += 1; break;
            case 'queued': summary.queued += 1; break;
            case 'uploading':
            case 'retrying': summary.inFlight += 1; break;
            default: summary.idle += 1; break;
          }
          if (garment.upload.status !== 'idle') summary.started += 1;
          return summary;
        },
        { total: 0, uploaded: 0, failed: 0, queued: 0, inFlight: 0, idle: 0, started: 0 },
      ),
    [state.garments],
  );

  const allPosesSelected =
    selectedModel &&
    selectedModel.poses.length > 0 &&
    selectedModel.poses.every((pose) => state.selectedPoseIds.includes(pose.id));

  const canAdvance =
    (state.step === 1 && state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0) ||
    (state.step === 2 && state.garments.length > 0) ||
    state.step === 3;

  const experimentProviderOptions = EXPERIMENT_ALLOWED_PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
  }));

  const experimentProviderError = state.experiment.enabled
    ? (
        state.experiment.providers.length !== 2
        || new Set(state.experiment.providers).size !== 2
      )
      ? 'El experimento A/B necesita exactamente dos modelos distintos.'
      : null
    : null;

  const submitButtonLabel = useMemo(() => {
    if (!isSubmitting) {
      const garmentLabel = uploadedGarmentCount > 0 ? ` · ${uploadedGarmentCount}/${state.garments.length} prendas listas` : '';
      return `Crear lote y abrir evaluación (${totalJobs})${garmentLabel}`;
    }
    if (submitStage === 'uploading') {
      return `Subiendo prendas (${uploadSummary.uploaded}/${uploadSummary.total})`;
    }
    return 'Creando lote...';
  }, [isSubmitting, state.garments.length, submitStage, totalJobs, uploadSummary.total, uploadSummary.uploaded, uploadedGarmentCount]);

  const isStepComplete = (stepId: number) => {
    switch (stepId) {
      case 1: return Boolean(state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0);
      case 2: return state.garments.length > 0;
      case 3: return true;
      default: return false;
    }
  };

  const canSelectStep = (targetStep: number) => {
    if (isSubmitting && targetStep !== state.step) return false;
    if (targetStep <= state.step) return true;
    for (let stepId = 1; stepId < targetStep; stepId += 1) {
      if (!isStepComplete(stepId)) return false;
    }
    return true;
  };

  const handleStepSelect = (targetStep: number) => {
    if (!canSelectStep(targetStep)) return;
    setState((current) => ({ ...current, step: targetStep }));
  };

  const goToStep = (targetStep: number) => {
    setState((current) => {
      const nextStep = Math.min(3, Math.max(1, targetStep));
      if (nextStep === current.step) return current;
      return { ...current, step: nextStep };
    });
  };

  const patchGarmentUpload = (garmentId: string, patch: Partial<GarmentUploadState>) => {
    setState((current) => ({
      ...current,
      garments: current.garments.map((garment) =>
        garment.id === garmentId
          ? { ...garment, upload: { ...garment.upload, ...patch } }
          : garment,
      ),
    }));
  };

  const handleFiles = async (files: File[]) => {
    try {
      const nextGarments = await handleGarmentFiles(files, state.garments);
      setState((current) => ({ ...current, garments: nextGarments }));
      setError(null);
    } catch (uploadError: any) {
      console.error(uploadError);
      setError(uploadError.message || 'No se pudieron preparar las prendas.');
    }
  };

  const removeGarment = (garmentId: string) => {
    const garmentToRemove = state.garments.find((item) => item.id === garmentId);
    if (garmentToRemove?.upload.storagePath) {
      void deleteGarmentDraftByStoragePath(garmentToRemove.upload.storagePath);
    }
    if (state.garments.length === 1 && state.garments[0].id === garmentId) {
      setDraftBatchId(null);
    }
    setState((current) => {
      const garment = current.garments.find((item) => item.id === garmentId);
      if (garment) revokeGarmentUrls([garment]);
      return { ...current, garments: current.garments.filter((item) => item.id !== garmentId) };
    });
  };

  // Step 1 handlers
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
    if (!selectedModel) return;
    setState((current) => ({
      ...current,
      selectedPoseIds: allPosesSelected ? [] : selectedModel.poses.map((pose) => pose.id),
    }));
  };

  // Step 3 handlers
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
      setError('Completa cliente, modelo, poses y prendas antes de crear el lote.');
      return;
    }
    if (experimentProviderError) {
      setError(experimentProviderError);
      return;
    }

    setIsSubmitting(true);
    setSubmitStage('uploading');
    setError(null);
    const activeDraftBatchId = draftBatchId ?? crypto.randomUUID();
    if (!draftBatchId) setDraftBatchId(activeDraftBatchId);

    try {
      const garmentsToUpload = state.garments.filter((garment) => !isGarmentUploadedForBatch(garment, activeDraftBatchId));
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

      const uploadedById = new Map(uploadResult.uploaded.map((item) => [item.garmentId, item]));
      const failedById = new Map(uploadResult.failed.map((item) => [item.garmentId, item]));
      const nextGarments = state.garments.map((garment) => {
        const uploaded = uploadedById.get(garment.id);
        if (uploaded) {
          return {
            ...garment,
            upload: {
              ...garment.upload,
              status: 'uploaded' as const,
              progress: 100,
              attempts: uploaded.attempts,
              error: null,
              storagePath: uploaded.storagePath,
              draftBatchId: activeDraftBatchId,
            },
          };
        }
        const failed = failedById.get(garment.id);
        if (failed) {
          return {
            ...garment,
            upload: {
              ...garment.upload,
              status: 'failed' as const,
              attempts: failed.attempts,
              error: failed.error,
              storagePath: null,
              draftBatchId: activeDraftBatchId,
            },
          };
        }
        return garment;
      });

      if (uploadResult.uploaded.length > 0 || uploadResult.failed.length > 0) {
        setState((current) => ({
          ...current,
          garments: current.garments.map((garment) => {
            const nextGarment = nextGarments.find((candidate) => candidate.id === garment.id);
            return nextGarment ?? garment;
          }),
        }));
      }

      if (uploadResult.failed.length > 0) {
        const readyCount = nextGarments.filter((garment) => isGarmentUploadedForBatch(garment, activeDraftBatchId)).length;
        setError(
          readyCount > 0
            ? `Se subieron ${readyCount} prenda${readyCount === 1 ? '' : 's'}, pero ${uploadResult.failed.length} falló/fallaron. Puedes reintentar y solo se volverán a subir las pendientes.`
            : 'No se pudo completar la subida del lote. Puedes reintentar y las prendas exitosas quedarán recuperadas.',
        );
        return;
      }

      const uploadedGarments = nextGarments
        .filter((garment) => isGarmentUploadedForBatch(garment, activeDraftBatchId))
        .map((garment) => ({
          id: garment.id,
          name: garment.name,
          storagePath: garment.upload.storagePath!,
          isMultiAngle: garment.isMultiAngle,
          sourceType: garment.sourceType,
          originalFileNames: garment.originalFileNames,
        }));

      if (uploadedGarments.length === 0) {
        setError('No hay prendas listas para crear el lote.');
        return;
      }

      setSubmitStage('creating-batch');
      const result = await createGenerationBatch({
        clientId: state.selectedClientId,
        modelId: state.selectedModelId,
        poseIds: state.selectedPoseIds,
        garments: uploadedGarments,
        provider: state.provider,
        experiment: state.experiment.enabled
          ? { enabled: true, mode: state.experiment.mode, providers: state.experiment.providers }
          : null,
        promptBase: state.prompt,
        aspectRatio: state.aspectRatio,
        backgroundConfig: normalizeBackgroundConfig(state.backgroundConfig),
      });

      navigate(`/evaluacion?batchId=${result.batchId}`);
    } catch (submitError: any) {
      console.error(submitError);
      setError(
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
    experimentProviderOptions,
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
