import { AspectRatio, FalBananaProImageConfig, FalNanoBanana2ImageConfig, FalSeedream5ImageConfig, FalSeedreamImageConfig } from '../../../shared/src/types';
import { mapLegacyAspectRatioToSeedreamImageSize } from '../../../shared/src/providerImageConfig';
import { getFalPollIntervalMs, getFalPollTimeoutMs } from '../config/runtime';
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

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const mapAspectRatioToSeedreamSize = (aspectRatio: AspectRatio): string => {
  return mapLegacyAspectRatioToSeedreamImageSize(aspectRatio);
};

const fetchImageBytes = async (url: string, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen generada (${response.status}).`);
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
    throw new Error(await response.text());
  }

  return (await response.json()) as FalQueueResponse;
};

const pollFalResponse = async (
  endpointId: string,
  queue: FalQueueResponse,
  falKey: string,
  signal: AbortSignal,
): Promise<FalImagePayload> => {
  const requestId = queue.request_id;
  if (!requestId) {
    throw new Error('fal.ai no devolvió request_id.');
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
      throw new Error(await statusResponse.text());
    }

    const statusPayload = (await statusResponse.json()) as FalStatusResponse;
    const status = statusPayload.status;

    if (status === 'COMPLETED' || status === 'OK') {
      const resultResponse = await fetch(responseUrl, {
        headers: { Authorization: `Key ${falKey}` },
        signal,
      });

      if (!resultResponse.ok) {
        throw new Error(await resultResponse.text());
      }

      return (await resultResponse.json()) as FalImagePayload;
    }

    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
      throw new Error(`fal.ai devolvió estado ${status}.`);
    }

    if (Date.now() - startedAt > getFalPollTimeoutMs()) {
      throw new Error('La solicitud a fal.ai excedió el tiempo máximo de espera.');
    }

    await sleep(getFalPollIntervalMs());
  }
};

export const generateWithFalSeedream = async (
  request: ProviderRequest,
  falKey: string,
): Promise<ProviderResponse> => {
  const imageConfig = request.imageConfig as FalSeedreamImageConfig;
  const endpointId = 'fal-ai/bytedance/seedream/v4.5/edit';
  const queue = await submitFalRequest(
    endpointId,
    {
      prompt: request.prompt,
      image_urls: [request.poseImageUrl, request.garmentImageUrl],
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: true,
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw new Error('fal.ai seedream no devolvió una imagen utilizable.');
  }

  const downloaded = await fetchImageBytes(image.url, request.signal);
  return {
    provider: 'fal-seedream',
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
  const imageConfig = request.imageConfig as FalBananaProImageConfig;
  const endpointId = 'fal-ai/nano-banana-pro/edit';
  const queue = await submitFalRequest(
    endpointId,
    {
      prompt: request.prompt,
      image_urls: [request.poseImageUrl, request.garmentImageUrl],
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw new Error('fal.ai banana-pro no devolvió una imagen utilizable.');
  }

  const downloaded = await fetchImageBytes(image.url, request.signal);
  return {
    provider: 'fal-banana-pro',
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
  const imageConfig = request.imageConfig as FalNanoBanana2ImageConfig;
  const endpointId = 'fal-ai/nano-banana-2/edit';
  const queue = await submitFalRequest(
    endpointId,
    {
      prompt: request.prompt,
      image_urls: [request.poseImageUrl, request.garmentImageUrl],
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw new Error('fal.ai nano-banana-2 no devolvió una imagen utilizable.');
  }

  const downloaded = await fetchImageBytes(image.url, request.signal);
  return {
    provider: 'fal-nano-banana-2',
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
  const imageConfig = request.imageConfig as FalSeedream5ImageConfig;
  const endpointId = 'fal-ai/bytedance/seedream/v5/lite/edit';
  const queue = await submitFalRequest(
    endpointId,
    {
      prompt: request.prompt,
      image_urls: [request.poseImageUrl, request.garmentImageUrl],
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: false,
    },
    falKey,
    request.signal,
  );

  const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
  const image = extractImage(payload);

  if (!image) {
    throw new Error('fal.ai seedream-5 no devolvió una imagen utilizable.');
  }

  const downloaded = await fetchImageBytes(image.url, request.signal);
  return {
    provider: 'fal-seedream-5',
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
