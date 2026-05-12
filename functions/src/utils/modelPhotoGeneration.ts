import {
  FalBananaProImageConfig,
  FalGPTImage2ImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
  ModelPhotoProvider,
  OpenAIImageConfig,
  ProviderImageConfig,
} from '../../../shared/src/types';
import { mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import {
  editModelPhotoWithBananaPro,
  editModelPhotoWithFalGPTImage2,
  editModelPhotoWithNanoBanana2,
  editModelPhotoWithOpenAI,
  editModelPhotoWithSeedream5,
  editModelPhotoWithSeedreamV45,
  generateModelPhotoWithBananaPro,
  generateModelPhotoWithFalGPTImage2,
  generateModelPhotoWithNanoBanana2,
  generateModelPhotoWithOpenAI,
  generateModelPhotoWithSeedream5,
  generateModelPhotoWithSeedreamV45,
  TextToImageResult,
} from '../providers/textToImage';

const OPENAI_RATE_LIMIT_MAX_RETRIES = 5;
const DEFAULT_OPENAI_RATE_LIMIT_DELAY_MS = 15_000;

export { mapModelPhotoProviderToProvider };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isOpenAIRateLimitError = (error: unknown): boolean => {
  const message = String((error as { message?: string } | null)?.message ?? error ?? '');
  return message.includes('rate_limit_exceeded') || /rate limit/i.test(message);
};

const getOpenAIRetryDelayMs = (error: unknown): number => {
  const message = String((error as { message?: string } | null)?.message ?? error ?? '');
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return DEFAULT_OPENAI_RATE_LIMIT_DELAY_MS;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_OPENAI_RATE_LIMIT_DELAY_MS;
  return Math.ceil(seconds * 1000);
};

const runProvider = (
  provider: ModelPhotoProvider,
  prompt: string,
  imageConfig: ProviderImageConfig,
  falKey: string,
  openaiKey: string,
  referenceImageUrl?: string | null,
  preserveReferenceDetails = true,
): Promise<TextToImageResult> => {
  if (referenceImageUrl) {
    switch (provider) {
      case 'fal-seedream-v4.5':
        return editModelPhotoWithSeedreamV45(prompt, imageConfig as FalSeedreamImageConfig, referenceImageUrl, falKey);
      case 'fal-banana-pro':
        return editModelPhotoWithBananaPro(prompt, imageConfig as FalBananaProImageConfig, referenceImageUrl, falKey);
      case 'openai-dalle':
        return editModelPhotoWithOpenAI(
          prompt,
          imageConfig as OpenAIImageConfig,
          referenceImageUrl,
          openaiKey,
          preserveReferenceDetails,
        );
      case 'fal-nano-banana-2':
        return editModelPhotoWithNanoBanana2(prompt, imageConfig as FalNanoBanana2ImageConfig, referenceImageUrl, falKey);
      case 'fal-seedream-5':
        return editModelPhotoWithSeedream5(prompt, imageConfig as FalSeedream5ImageConfig, referenceImageUrl, falKey);
      case 'fal-gpt-image-2':
        return editModelPhotoWithFalGPTImage2(prompt, imageConfig as FalGPTImage2ImageConfig, referenceImageUrl, falKey);
      default:
        throw new Error(`El proveedor ${provider} no soporta generación de poses desde referencia.`);
    }
  }

  switch (provider) {
    case 'fal-seedream-v4.5':
      return generateModelPhotoWithSeedreamV45(prompt, imageConfig as FalSeedreamImageConfig, falKey);
    case 'fal-banana-pro':
      return generateModelPhotoWithBananaPro(prompt, imageConfig as FalBananaProImageConfig, falKey);
    case 'openai-dalle':
      return generateModelPhotoWithOpenAI(prompt, imageConfig as OpenAIImageConfig, openaiKey);
    case 'fal-nano-banana-2':
      return generateModelPhotoWithNanoBanana2(prompt, imageConfig as FalNanoBanana2ImageConfig, falKey);
    case 'fal-seedream-5':
      return generateModelPhotoWithSeedream5(prompt, imageConfig as FalSeedream5ImageConfig, falKey);
    case 'fal-gpt-image-2':
      return generateModelPhotoWithFalGPTImage2(prompt, imageConfig as FalGPTImage2ImageConfig, falKey);
    default:
      throw new Error(`Proveedor de foto de modelo no reconocido: ${provider}`);
  }
};

export const generateSingleModelPhoto = async ({
  provider,
  prompt,
  imageConfig,
  falKey,
  openaiKey,
  referenceImageUrl = null,
  preserveReferenceDetails = true,
}: {
  provider: ModelPhotoProvider;
  prompt: string;
  imageConfig: ProviderImageConfig;
  falKey: string;
  openaiKey: string;
  referenceImageUrl?: string | null;
  preserveReferenceDetails?: boolean;
}): Promise<TextToImageResult> => {
  let attempt = 0;

  while (true) {
    try {
      return await runProvider(
        provider,
        prompt,
        imageConfig,
        falKey,
        openaiKey,
        referenceImageUrl,
        preserveReferenceDetails,
      );
    } catch (error) {
      if (provider !== 'openai-dalle' || !isOpenAIRateLimitError(error) || attempt >= OPENAI_RATE_LIMIT_MAX_RETRIES) {
        throw error;
      }

      await sleep(getOpenAIRetryDelayMs(error));
      attempt += 1;
    }
  }
};
