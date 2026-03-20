import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, FolderUp, ImagePlus, Layers3, UploadCloud, X } from 'lucide-react';
import { Client, Model, Provider } from '../../shared/src/types';
import {
  ASPECT_RATIO_VALUES,
  DEFAULT_TRY_ON_PROMPT,
  PROVIDER_LABELS,
  defaultBackgroundConfig,
  normalizeBackgroundConfig,
} from '../../shared/src/domain';
import { EmptyState, ImageThumb, LoadingBlock, PageHeader } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { subscribeToClients } from '../features/clients/firebase';
import { createGenerationBatch } from '../features/generate/firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../features/generate/garments';
import { uploadGarmentDraft, deleteGarmentDrafts } from '../features/generate/storage';
import { UploadedGarmentDraft, WizardState } from '../features/generate/types';
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

const batchLabel = (count: number): string =>
  `${count} trabajo${count === 1 ? '' : 's'} listo${count === 1 ? '' : 's'} para cola`;

export const Wizard: React.FC = () => {
  const navigate = useNavigate();
  const garmentUrlsRef = useRef<UploadedGarmentDraft[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    step: 1,
    selectedClientId: null,
    selectedModelId: null,
    selectedPoseIds: [],
    garments: [],
    provider: 'fal-seedream',
    prompt: DEFAULT_TRY_ON_PROMPT,
    aspectRatio: '3:4',
    backgroundConfig: defaultBackgroundConfig,
  });

  useEffect(() => {
    garmentUrlsRef.current = state.garments;
  }, [state.garments]);

  useEffect(
    () => () => {
      revokeGarmentUrls(garmentUrlsRef.current);
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (nextClients) => {
        setClients(nextClients);
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
        setModels(nextModels.filter((model) => model.clientId === state.selectedClientId));
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

  const totalJobs = state.selectedPoseIds.length * state.garments.length;
  const allPosesSelected =
    selectedModel &&
    selectedModel.poses.length > 0 &&
    selectedModel.poses.every((pose) => state.selectedPoseIds.includes(pose.id));

  const canAdvance =
    (state.step === 1 && state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0) ||
    (state.step === 2 && state.garments.length > 0) ||
    state.step === 3;

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

    setIsSubmitting(true);
    setError(null);
    const draftBatchId = crypto.randomUUID();
    const uploadedGarments: Array<{
      id: string;
      name: string;
      storagePath: string;
      isMultiAngle: boolean;
      sourceType: UploadedGarmentDraft['sourceType'];
      originalFileNames: string[];
    }> = [];

    try {
      for (const garment of state.garments) {
        const storagePath = await uploadGarmentDraft(draftBatchId, garment);
        uploadedGarments.push({
          id: garment.id,
          name: garment.name,
          storagePath,
          isMultiAngle: garment.isMultiAngle,
          sourceType: garment.sourceType,
          originalFileNames: garment.originalFileNames,
        });
      }

      const result = await createGenerationBatch({
        clientId: state.selectedClientId,
        modelId: state.selectedModelId,
        poseIds: state.selectedPoseIds,
        garments: uploadedGarments,
        provider: state.provider,
        promptBase: state.prompt,
        aspectRatio: state.aspectRatio,
        backgroundConfig: normalizeBackgroundConfig(state.backgroundConfig),
      });

      navigate(`/evaluacion?batchId=${result.batchId}`);
    } catch (submitError: any) {
      console.error(submitError);
      setError(submitError.message || 'No se pudo crear el lote.');
      await deleteGarmentDrafts(draftBatchId, state.garments);
    } finally {
      setIsSubmitting(false);
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
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition hover:border-slate-950 hover:bg-slate-50">
          <UploadCloud className="mb-3 h-8 w-8 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Archivos individuales</span>
          <span className="mt-1 text-sm text-slate-500">Cada imagen suelta entra como una prenda.</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async (event) => {
              const files = Array.from(event.target.files || []) as File[];
              await handleFiles(files);
              event.target.value = '';
            }}
          />
        </label>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition hover:border-slate-950 hover:bg-slate-50">
          <FolderUp className="mb-3 h-8 w-8 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Carpeta de prendas</span>
          <span className="mt-1 text-sm text-slate-500">
            Raíz suelta = una prenda multiángulo. Subcarpetas = una prenda por subcarpeta.
          </span>
          <input
            type="file"
            {...({ webkitdirectory: '', directory: '' } as any)}
            className="hidden"
            onChange={async (event) => {
              const files = Array.from(event.target.files || []) as File[];
              await handleFiles(files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Reglas de agrupado</h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">Archivo individual: una prenda.</div>
          <div className="rounded-2xl bg-slate-50 p-4">Carpeta raíz con imágenes sueltas: una prenda multiángulo.</div>
          <div className="rounded-2xl bg-slate-50 p-4">Carpeta con subcarpetas: cada subcarpeta es una prenda.</div>
          <div className="rounded-2xl bg-slate-50 p-4">Si hay subcarpetas, imágenes en raíz se vuelven prendas individuales.</div>
        </div>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderBatchStep = () => (
    <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
      <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
      </div>

      <div className="space-y-5 rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-xl shadow-slate-900/15">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Resumen del lote</p>
          <h2 className="mt-2 text-2xl font-semibold">{batchLabel(totalJobs)}</h2>
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Cliente: <strong>{clients.find((client) => client.id === state.selectedClientId)?.name || 'Sin seleccionar'}</strong>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Modelo: <strong>{selectedModel?.name || 'Sin seleccionar'}</strong>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Poses: <strong>{state.selectedPoseIds.length}</strong>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Prendas: <strong>{state.garments.length}</strong>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Proveedor: <strong>{PROVIDER_LABELS[state.provider]}</strong>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200">
            Fondo: <strong>Configuración normalizada oculta en UI</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || totalJobs === 0}
          className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Creando lote...' : `Crear lote y abrir evaluación (${totalJobs})`}
        </button>
      </div>
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
        <WizardStepper steps={STEPS} currentStep={state.step} />

        {state.step === 1 && renderClientModelStep()}
        {state.step === 2 && renderGarmentsStep()}
        {state.step === 3 && renderBatchStep()}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            disabled={state.step === 1}
            onClick={() => setState((current) => ({ ...current, step: Math.max(1, current.step - 1) }))}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Volver
          </button>

          {state.step < 3 && (
            <button
              type="button"
              disabled={!canAdvance}
              onClick={() => setState((current) => ({ ...current, step: Math.min(3, current.step + 1) }))}
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
