import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS, PROVIDER_VALUES } from '../../../shared/src/domain';
import { PROVIDER_COSTS, PROVIDER_PRICE_LABELS } from '../../../shared/src/constants/providerCosts';

interface ProviderSelectionProps {
  provider: Provider | null;
  onChange: (provider: Provider) => void;
  disabledProviders?: string[];
}

const PROVIDER_LOGOS: Partial<Record<Provider, { src: string; fallback: string; alt: string }>> = {
  'fal-seedream': {
    src: 'https://fal.ai/favicon.ico',
    fallback: 'FA',
    alt: 'Logo oficial de fal.ai',
  },
  'fal-banana-pro': {
    src: 'https://deepmind.google/favicon.ico',
    fallback: 'GM',
    alt: 'Logo oficial de Google DeepMind',
  },
  'fal-nano-banana-2': {
    src: 'https://deepmind.google/favicon.ico',
    fallback: 'GM',
    alt: 'Logo oficial de Google DeepMind',
  },
  'fal-seedream-5': {
    src: 'https://fal.ai/favicon.ico',
    fallback: 'FA',
    alt: 'Logo oficial de fal.ai',
  },
  'fal-gpt-image-2': {
    src: 'https://fal.ai/favicon.ico',
    fallback: 'FA',
    alt: 'Logo oficial de fal.ai',
  },
};

const VISIBLE_PROVIDERS = [...PROVIDER_VALUES].sort((left, right) => {
  const costDifference = PROVIDER_COSTS[left] - PROVIDER_COSTS[right];
  if (costDifference !== 0) {
    return costDifference;
  }

  return PROVIDER_LABELS[left].localeCompare(PROVIDER_LABELS[right]);
});

const ProviderLogo: React.FC<{ provider: Provider; selected: boolean; disabled: boolean }> = ({ provider, selected, disabled }) => {
  const [hasError, setHasError] = useState(false);
  const logo = PROVIDER_LOGOS[provider] ?? { src: 'https://fal.ai/favicon.ico', fallback: 'FA', alt: 'Logo de fal.ai' };

  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${
        disabled
          ? 'border-slate-200 bg-slate-100'
          : selected
            ? 'border-emerald-300/50 bg-emerald-500/15'
            : 'border-slate-200 bg-slate-50'
      }`}
      aria-hidden="true"
    >
      {hasError ? (
        <span className={`text-xs font-semibold tracking-[0.2em] ${
          disabled ? 'text-slate-400' : selected ? 'text-white' : 'text-slate-600'
        }`}>
          {logo.fallback}
        </span>
      ) : (
        <img
          src={logo.src}
          alt={logo.alt}
          className={`h-8 w-8 rounded-xl object-contain ${disabled ? 'opacity-45 grayscale' : ''}`}
          loading="lazy"
          onError={() => setHasError(true)}
        />
      )}
    </div>
  );
};

export const ProviderSelection: React.FC<ProviderSelectionProps> = ({ provider, onChange, disabledProviders }) => (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">Modelo</label>
    <div className="grid gap-3">
      {VISIBLE_PROVIDERS.map((option) => {
          const selected = provider !== null && provider === option;
          const disabled = Boolean(disabledProviders?.includes(option));

          return (
            <button
              type="button"
              key={option}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={`rounded-3xl border px-5 py-4 text-left transition ${
                disabled
                  ? selected
                    ? 'border-amber-200 bg-amber-50 text-slate-900'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                  : selected
                  ? 'border-emerald-700 bg-emerald-600 text-white shadow-lg shadow-emerald-900/10'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              } disabled:cursor-not-allowed`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <ProviderLogo provider={option} selected={selected} disabled={disabled} />
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{PROVIDER_LABELS[option]}</p>
                    <p className={`mt-1 text-sm font-medium ${
                      disabled ? 'text-slate-500' : selected ? 'text-emerald-100' : 'text-slate-500'
                    }`}>
                      {PROVIDER_PRICE_LABELS[option]}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {disabled ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      Deshabilitado
                    </span>
                  ) : null}
                  {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
                </div>
              </div>
            </button>
          );
        })}
    </div>
  </div>
);
