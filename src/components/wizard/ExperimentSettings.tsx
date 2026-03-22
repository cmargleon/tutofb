import React from 'react';
import { Check } from 'lucide-react';
import { Provider } from '../../../shared/src/types';
import { WizardExperimentState } from '../../features/generate/types';

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

interface ExperimentSettingsProps {
  experiment: WizardExperimentState;
  providerOptions: { provider: Provider; label: string }[];
  error: string | null;
  onToggle: () => void;
  onModeChange: (mode: 'ab_paired' | 'ab_interleaved') => void;
  onProviderChange: (index: number, provider: Provider) => void;
}

export const ExperimentSettings: React.FC<ExperimentSettingsProps> = ({
  experiment,
  providerOptions,
  error,
  onToggle,
  onModeChange,
  onProviderChange,
}) => (
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
        onClick={onToggle}
        className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
          experiment.enabled
            ? 'bg-emerald-600 text-white'
            : 'border border-slate-200 bg-white text-slate-700'
        }`}
      >
        {experiment.enabled ? 'Activo' : 'Desactivado'}
      </button>
    </div>

    {experiment.enabled ? (
      <div className="mt-5 space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          {(['ab_paired', 'ab_interleaved'] as const).map((mode) => {
            const selected = experiment.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                className={`rounded-3xl border px-5 py-4 text-left transition ${
                  selected
                    ? 'border-emerald-700 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{EXPERIMENT_MODE_COPY[mode].title}</span>
                  {selected ? <Check className="h-4 w-4" /> : null}
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
          {experiment.providers.map((provider, index) => (
            <div key={`experiment-provider-${index}`}>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Modelo {index === 0 ? 'A' : 'B'}
              </label>
              <select
                value={provider}
                onChange={(event) => onProviderChange(index, event.target.value as Provider)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
              >
                {providerOptions.map((option) => (
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

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    ) : null}
  </div>
);
