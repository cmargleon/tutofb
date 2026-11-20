import type { Provider, ProviderImageConfig } from '../../../shared/src/types';
import { getProviderCostUsd, getProviderCostEstimate } from '../../../shared/src/constants/providerCosts';

// Rate-card values in the shared module are estimates, especially token-priced GPT models.
// Never describe these holds as a provider-enforced spending guarantee.
export const estimateGenerationHold = (provider: Provider, config: ProviderImageConfig, references: number) => {
  const estimate = getProviderCostUsd(provider, config, references);
  const fixed = ['fal-seedream', 'fal-banana-pro', 'fal-nano-banana-2', 'fal-seedream-5', 'fal-seedream-5-flash'].includes(provider);
  // Fixed image rates need no token cushion. Variable rates reserve twice the selected
  // config/reference estimate; unpublished Xhigh/Max rates keep a larger 4x margin.
  // These remain estimates authorized by allowEstimatedCosts, never hard billing caps.
  const margin = fixed ? 1 : getProviderCostEstimate(provider, config, references).maxUsd === null ? 4 : 2;
  const holdUsd = Math.ceil(estimate * margin * 1_000_000) / 1_000_000;
  return { estimateUsd: estimate, holdUsd, fixed };
};

export const GEMINI_OPERATION_HOLD_USD = 0.05;
