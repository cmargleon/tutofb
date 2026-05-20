import { AspectRatio, OpenAIImageConfig } from '../../../shared/src/types';
import { mapLegacyAspectRatioToOpenAIImageSize } from '../../../shared/src/providerImageConfig';
import { getOpenAIBaseUrl } from '../config/runtime';
import { ProviderGenerationError } from '../errors/jobFailure';
import { ProviderRequest, ProviderResponse } from './types';

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}

export const mapAspectRatioToOpenAISize = (aspectRatio: AspectRatio): string => {
  return mapLegacyAspectRatioToOpenAIImageSize(aspectRatio);
};

export const generateWithOpenAI = async (
  request: ProviderRequest,
  openaiApiKey: string,
): Promise<ProviderResponse> => {
  const provider: ProviderResponse['provider'] = 'openai-gpt-image-1.5';
  const imageConfig = request.imageConfig as OpenAIImageConfig;
  const response = await fetch(`${getOpenAIBaseUrl()}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1.5',
      prompt: request.prompt,
      size: imageConfig.size,
      quality: imageConfig.quality,
      output_format: 'png',
      input_fidelity: 'high',
      images: [
        { image_url: request.poseImageUrl },
        { image_url: request.garmentImageUrl },
      ],
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new ProviderGenerationError({
      provider,
      reasonCode: response.status === 429 ? 'provider_rate_limited' : 'provider_http_error',
      httpStatus: response.status,
      retryable: response.status !== 401 && response.status !== 403,
      message: bodyText || `OpenAI respondió con status ${response.status}.`,
      raw: {
        bodyText,
      },
    });
  }

  const payload = (await response.json()) as OpenAIImageResponse;
  const firstImage = payload.data?.[0];

  if (!firstImage) {
    throw new ProviderGenerationError({
      provider,
      reasonCode: 'provider_no_image',
      retryable: true,
      message: 'OpenAI no devolvió una imagen utilizable.',
      raw: {
        payload,
      },
    });
  }

  if (firstImage.b64_json) {
    return {
      provider,
      contentType: 'image/png',
      imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
      remoteUrl: null,
      requestId: null,
      responseSummary: {
        remoteUrl: null,
      },
    };
  }

  if (!firstImage.url) {
    throw new ProviderGenerationError({
      provider,
      reasonCode: 'provider_no_image',
      retryable: true,
      message: 'OpenAI devolvió una respuesta sin URL ni base64.',
      raw: {
        payload,
      },
    });
  }

  const imageResponse = await fetch(firstImage.url, { signal: request.signal });
  if (!imageResponse.ok) {
    throw new ProviderGenerationError({
      provider,
      reasonCode: 'provider_image_download_failed',
      stage: 'delivery',
      httpStatus: imageResponse.status,
      retryable: true,
      message: `No se pudo descargar la imagen de OpenAI (${imageResponse.status}).`,
    });
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  return {
    provider,
    contentType: imageResponse.headers.get('content-type') || 'image/png',
    imageBytes: Buffer.from(arrayBuffer),
    remoteUrl: firstImage.url,
    requestId: null,
    responseSummary: {
      remoteUrl: firstImage.url,
    },
  };
};
