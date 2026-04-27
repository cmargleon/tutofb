import { ModelPhotoProvider, Provider } from '../../../shared/src/types';
import { mapModelPhotoProviderToProvider } from '../models/providerImageConfig';

export const isProviderDisabled = (
  provider: Provider,
  disabledProviders: readonly string[] | null | undefined,
): boolean => Boolean(disabledProviders?.includes(provider));

export const isModelPhotoProviderDisabled = (
  provider: ModelPhotoProvider,
  disabledProviders: readonly string[] | null | undefined,
): boolean => isProviderDisabled(mapModelPhotoProviderToProvider(provider), disabledProviders);
