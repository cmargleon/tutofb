import React from 'react';
import { Check } from 'lucide-react';
import { Provider } from '../../../shared/src/types';
import { ASPECT_RATIO_VALUES, PROVIDER_LABELS } from '../../../shared/src/domain';
import { GarmentUploadState, UploadedGarmentDraft, WizardState } from '../../features/generate/types';

const PROVIDER_DESCRIPTIONS: Record<Provider, string> = {
  'fal-seedream': 'Ruta equilibrada para lotes de catálogo consistentes.',
  'fal-banana-pro': 'Mayor fidelidad en edición cuando la prenda necesita ajuste fino.',
  'openai-gpt-image-1.5': 'Edición con OpenAI usando ambas referencias de imagen.',
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

const getUploadStatusCopy = (upload: GarmentUploadState): { label: string; tone: string; bar: string } => {
  switch (upload.status) {
    case 'queued':
      return { label: 'En cola', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-400' };
    case 'uploading':
      return { label: 'Subiendo', tone: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500' };
    case 'retrying':
      return { label: `Reintento ${Math.max(upload.attempts, 1)}`, tone: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' };
    case 'uploaded':
      return { label: 'Lista', tone: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' };
    case 'failed':
      return { label: 'Falló', tone: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' };
    case 'idle':
    default:
      return { label: 'Pendiente', tone: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' };
  }
};

interface UploadSummary {
  total: number;
  uploaded: number;
  failed: number;
  queued: number;
  inFlight: number;
  idle: number;
  started: number;
}

interface Props {
  state: WizardState;
  garments: UploadedGarmentDraft[];
  isSubmitting: boolean;
  totalJobs: number;
  uploadSummary: UploadSummary;
  experimentProviderError: string | null;
  experimentProviderOptions: { provider: Provider; label: string }[];
  submitButtonLabel: string;
  onToggleExperiment: () => void;
  onExperimentModeChange: (mode: 'ab_paired' | 'ab_interleaved') => void;
  onExperimentProviderChange: (index: number, provider: Provider) => void;
  onProviderChange: (provider: Provider) => void;
  onAspectRatioChange: (ratio: WizardState['aspectRatio']) => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
}

export const BatchStep: React.FC<Props> = ({
  state,
  garments,
  isSubmitting,
  totalJobs,
  uploadSummary,
  experimentProviderError,
  experimentProviderOptions,
  submitButtonLabel,
  onToggleExperiment,
  onExperimentModeChange,
  onExperimentProviderChange,
  onProviderChange,
  onAspectRatioChange,
  onPromptChange,
  onSubmit,
}) => (
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
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{uploadSummary.uploaded} listas</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
            {uploadSummary.inFlight + uploadSummary.queued} en proceso
          </span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">{uploadSummary.failed} con error</span>
        </div>
      </div>

      {garments.length > 0 ? (
        <div className="mt-4 space-y-2">
          {garments.map((garment) => {
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
            onClick={onToggleExperiment}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              state.experiment.enabled
                ? 'bg-emerald-600 text-white'
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
                    onClick={() => onExperimentModeChange(mode)}
                    className={`rounded-3xl border px-5 py-4 text-left transition ${
                      selected
                        ? 'border-emerald-700 bg-emerald-600 text-white'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{EXPERIMENT_MODE_COPY[mode].title}</span>
                      {selected ? <Check className="w-4 h-4" /> : null}
                    </div>
                    <p className={`mt-2 text-sm ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>
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
                    onChange={(event) => onExperimentProviderChange(index, event.target.value as Provider)}
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
                  onClick={() => onProviderChange(provider)}
                  className={`rounded-3xl border px-5 py-4 text-left transition ${
                    selected
                      ? 'border-emerald-700 bg-emerald-600 text-white shadow-lg shadow-emerald-900/10'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{PROVIDER_LABELS[provider]}</span>
                    {selected && <Check className="w-4 h-4" />}
                  </div>
                  <p className={`mt-2 text-sm ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>
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
            onClick={() => onAspectRatioChange(ratio)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              state.aspectRatio === ratio
                ? 'border-emerald-700 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="font-semibold">{ratio}</div>
            <div className={`mt-1 text-xs ${state.aspectRatio === ratio ? 'text-emerald-100' : 'text-slate-500'}`}>
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
        onChange={(event) => onPromptChange(event.target.value)}
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
      onClick={onSubmit}
      disabled={isSubmitting || totalJobs === 0 || Boolean(experimentProviderError)}
      className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitButtonLabel}
    </button>
  </div>
);
