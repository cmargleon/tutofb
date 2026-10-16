import { Provider } from '../../../shared/src/types';
import { ProviderGenerationError } from '../errors/jobFailure';
import { generateWithNewFalModel, generateWithFalBananaPro, generateWithFalGPTImage2, generateWithFalNanoBanana2, generateWithFalSeedream, generateWithFalSeedream5 } from './fal';
import { isNewFalProvider } from './falModels';
import { ProviderRequest, ProviderResponse } from './types';

export interface ProviderSecrets {
  falKey?: string;
}

export const generateWithProvider = async (
  provider: Provider,
  request: ProviderRequest,
  secrets: ProviderSecrets,
): Promise<ProviderResponse> => {
  if (isNewFalProvider(provider)) {
    if (!secrets.falKey) throw new ProviderGenerationError({ provider, reasonCode: 'provider_configuration_missing', retryable: false, message: 'FAL_KEY no está configurada.' });
    return generateWithNewFalModel(provider, request, secrets.falKey);
  }
  switch (provider) {
    case 'fal-seedream':
      if (!secrets.falKey) {
        throw new ProviderGenerationError({
          provider,
          reasonCode: 'provider_configuration_missing',
          retryable: false,
          message: 'FAL_KEY no está configurada.',
        });
      }
      return generateWithFalSeedream(request, secrets.falKey);
    case 'fal-banana-pro':
      if (!secrets.falKey) {
        throw new ProviderGenerationError({
          provider,
          reasonCode: 'provider_configuration_missing',
          retryable: false,
          message: 'FAL_KEY no está configurada.',
        });
      }
      return generateWithFalBananaPro(request, secrets.falKey);
    case 'openai-gpt-image-1.5':
      throw new Error('La generación directa con OpenAI fue retirada. Selecciona un modelo de fal.ai.');
    case 'fal-nano-banana-2':
      if (!secrets.falKey) {
        throw new ProviderGenerationError({
          provider,
          reasonCode: 'provider_configuration_missing',
          retryable: false,
          message: 'FAL_KEY no está configurada.',
        });
      }
      return generateWithFalNanoBanana2(request, secrets.falKey);
    case 'fal-seedream-5':
      if (!secrets.falKey) {
        throw new ProviderGenerationError({
          provider,
          reasonCode: 'provider_configuration_missing',
          retryable: false,
          message: 'FAL_KEY no está configurada.',
        });
      }
      return generateWithFalSeedream5(request, secrets.falKey);
    case 'fal-gpt-image-2':
      if (!secrets.falKey) {
        throw new ProviderGenerationError({
          provider,
          reasonCode: 'provider_configuration_missing',
          retryable: false,
          message: 'FAL_KEY no está configurada.',
        });
      }
      return generateWithFalGPTImage2(request, secrets.falKey);
    default:
      throw new Error(`Proveedor no soportado: ${provider satisfies never}`);
  }
};
