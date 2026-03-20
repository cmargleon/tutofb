import { Provider } from '../../../shared/src/types';
import { generateWithFalBananaPro, generateWithFalSeedream } from './fal';
import { generateWithOpenAI } from './openai';
import { ProviderRequest, ProviderResponse } from './types';

export interface ProviderSecrets {
  falKey?: string;
  openaiApiKey?: string;
}

export const generateWithProvider = async (
  provider: Provider,
  request: ProviderRequest,
  secrets: ProviderSecrets,
): Promise<ProviderResponse> => {
  switch (provider) {
    case 'fal-seedream':
      if (!secrets.falKey) {
        throw new Error('FAL_KEY no está configurada.');
      }
      return generateWithFalSeedream(request, secrets.falKey);
    case 'fal-banana-pro':
      if (!secrets.falKey) {
        throw new Error('FAL_KEY no está configurada.');
      }
      return generateWithFalBananaPro(request, secrets.falKey);
    case 'openai-gpt-image-1.5':
      if (!secrets.openaiApiKey) {
        throw new Error('OPENAI_API_KEY no está configurada.');
      }
      return generateWithOpenAI(request, secrets.openaiApiKey);
    default:
      throw new Error(`Proveedor no soportado: ${provider satisfies never}`);
  }
};
