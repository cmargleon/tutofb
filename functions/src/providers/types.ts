import { Provider, ProviderImageConfig } from '../../../shared/src/types';

export interface ProviderRequest {
  referenceImageUrls?: string[];
  poseImageUrl: string;
  garmentImageUrl: string;
  prompt: string;
  imageConfig: ProviderImageConfig;
  signal: AbortSignal;
}

export interface ProviderResponse {
  preparedPhoto?: { bytes: Buffer; contentType: string; storedImage?: import('../../../shared/src/types').StoredPhotoMetadata };
  provider: Provider;
  contentType: string;
  imageBytes: Buffer;
  remoteUrl: string | null;
  requestId: string | null;
  responseSummary: Record<string, unknown> | null;
}
