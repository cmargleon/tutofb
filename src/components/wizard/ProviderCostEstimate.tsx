import React from 'react';
import type { ProviderImageConfig } from '../../../shared/src/types';
import { getProviderCostEstimate, PROVIDER_PRICING_CHECKED_AT, PROVIDER_PRICING_SOURCES } from '../../../shared/src/constants/providerCosts';

const usd = (value: number) => `US$${value.toFixed(4)}`;

export const ProviderCostEstimate: React.FC<{
  config: ProviderImageConfig;
  imageCount: number;
  referenceCount: number;
}> = ({ config, imageCount, referenceCount }) => {
  const estimate = getProviderCostEstimate(config.provider, config, referenceCount);
  const count = Math.max(0, imageCount);
  const format = (multiplier: number) => estimate.maxUsd === null
    ? `desde ${usd(estimate.minUsd * multiplier)}`
    : estimate.minUsd !== estimate.maxUsd
      ? `≈ ${usd(estimate.minUsd * multiplier)}–${usd(estimate.maxUsd * multiplier)}`
      : `≈ ${usd(estimate.estimatedUsd * multiplier)}`;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" aria-live="polite" data-testid="provider-cost-estimate">
      <p className="font-semibold">{format(1)} por imagen · {count === 0 ? usd(0) : format(count)} por {count} imagen(es)</p>
      <p className="mt-1 text-xs text-slate-500">{referenceCount} referencia(s) por imagen. {estimate.note}</p>
      <p className="mt-1 text-xs text-slate-500">
        Solo generación; reintentos y revisiones adicionales no incluidos. Tarifas verificadas el {PROVIDER_PRICING_CHECKED_AT}.{' '}
        <a href={PROVIDER_PRICING_SOURCES[config.provider]} target="_blank" rel="noreferrer" className="underline">Ver fuente oficial</a>
      </p>
    </div>
  );
};
