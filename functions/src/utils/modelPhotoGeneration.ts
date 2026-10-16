import { isNewFalProvider, NewFalImageConfig } from '../providers/falModels';
import { generateModelPhotoWithNewFalModel } from '../providers/textToImage';
import {
  FalBananaProImageConfig,
  FalGPTImage2ImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
  ModelPhotoProvider,
  ProviderImageConfig,
} from '../../../shared/src/types';
import { mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import {
  editModelPhotoWithBananaPro,
  editModelPhotoWithFalGPTImage2,
  editModelPhotoWithNanoBanana2,
  editModelPhotoWithSeedream5,
  editModelPhotoWithSeedreamV45,
  generateModelPhotoWithBananaPro,
  generateModelPhotoWithFalGPTImage2,
  generateModelPhotoWithNanoBanana2,
  generateModelPhotoWithSeedream5,
  generateModelPhotoWithSeedreamV45,
  TextToImageResult,
} from '../providers/textToImage';

export { mapModelPhotoProviderToProvider };

const runProvider = (
  provider: ModelPhotoProvider,
  prompt: string,
  imageConfig: ProviderImageConfig,
  falKey: string,
  referenceImageUrl?: string | null,
): Promise<TextToImageResult> => {
  if (isNewFalProvider(provider)) {
    return generateModelPhotoWithNewFalModel(provider, prompt, imageConfig as NewFalImageConfig, falKey, referenceImageUrl);
  }
  if (referenceImageUrl) {
    switch (provider) {
      case 'fal-seedream-v4.5':
        return editModelPhotoWithSeedreamV45(prompt, imageConfig as FalSeedreamImageConfig, referenceImageUrl, falKey);
      case 'fal-banana-pro':
        return editModelPhotoWithBananaPro(prompt, imageConfig as FalBananaProImageConfig, referenceImageUrl, falKey);
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
  provider, prompt, imageConfig, falKey, referenceImageUrl = null,
}: {
  provider: ModelPhotoProvider;
  prompt: string;
  imageConfig: ProviderImageConfig;
  falKey: string;
  referenceImageUrl?: string | null;
  preserveReferenceDetails?: boolean;
}): Promise<TextToImageResult> => runProvider(provider, prompt, imageConfig, falKey, referenceImageUrl);
