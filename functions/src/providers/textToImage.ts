import {
  FalBananaProImageConfig,
  FalNanoBanana2ImageConfig,
  FalSeedream5ImageConfig,
  FalSeedreamImageConfig,
  OpenAIImageConfig,
} from '../../../shared/src/types';
import { getFalPollIntervalMs, getFalPollTimeoutMs, getOpenAIBaseUrl } from '../config/runtime';

export interface TextToImageResult {
  imageBytes: Buffer;
  contentType: string;
  remoteUrl: string | null;
}

interface FalQueueResponse {
  request_id?: string;
  response_url?: string;
  status_url?: string;
}

interface FalFluxPayload {
  images?: Array<{ url?: string; content_type?: string }>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchRemoteImage = async (
  imageUrl: string,
  fallbackContentType: string,
): Promise<TextToImageResult> => {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    throw new Error(`No se pudo descargar la imagen generada (${imgResp.status}).`);
  }

  return {
    imageBytes: Buffer.from(await imgResp.arrayBuffer()),
    contentType: imgResp.headers.get('content-type') || fallbackContentType,
    remoteUrl: imageUrl,
  };
};

const runFalTextToImage = async (
  endpointId: string,
  body: Record<string, unknown>,
  falKey: string,
): Promise<TextToImageResult> => {
  const queueResp = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!queueResp.ok) {
    throw new Error(`fal.ai [${endpointId}]: ${await queueResp.text()}`);
  }

  const queue = (await queueResp.json()) as FalQueueResponse;
  const requestId = queue.request_id;
  if (!requestId) throw new Error(`fal.ai [${endpointId}]: no devolvió request_id.`);

  const statusUrl = queue.status_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
  const responseUrl = queue.response_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}`;
  const startedAt = Date.now();

  while (true) {
    const statusResp = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
    if (!statusResp.ok) throw new Error(`fal.ai [${endpointId}] status: ${await statusResp.text()}`);

    const { status } = (await statusResp.json()) as { status?: string };

    if (status === 'COMPLETED' || status === 'OK') {
      const resultResp = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
      if (!resultResp.ok) throw new Error(`fal.ai [${endpointId}] result: ${await resultResp.text()}`);

      const payload = (await resultResp.json()) as FalFluxPayload;
      const firstImage = payload.images?.[0];
      if (!firstImage?.url) throw new Error(`fal.ai [${endpointId}]: no devolvió imagen.`);
      return fetchRemoteImage(firstImage.url, firstImage.content_type ?? 'image/jpeg');
    }

    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
      throw new Error(`fal.ai [${endpointId}] devolvió estado ${status}.`);
    }

    if (Date.now() - startedAt > getFalPollTimeoutMs()) {
      throw new Error(`fal.ai [${endpointId}] excedió el tiempo máximo de espera.`);
    }

    await sleep(getFalPollIntervalMs());
  }
};

const runFalImageEdit = async (
  endpointId: string,
  body: Record<string, unknown>,
  falKey: string,
): Promise<TextToImageResult> => {
  const queueResp = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!queueResp.ok) {
    throw new Error(`fal.ai [${endpointId}]: ${await queueResp.text()}`);
  }

  const queue = (await queueResp.json()) as FalQueueResponse;
  const requestId = queue.request_id;
  if (!requestId) throw new Error(`fal.ai [${endpointId}]: no devolvió request_id.`);

  const statusUrl = queue.status_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
  const responseUrl = queue.response_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}`;
  const startedAt = Date.now();

  while (true) {
    const statusResp = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
    if (!statusResp.ok) throw new Error(`fal.ai [${endpointId}] status: ${await statusResp.text()}`);

    const { status } = (await statusResp.json()) as { status?: string };

    if (status === 'COMPLETED' || status === 'OK') {
      const resultResp = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
      if (!resultResp.ok) throw new Error(`fal.ai [${endpointId}] result: ${await resultResp.text()}`);

      const payload = (await resultResp.json()) as FalFluxPayload;
      const firstImage = payload.images?.[0];
      if (!firstImage?.url) throw new Error(`fal.ai [${endpointId}]: no devolvió imagen.`);
      return fetchRemoteImage(firstImage.url, firstImage.content_type ?? 'image/png');
    }

    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
      throw new Error(`fal.ai [${endpointId}] devolvió estado ${status}.`);
    }

    if (Date.now() - startedAt > getFalPollTimeoutMs()) {
      throw new Error(`fal.ai [${endpointId}] excedió el tiempo máximo de espera.`);
    }

    await sleep(getFalPollIntervalMs());
  }
};

// fal.ai Seedream v4.5 text-to-image
export const generateModelPhotoWithSeedreamV45 = async (
  prompt: string,
  imageConfig: FalSeedreamImageConfig,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalTextToImage(
    'fal-ai/bytedance/seedream/v4.5/text-to-image',
    {
      prompt,
      image_size: imageConfig.imageSize,
      num_images: 1,
      enable_safety_checker: false,
    },
    falKey,
  );

// fal.ai Nano Banana (Gemini 2.5 Flash Image) text-to-image
const runFalBanana = (endpointId: string, prompt: string, imageConfig: FalBananaProImageConfig, falKey: string) =>
  runFalTextToImage(
    endpointId,
    {
      prompt,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      num_images: 1,
      output_format: 'jpeg',
    },
    falKey,
  );

export const generateModelPhotoWithBananaPro = (prompt: string, imageConfig: FalBananaProImageConfig, falKey: string) =>
  runFalBanana('fal-ai/nano-banana-pro', prompt, imageConfig, falKey);

export const editModelPhotoWithSeedreamV45 = (
  prompt: string,
  imageConfig: FalSeedreamImageConfig,
  referenceImageUrl: string,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalImageEdit(
    'fal-ai/bytedance/seedream/v4.5/edit',
    {
      prompt,
      image_urls: [referenceImageUrl],
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: false,
    },
    falKey,
  );

export const editModelPhotoWithBananaPro = (
  prompt: string,
  imageConfig: FalBananaProImageConfig,
  referenceImageUrl: string,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalImageEdit(
    'fal-ai/nano-banana-pro/edit',
    {
      prompt,
      image_urls: [referenceImageUrl],
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
  );

// fal.ai Nano Banana 2 (text-to-image)
export const generateModelPhotoWithNanoBanana2 = async (
  prompt: string,
  imageConfig: FalNanoBanana2ImageConfig,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalTextToImage(
    'fal-ai/nano-banana-2',
    {
      prompt,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      num_images: 1,
      output_format: 'jpeg',
    },
    falKey,
  );

// fal.ai Nano Banana 2 (image-to-image edit)
export const editModelPhotoWithNanoBanana2 = (
  prompt: string,
  imageConfig: FalNanoBanana2ImageConfig,
  referenceImageUrl: string,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalImageEdit(
    'fal-ai/nano-banana-2/edit',
    {
      prompt,
      image_urls: [referenceImageUrl],
      num_images: 1,
      aspect_ratio: imageConfig.aspectRatio,
      resolution: imageConfig.resolution,
      output_format: 'png',
    },
    falKey,
  );

// fal.ai Seedream 5 Lite (text-to-image)
export const generateModelPhotoWithSeedream5 = async (
  prompt: string,
  imageConfig: FalSeedream5ImageConfig,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalTextToImage(
    'fal-ai/bytedance/seedream/v5/lite/text-to-image',
    {
      prompt,
      image_size: imageConfig.imageSize,
      num_images: 1,
      enable_safety_checker: false,
    },
    falKey,
  );

// fal.ai Seedream 5 Lite (image-to-image edit)
export const editModelPhotoWithSeedream5 = (
  prompt: string,
  imageConfig: FalSeedream5ImageConfig,
  referenceImageUrl: string,
  falKey: string,
): Promise<TextToImageResult> =>
  runFalImageEdit(
    'fal-ai/bytedance/seedream/v5/lite/edit',
    {
      prompt,
      image_urls: [referenceImageUrl],
      num_images: 1,
      image_size: imageConfig.imageSize,
      enable_safety_checker: false,
    },
    falKey,
  );

// OpenAI gpt-image-1 (generations)
export const generateModelPhotoWithOpenAI = async (
  prompt: string,
  imageConfig: OpenAIImageConfig,
  openaiApiKey: string,
): Promise<TextToImageResult> => {
  const response = await fetch(`${getOpenAIBaseUrl()}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1.5',
      prompt,
      n: 1,
      size: imageConfig.size,
      quality: imageConfig.quality,
      output_format: 'png',
    }),
  });

  if (!response.ok) throw new Error(`OpenAI: ${await response.text()}`);

  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const firstImage = payload.data?.[0];
  if (!firstImage) throw new Error('OpenAI no devolvió imagen.');

  if (firstImage.b64_json) {
    return {
      imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
      contentType: 'image/png',
      remoteUrl: null,
    };
  }

  if (!firstImage.url) throw new Error('OpenAI devolvió respuesta sin URL ni base64.');
  return fetchRemoteImage(firstImage.url, 'image/png');
};

export const editModelPhotoWithOpenAI = async (
  prompt: string,
  imageConfig: OpenAIImageConfig,
  referenceImageUrl: string,
  openaiApiKey: string,
  preserveReferenceDetails = true,
): Promise<TextToImageResult> => {
  const response = await fetch(`${getOpenAIBaseUrl()}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1.5',
      prompt,
      size: imageConfig.size,
      quality: imageConfig.quality,
      output_format: 'png',
      ...(preserveReferenceDetails ? { input_fidelity: 'high' } : {}),
      images: [{ image_url: referenceImageUrl }],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI: ${await response.text()}`);

  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const firstImage = payload.data?.[0];
  if (!firstImage) throw new Error('OpenAI no devolvió imagen.');

  if (firstImage.b64_json) {
    return {
      imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
      contentType: 'image/png',
      remoteUrl: null,
    };
  }

  if (!firstImage.url) throw new Error('OpenAI devolvió respuesta sin URL ni base64.');
  return fetchRemoteImage(firstImage.url, 'image/png');
};
