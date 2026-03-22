import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, FolderUp, ImagePlus, Layers3, UploadCloud, X } from 'lucide-react';
import { Client, Model, Provider } from '../../shared/src/types';
import {
  ASPECT_RATIO_VALUES,
  DEFAULT_TRY_ON_PROMPT,
  PROVIDER_LABELS,
  defaultBackgroundConfig,
  isActiveCatalogEntity,
  normalizeBackgroundConfig,
} from '../../shared/src/domain';
import { EXPERIMENT_ALLOWED_PROVIDERS } from '../../shared/src/experiments';
import { EmptyState, ImageThumb, LoadingBlock, PageHeader } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { subscribeToClients } from '../features/clients/firebase';
import { createGenerationBatch } from '../features/generate/firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../features/generate/garments';
import { deleteGarmentDraftByStoragePath, uploadGarmentDrafts } from '../features/generate/storage';
import { GarmentUploadState, UploadedGarmentDraft, WizardState } from '../features/generate/types';
import { subscribeToModels } from '../features/models/firebase';

const STEPS = [
  { id: 1, name: 'Cliente y modelo' },
  { id: 2, name: 'Prendas' },
  { id: 3, name: 'Lote' },
];

const PROVIDER_DESCRIPTIONS: Record<Provider, string> = {
  'fal-seedream': 'Ruta equilibrada para lotes de catálogo consistentes.',
  'fal-banana-pro': 'Mayor fidelidad en edición cuando la prenda necesita ajuste fino.',
  'openai-gpt-image-1.5': 'Edición con OpenAI usando ambas referencias y Storage privado.',
};

const ratioLabels: Record<(typeof ASPECT_RATIO_VALUES)[number], string> = {
  '9:16': 'Stories / Reels',
  '3:4': 'Catálogo vertical',
  '2:3': 'Portrait',
  '1:1': 'Cuadrado',
  '4:3': 'Landscape clásico',
  '3:2': 'Editorial horizontal',
  '16:9': 'Hero wide',
};

const EXPERIMENT_MODE_COPY = {
  ab_paired: {
    title: 'Paired',
    description: 'Cada combinación pose-prenda se genera con ambos modelos. Es la opción recomendada para comparar con justicia.',
  },
  ab_interleaved: {
    title: 'Interleaved',
    description: 'Alterna el modelo asignado entre combinaciones consecutivas. Cuesta menos, pero compara con más ruido.',
  },
} as const;

const isGarmentUploadedForBatch = (garment: UploadedGarmentDraft, draftBatchId: string | null): boolean =>
  Boolean(
    draftBatchId
    && garment.upload.status === 'uploaded'
    && garment.upload.storagePath
    && garment.upload.draftBatchId === draftBatchId,
  );

const getUploadStatusCopy = (upload: GarmentUploadState): { label: string; tone: string; bar: string } => {
  switch (upload.status) {
    case 'queued':
      return {
        label: 'En cola',
        tone: 'bg-slate-100 text-slate-600',
        bar: 'bg-slate-400',
      };
    case 'uploading':
      return {
        label: 'Subiendo',
        tone: 'bg-sky-100 text-sky-700',
        bar: 'bg-sky-500',
      };
    case 'retrying':
      return {
        label: `Reintento ${Math.max(upload.attempts, 1)}`,
        tone: 'bg-amber-100 text-amber-800',
        bar: 'bg-amber-500',
      };
    case 'uploaded':
      return {
        label: 'Lista',
        tone: 'bg-emerald-100 text-emerald-700',
        bar: 'bg-emerald-500',
      };
    case 'failed':
      return {
        label: 'Falló',
        tone: 'bg-rose-100 text-rose-700',
        bar: 'bg-rose-500',
      };
    case 'idle':
    default:
      return {
        label: 'Pendiente',
        tone: 'bg-slate-100 text-slate-600',
        bar: 'bg-slate-300',
      };
  }
};

export const Wizard: React.FC = () => {
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
  const totalComparableSets = state.selectedPoseIds.length * state.garments.length;
  const totalJobs = totalComparableSets * experimentMultiplier;
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
            case 'uploaded':
              summary.uploaded += 1;
              break;
            case 'failed':
              summary.failed += 1;
              break;
            case 'queued':
              summary.queued += 1;
              break;
            case 'uploading':
            case 'retrying':
              summary.inFlight += 1;
              break;
            default:
              summary.idle += 1;
              break;
          }

          if (garment.upload.status !== 'idle') {
            summary.started += 1;
          }

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
      case 1:
        return Boolean(state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0);
      case 2:
        return state.garments.length > 0;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const canSelectStep = (targetStep: number) => {
    if (isSubmitting && targetStep !== state.step) {
      return false;
    }

    if (targetStep <= state.step) {
      return true;
    }

    for (let stepId = 1; stepId < targetStep; stepId += 1) {
      if (!isStepComplete(stepId)) {
        return false;
      }
    }

    return true;
  };

  const handleStepSelect = (targetStep: number) => {
    if (!canSelectStep(targetStep)) {
      return;
    }

    setState((current) => ({ ...current, step: targetStep }));
  };

  const goToStep = (targetStep: number) => {
    setState((current) => {
      const nextStep = Math.min(3, Math.max(1, targetStep));
      if (nextStep === current.step) {
        return current;
      }

      return { ...current, step: nextStep };
    });
  };

  const patchGarmentUpload = (garmentId: string, patch: Partial<GarmentUploadState>) => {
    setState((current) => ({
      ...current,
      garments: current.garments.map((garment) =>
        garment.id === garmentId
          ? {
              ...garment,
              upload: {
                ...garment.upload,
                ...patch,
              },
            }
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
      if (garment) {
        revokeGarmentUrls([garment]);
      }
      return {
        ...current,
        garments: current.garments.filter((item) => item.id !== garmentId),
      };
    });
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
    if (!draftBatchId) {
      setDraftBatchId(activeDraftBatchId);
    }

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
              status: 'uploaded',
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
              status: 'failed',
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
          ? {
              enabled: true,
              mode: state.experiment.mode,
              providers: state.experiment.providers,
            }
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

  const renderClientModelStep = () => (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[280px,1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Cliente</label>
          <select
            value={state.selectedClientId || ''}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                selectedClientId: event.target.value || null,
                selectedModelId: null,
                selectedPoseIds: [],
              }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
          >
            <option value="">Selecciona un cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>

          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Primero se define la marca, luego el modelo y por último las poses que van al lote.
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Modelos del cliente</h2>
              <p className="text-sm text-slate-500">Selecciona un modelo y después las poses que entran al lote.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {models.length} modelo{models.length === 1 ? '' : 's'}
            </span>
          </div>

          {!state.selectedClientId ? (
            <EmptyState
              title="Primero elige un cliente"
              description="Cuando selecciones una marca aparecerán aquí sus modelos disponibles."
              icon={<Layers3 className="w-6 h-6" />}
            />
          ) : models.length === 0 ? (
            <EmptyState
              title="Este cliente aún no tiene modelos"
              description="Crea un modelo con poses antes de continuar con el lote."
              icon={<Layers3 className="w-6 h-6" />}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {models.map((model) => {
                const coverPath = model.coverPosePath || model.poses[0]?.storagePath;
                const isSelected = model.id === state.selectedModelId;
                return (
                  <button
                    type="button"
                    key={model.id}
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        selectedModelId: model.id || null,
                        selectedPoseIds: [],
                      }))
                    }
                    className={`overflow-hidden rounded-3xl border text-left transition ${
                      isSelected
                        ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-900/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="aspect-[4/3] bg-slate-100">
                      {coverPath ? (
                        <ImageThumb storagePath={coverPath} alt={model.name} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin preview</div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center justify-between">
                        <h3 className={`font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`}>{model.name}</h3>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            isSelected ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {model.poseCount} poses
                        </span>
                      </div>
                      <p className={`mt-2 text-sm ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {model.clientNameSnapshot}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedModel && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Poses del modelo</h2>
              <p className="text-sm text-slate-500">
                {state.selectedPoseIds.length} seleccionada{state.selectedPoseIds.length === 1 ? '' : 's'} de {selectedModel.poses.length}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  selectedPoseIds: allPosesSelected ? [] : selectedModel.poses.map((pose) => pose.id),
                }))
              }
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              {allPosesSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {selectedModel.poses.map((pose) => {
              const selected = state.selectedPoseIds.includes(pose.id);
              return (
                <button
                  type="button"
                  key={pose.id}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      selectedPoseIds: selected
                        ? current.selectedPoseIds.filter((poseId) => poseId !== pose.id)
                        : [...current.selectedPoseIds, pose.id],
                    }))
                  }
                  className={`relative overflow-hidden rounded-3xl border transition ${
                    selected ? 'border-slate-950 ring-2 ring-slate-950/10' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="aspect-[3/4] bg-slate-100">
                    <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                  </div>
                  <div className="flex items-center justify-between px-3 py-3 text-left">
                    <div>
                      <p className="text-sm font-medium text-slate-900 line-clamp-1">{pose.fileName}</p>
                      <p className="text-xs text-slate-500">Pose {pose.id.slice(0, 6)}</p>
                    </div>
                    {selected && (
                      <span className="rounded-full bg-slate-950 p-1 text-white">
                        <Check className="w-4 h-4" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderGarmentsStep = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
          isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
        }`}>
          <UploadCloud className="mb-3 h-8 w-8 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Archivos individuales</span>
          <span className="mt-1 text-sm text-slate-500">Cada imagen suelta entra como una prenda.</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={isSubmitting}
            className="hidden"
            onChange={async (event) => {
              const files = Array.from(event.target.files || []) as File[];
              await handleFiles(files);
              event.target.value = '';
            }}
          />
        </label>

        <label className={`flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition ${
          isSubmitting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-950 hover:bg-slate-50'
        }`}>
          <FolderUp className="mb-3 h-8 w-8 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Carpeta de prendas</span>
          <span className="mt-1 text-sm text-slate-500">
            Raíz suelta = una prenda multiángulo. Subcarpetas = una prenda por subcarpeta.
          </span>
          <input
            type="file"
            {...({ webkitdirectory: '', directory: '' } as any)}
            disabled={isSubmitting}
            className="hidden"
            onChange={async (event) => {
              const files = Array.from(event.target.files || []) as File[];
              await handleFiles(files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {state.garments.length === 0 ? (
        <EmptyState
          title="Todavía no hay prendas en el lote"
          description="Sube archivos sueltos o una carpeta para componer automáticamente las prendas del wizard."
          icon={<ImagePlus className="w-6 h-6" />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {state.garments.map((garment) => (
            <div key={garment.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative aspect-square bg-slate-100">
                <img src={garment.previewUrl} alt={garment.name} className="h-full w-full object-contain" />
                <button
                  type="button"
                  onClick={() => removeGarment(garment.id)}
                  disabled={isSubmitting}
                  className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm transition hover:bg-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{garment.name}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {garment.isMultiAngle ? 'Multiángulo' : 'Simple'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {garment.files.length} archivo{garment.files.length === 1 ? '' : 's'} · {garment.sourceType}
                </p>
                {garment.upload.status !== 'idle' ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={`rounded-full px-2.5 py-1 font-medium ${getUploadStatusCopy(garment.upload).tone}`}>
                        {getUploadStatusCopy(garment.upload).label}
                      </span>
                      <span className="font-medium text-slate-500">{Math.round(garment.upload.progress)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${getUploadStatusCopy(garment.upload).bar}`}
                        style={{ width: `${Math.max(garment.upload.progress, garment.upload.status === 'uploaded' ? 100 : 6)}%` }}
                      />
                    </div>
                    {garment.upload.error ? (
                      <p className="text-xs leading-relaxed text-rose-600">{garment.upload.error}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderBatchStep = () => (
    <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <label className="block text-sm font-medium text-slate-700">Estado de subida</label>
            <p className="mt-1 text-sm text-slate-500">
              Las prendas exitosas quedan guardadas y un reintento solo vuelve a subir las pendientes o fallidas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
              {uploadSummary.uploaded} listas
            </span>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-700">
              {uploadSummary.inFlight + uploadSummary.queued} en proceso
            </span>
            <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">
              {uploadSummary.failed} con error
            </span>
          </div>
        </div>

        {state.garments.length > 0 ? (
          <div className="mt-4 space-y-2">
            {state.garments.map((garment) => {
              const uploadCopy = getUploadStatusCopy(garment.upload);
              return (
                <div key={`upload-summary-${garment.id}`} className="rounded-2xl bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{garment.name}</p>
                      <p className="text-xs text-slate-500">
                        {Math.round(garment.upload.progress)}% · intento {Math.max(garment.upload.attempts, 1)}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${uploadCopy.tone}`}>
                      {uploadCopy.label}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${uploadCopy.bar}`}
                      style={{ width: `${Math.max(garment.upload.progress, garment.upload.status === 'uploaded' ? 100 : 4)}%` }}
                    />
                  </div>
                  {garment.upload.error ? (
                    <p className="mt-2 text-xs leading-relaxed text-rose-600">{garment.upload.error}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Experimento A/B</label>
                <p className="mt-1 text-sm text-slate-500">
                  Recomendado cuando quieres comparar eficiencia real entre modelos según regeneraciones, tiempo y costo.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    experiment: { ...current.experiment, enabled: !current.experiment.enabled },
                    provider: !current.experiment.enabled ? current.experiment.providers[0] : current.provider,
                  }))
                }
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  state.experiment.enabled
                    ? 'bg-slate-950 text-white'
                    : 'bg-white text-slate-700 border border-slate-200'
                }`}
              >
                {state.experiment.enabled ? 'Activo' : 'Desactivado'}
              </button>
            </div>

            {state.experiment.enabled ? (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 md:grid-cols-2">
                  {(['ab_paired', 'ab_interleaved'] as const).map((mode) => {
                    const selected = state.experiment.mode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            experiment: { ...current.experiment, mode },
                          }))
                        }
                        className={`rounded-3xl border px-5 py-4 text-left transition ${
                          selected
                            ? 'border-slate-950 bg-slate-950 text-white'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{EXPERIMENT_MODE_COPY[mode].title}</span>
                          {selected ? <Check className="w-4 h-4" /> : null}
                        </div>
                        <p className={`mt-2 text-sm ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                          {EXPERIMENT_MODE_COPY[mode].description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  Recomendación: usa <strong>Paired</strong> cuando el objetivo sea decidir qué modelo rinde mejor.{' '}
                  <strong>Interleaved</strong> cuesta menos, pero compara escenarios distintos.
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {state.experiment.providers.map((provider, index) => (
                    <div key={`experiment-provider-${index}`}>
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Modelo {index === 0 ? 'A' : 'B'}
                      </label>
                      <select
                        value={provider}
                        onChange={(event) =>
                          setState((current) => {
                            const nextProviders = [...current.experiment.providers];
                            nextProviders[index] = event.target.value as Provider;
                            return {
                              ...current,
                              provider: nextProviders[0],
                              experiment: {
                                ...current.experiment,
                                providers: nextProviders,
                              },
                            };
                          })
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                      >
                        {experimentProviderOptions.map((option) => (
                          <option key={option.provider} value={option.provider}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  `fal-banana-pro` queda fuera del experimento por costo. La estructura sí queda lista para sumar más modelos después.
                </div>

                {experimentProviderError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {experimentProviderError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {!state.experiment.enabled ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Proveedor</label>
              <div className="grid gap-3">
                {(Object.keys(PROVIDER_LABELS) as Provider[]).map((provider) => {
                  const selected = state.provider === provider;
                  return (
                    <button
                      type="button"
                      key={provider}
                      onClick={() => setState((current) => ({ ...current, provider }))}
                      className={`rounded-3xl border px-5 py-4 text-left transition ${
                        selected
                          ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-900/10'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{PROVIDER_LABELS[provider]}</span>
                        {selected && <Check className="w-4 h-4" />}
                      </div>
                      <p className={`mt-2 text-sm ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {PROVIDER_DESCRIPTIONS[provider]}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Relación de aspecto</label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ASPECT_RATIO_VALUES.map((ratio) => (
              <button
                type="button"
                key={ratio}
                onClick={() => setState((current) => ({ ...current, aspectRatio: ratio }))}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  state.aspectRatio === ratio
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold">{ratio}</div>
                <div className={`mt-1 text-xs ${state.aspectRatio === ratio ? 'text-slate-300' : 'text-slate-500'}`}>
                  {ratioLabels[ratio]}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Prompt base</label>
          <textarea
            value={state.prompt}
            onChange={(event) => setState((current) => ({ ...current, prompt: event.target.value }))}
            rows={5}
            className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
            placeholder="Describe la instrucción base del try-on"
          />
          <p className="mt-2 text-xs text-slate-500">
            Se combina con `backgroundConfig` normalizado y con una nota extra cuando la prenda es multiángulo.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || totalJobs === 0 || Boolean(experimentProviderError)}
          className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitButtonLabel}
        </button>
    </div>
  );

  if (loadingData) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Generar imágenes"
          description="Configura el lote usando cliente, modelo, prendas y proveedor antes de mandarlo al worker de Firebase."
        />
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Generar imágenes"
        description="Replica el flujo operativo del catálogo: eliges cliente y modelo, subes prendas con agrupado automático y generas un trabajo por cada combinación pose-prenda."
      />

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div ref={stepperRef}>
        <WizardStepper
          steps={STEPS}
          currentStep={state.step}
          onStepSelect={handleStepSelect}
          canSelectStep={canSelectStep}
        />
        </div>

        {state.step === 1 && renderClientModelStep()}
        {state.step === 2 && renderGarmentsStep()}
        {state.step === 3 && renderBatchStep()}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            disabled={state.step === 1 || isSubmitting}
            onClick={() => goToStep(state.step - 1)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Volver
          </button>

          {state.step < 3 && (
            <button
              type="button"
              disabled={!canAdvance || isSubmitting}
              onClick={() => goToStep(state.step + 1)}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
