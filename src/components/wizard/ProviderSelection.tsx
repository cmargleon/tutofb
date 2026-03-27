import React from 'react';
import { Check } from 'lucide-react';
import { Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS } from '../../../shared/src/domain';

const PROVIDER_DESCRIPTIONS: Record<Provider, string> = {
  'fal-seedream': 'Ruta equilibrada para lotes de catálogo consistentes.',
  'fal-banana-pro': 'Mayor fidelidad en edición cuando la prenda necesita ajuste fino.',
  'openai-gpt-image-1.5': 'Edición con OpenAI usando ambas referencias de imagen.',
};

interface ProviderSelectionProps {
  provider: Provider;
  onChange: (provider: Provider) => void;
  disabledProviders?: string[];
}

export const ProviderSelection: React.FC<ProviderSelectionProps> = ({ provider, onChange, disabledProviders }) => (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">Proveedor</label>
    <div className="grid gap-3">
      {(Object.keys(PROVIDER_LABELS) as Provider[]).filter((option) => !disabledProviders?.includes(option)).map((option) => {
        const selected = provider === option;
        return (
          <button
            type="button"
            key={option}
            onClick={() => onChange(option)}
            className={`rounded-3xl border px-5 py-4 text-left transition ${
              selected
                ? 'border-emerald-700 bg-emerald-600 text-white shadow-lg shadow-emerald-900/10'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{PROVIDER_LABELS[option]}</span>
              {selected ? <Check className="h-4 w-4" /> : null}
            </div>
            <p className={`mt-2 text-sm ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>
              {PROVIDER_DESCRIPTIONS[option]}
            </p>
          </button>
        );
      })}
    </div>
  </div>
);
