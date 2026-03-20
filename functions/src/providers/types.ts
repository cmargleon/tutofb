import { AspectRatio, Provider } from '../../../shared/src/types';

export interface ProviderRequest {
  poseImageUrl: string;
  garmentImageUrl: string;
  prompt: string;
  aspectRatio: AspectRatio;
  signal: AbortSignal;
}

export interface ProviderResponse {
  provider: Provider;
  contentType: string;
  imageBytes: Buffer;
  remoteUrl: string | null;
  requestId: string | null;
  responseSummary: Record<string, unknown> | null;
}
