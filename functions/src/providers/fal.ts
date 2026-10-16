import { buildNewFalRequest, NewFalImageConfig, NewFalProvider } from './falModels';
import {
  AspectRatio,
  FalBananaProImageConfig,
  FalGPTImage2ImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
} from '../../../shared/src/types';
import { mapLegacyAspectRatioToSeedreamImageSize } from '../../../shared/src/providerImageConfig';
import { getFalPollIntervalMs, getFalPollTimeoutMs } from '../config/runtime';
import { ProviderGenerationError } from '../errors/jobFailure';
import { ProviderRequest, ProviderResponse } from './types';

interface FalQueueResponse {
  request_id?: string;
  response_url?: string;
  status_url?: string;
}

interface FalStatusResponse {
  status?: string;
}

interface FalImagePayload {
  images?: Array<{
    url?: string;
    content_type?: string;
  }>;
  image?: {
    url?: string;
    content_type?: string;
  };
  url?: string;
}

type FalProvider = ProviderResponse['provider'];

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const mapAspectRatioToSeedreamSize = (aspectRatio: AspectRatio): string =>
  mapLegacyAspectRatioToSeedreamImageSize(aspectRatio);

const fetchImageBytes = async (
  url: string,
  signal: AbortSignal,
  provider: FalProvider,
  requestId: string | null,
): Promise<{ bytes: Buffer; contentType: string }> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ProviderGenerationError({
      provider,
      reasonCode: 'provider_image_download_failed',
      stage: 'delivery',
      requestId,
      httpStatus: response.status,
      retryable: true,
      message: `No se pudo descargar la imagen generada (${response.status}).`,
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'image/png',
  };
};

const extractImage = (payload: FalImagePayload): { url: string; contentType: string } | null => {
  const firstImage = payload.images?.[0];
  if (firstImage?.url) {
    return {
      url: firstImage.url,
      contentType: firstImage.content_type || 'image/png',
    };
  }

  if (payload.image?.url) {
    return {
      url: payload.image.url,
      contentType: payload.image.content_type || 'image/png',
    };
  }

  if (payload.url) {
    return {
      url: payload.url,
      contentType: 'image/png',
    };
  }

  return null;
};

const submitFalRequest = async (
  provider: FalProvider,
  endpointId: string,
  body: Record<string, unknown>,
  falKey: string,
  signal: AbortSignal,
): Promise<FalQueueResponse> => {
  const response = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
      'X-Fal-Object-Lifecycle-Preference': '21600',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new ProviderGenerationError({
      provider,
      reasonCode: response.status === 429 ? 'provider_rate_limited' : 'provider_http_error',
      httpStatus: response.status,
      retryable: response.status !== 401 && response.status !== 403,
      message: bodyText || `fal.ai respondió con status ${response.status}.`,
      raw: {
        endpointId,
        bodyText,
      },
    });
  }

  return (await response.json()) as FalQueueResponse;
};

const pollFalResponse = async (
  provider: FalProvider,
  endpointId: string,
  queue: FalQueueResponse,
  falKey: string,
  signal: AbortSignal,
): Promise<FalImagePayload> => {
  const requestId = queue.request_id;
  if (!requestId) {
    throw new ProviderGenerationError({
      provider,
      reasonCode: 'provider_missing_request_id',
      retryable: true,
      message: 'fal.ai no devolvió request_id.',
      raw: {
        endpointId,
        queue,
      },
    });
  }

  const statusUrl = queue.status_url || `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
  const responseUrl = queue.response_url || `https://queue.fal.run/${endpointId}/requests/${requestId}`;
  const startedAt = Date.now();

  while (true) {
    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${falKey}` },
      signal,
    });

    if (!statusResponse.ok) {
      const bodyText = await statusResponse.text();
      throw new ProviderGenerationError({
        provider,
        reasonCode: statusResponse.status === 429 ? 'provider_rate_limited' : 'provider_http_error',
        requestId,
        httpStatus: statusResponse.status,
        retryable: statusResponse.status !== 401 && statusResponse.status !== 403,
        message: bodyText || `fal.ai status respondió con ${statusResponse.status}.`,
        raw: {
          endpointId,
          statusUrl,
          bodyText,
        },
      });
    }

    const statusPayload = (await statusResponse.json()) as FalStatusResponse;
    const status = statusPayload.status;

    if (status === 'COMPLETED' || status === 'OK') {
      const resultResponse = await fetch(responseUrl, {
        headers: { Authorization: `Key ${falKey}` },
        signal,
      });

      if (!resultResponse.ok) {
        const bodyText = await resultResponse.text();
        throw new ProviderGenerationError({
          provider,
          reasonCode: resultResponse.status === 429 ? 'provider_rate_limited' : 'provider_http_error',
          requestId,
          httpStatus: resultResponse.status,
          retryable: resultResponse.status !== 401 && resultResponse.status !== 403,
          message: bodyText || `fal.ai result respondió con ${resultResponse.status}.`,
          raw: {
            endpointId,
            responseUrl,
            bodyText,
          },
        });
      }

      return (await resultResponse.json()) as FalImagePayload;
    }

    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
      throw new ProviderGenerationError({
        provider,
        reasonCode: 'provider_failed_status',
        requestId,
        providerStatus: status,
        retryable: status !== 'CANCELED',
        message: `fal.ai devolvió estado ${status}.`,
        raw: {
          endpointId,
          statusPayload,
        },
      });
    }

    if (Date.now() - startedAt > getFalPollTimeoutMs()) {
      throw new ProviderGenerationError({
        provider,
        reasonCode: 'provider_timeout',
        requestId,
        retryable: true,
        message: 'La solicitud a fal.ai excedió el tiempo máximo de espera.',
        raw: {
          endpointId,
          statusUrl,
          responseUrl,
        },
      });
    }

    await sleep(getFalPollIntervalMs());
  }
};

const buildNoImageError = (
  provider: FalProvider,
  endpointId: string,
  payload: FalImagePayload,
  requestId: string | null,
): ProviderGenerationError =>
  new ProviderGenerationError({
    provider,
    reasonCode: 'provider_no_image',
    requestId,
    retryable: true,
    message: `${provider} no devolvió una imagen utilizable.`,
    raw: {
      endpointId,
      payload,
    },
  });

export const generateWithFalSeedream = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const provider: FalProvider = 'fal-seedream';
  const imageConfig = request.imageConfig as FalSeedreamImageConfig;
  const endpointId = 'fal-ai/bytedance/seedream/v4.5/edit';
  const queue = await submitFalRequest(
    provider,
    endpointId,
    {
      prompt: request.prompt,
      image_urls: (request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl]),
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: true,
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  }

  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider,
    contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes,
    remoteUrl: image.url,
    requestId: queue.request_id || null,
    responseSummary: {
      endpointId,
      requestId: queue.request_id || null,
      remoteUrl: image.url,
    },
  };
};

export const generateWithFalBananaPro = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const provider: FalProvider = 'fal-banana-pro';
  const imageConfig = request.imageConfig as FalBananaProImageConfig;
  const endpointId = 'fal-ai/nano-banana-pro/edit';
  const queue = await submitFalRequest(
    provider,
    endpointId,
    {
      prompt: request.prompt,
      image_urls: (request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl]),
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  }

  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider,
    contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes,
    remoteUrl: image.url,
    requestId: queue.request_id || null,
    responseSummary: {
      endpointId,
      requestId: queue.request_id || null,
      remoteUrl: image.url,
    },
  };
};

export const generateWithFalNanoBanana2 = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const provider: FalProvider = 'fal-nano-banana-2';
  const imageConfig = request.imageConfig as FalNanoBanana2ImageConfig;
  const endpointId = 'fal-ai/nano-banana-2/edit';
  const queue = await submitFalRequest(
    provider,
    endpointId,
    {
      prompt: request.prompt,
      image_urls: (request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl]),
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  }

  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider,
    contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes,
    remoteUrl: image.url,
    requestId: queue.request_id || null,
    responseSummary: {
      endpointId,
      requestId: queue.request_id || null,
      remoteUrl: image.url,
    },
  };
};

export const generateWithFalSeedream5 = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const provider: FalProvider = 'fal-seedream-5';
  const imageConfig = request.imageConfig as FalSeedream5ImageConfig;
  const endpointId = 'fal-ai/bytedance/seedream/v5/lite/edit';
  const queue = await submitFalRequest(
    provider,
    endpointId,
    {
      prompt: request.prompt,
      image_urls: (request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl]),
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: false,
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  }

  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider,
    contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes,
    remoteUrl: image.url,
    requestId: queue.request_id || null,
    responseSummary: {
      endpointId,
      requestId: queue.request_id || null,
      remoteUrl: image.url,
    },
  };
};

export const generateWithFalGPTImage2 = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const provider: FalProvider = 'fal-gpt-image-2';
  const imageConfig = request.imageConfig as FalGPTImage2ImageConfig;
  const endpointId = 'openai/gpt-image-2/edit';
  const queue = await submitFalRequest(
    provider,
    endpointId,
    {
      prompt: request.prompt,
      image_urls: (request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl]),
      num_images: 1,
      image_size: imageConfig.imageSize,
      quality: imageConfig.quality,
      output_format: imageConfig.outputFormat,
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  }

  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider,
    contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes,
    remoteUrl: image.url,
    requestId: queue.request_id || null,
    responseSummary: {
      endpointId,
      requestId: queue.request_id || null,
      remoteUrl: image.url,
    },
  };
};

export const generateWithNewFalModel = async (
  provider: NewFalProvider,
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const { endpointId, body } = buildNewFalRequest(
    provider, request.prompt, request.imageConfig as NewFalImageConfig,
    request.referenceImageUrls || [request.poseImageUrl, request.garmentImageUrl],
  );
  const queue = await submitFalRequest(provider, endpointId, body, falKey, request.signal);
  const payload = await pollFalResponse(provider, endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);
  if (!image) throw buildNoImageError(provider, endpointId, payload, queue.request_id || null);
  const downloaded = await fetchImageBytes(image.url, request.signal, provider, queue.request_id || null);
  return {
    provider, contentType: image.contentType || downloaded.contentType,
    imageBytes: downloaded.bytes, remoteUrl: image.url, requestId: queue.request_id || null,
    responseSummary: { endpointId, requestId: queue.request_id || null, remoteUrl: image.url },
  };
};
