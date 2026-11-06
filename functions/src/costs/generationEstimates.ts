import type { Provider, ProviderImageConfig } from '../../../shared/src/types';
import { getProviderCostUsd } from '../../../shared/src/constants/providerCosts';

// Rate-card values in the shared module are estimates, especially token-priced GPT models.
// Never describe these holds as a provider-enforced spending guarantee.
export const estimateGenerationHold = (provider: Provider, config: ProviderImageConfig, references: number) => {
  const estimate = getProviderCostUsd(provider, config, references);
  const fixed = ['fal-seedream', 'fal-banana-pro', 'fal-nano-banana-2', 'fal-seedream-5', 'fal-seedream-5-flash'].includes(provider);
  return { estimateUsd: estimate, holdUsd: fixed ? estimate : Math.max(0.5, estimate * 4), fixed };
};

export const GEMINI_OPERATION_HOLD_USD = 0.05;
