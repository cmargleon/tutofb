import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FAL_KEY, OPENAI_API_KEY } from '../config/runtime';
import {
  GenerateModelPhotoRequest,
  GenerateModelPhotoResponse,
  ModelPhotoProvider,
} from '../../../shared/src/types';
import { MODEL_PHOTO_PROVIDER_COSTS } from '../../../shared/src/constants/providerCosts';
import {
  generateModelPhotoWithFluxPro,
  generateModelPhotoWithFluxSchnell,
  generateModelPhotoWithSeedreamV4,
  generateModelPhotoWithSeedreamV45,
  generateModelPhotoWithBanana,
  generateModelPhotoWithBananaPro,
  generateModelPhotoWithBanana2,
  generateModelPhotoWithOpenAI,
  editModelPhotoWithBananaPro,
  editModelPhotoWithOpenAI,
  editModelPhotoWithSeedreamV45,
  TextToImageResult,
} from '../providers/textToImage';

const OPENAI_RATE_LIMIT_MAX_RETRIES = 5;
const DEFAULT_OPENAI_RATE_LIMIT_DELAY_MS = 15_000;

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
  aspectRatio: GenerateModelPhotoRequest['aspectRatio'],
  falKey: string,
  openaiKey: string,
  referenceImageUrl?: string | null,
): Promise<TextToImageResult> => {
  if (referenceImageUrl) {
    switch (provider) {
      case 'fal-seedream-v4.5':
        return editModelPhotoWithSeedreamV45(prompt, aspectRatio, referenceImageUrl, falKey);
      case 'fal-banana-pro':
        return editModelPhotoWithBananaPro(prompt, aspectRatio, referenceImageUrl, falKey);
      case 'openai-dalle':
        return editModelPhotoWithOpenAI(prompt, aspectRatio, referenceImageUrl, openaiKey);
      default:
        throw new Error(`El proveedor ${provider} no soporta generación de poses desde referencia.`);
    }
  }

  switch (provider) {
    case 'fal-flux-pro':       return generateModelPhotoWithFluxPro(prompt, aspectRatio, falKey);
    case 'fal-flux-schnell':   return generateModelPhotoWithFluxSchnell(prompt, aspectRatio, falKey);
    case 'fal-seedream-v4':    return generateModelPhotoWithSeedreamV4(prompt, aspectRatio, falKey);
    case 'fal-seedream-v4.5':  return generateModelPhotoWithSeedreamV45(prompt, aspectRatio, falKey);
    case 'fal-banana':         return generateModelPhotoWithBanana(prompt, aspectRatio, falKey);
    case 'fal-banana-pro':     return generateModelPhotoWithBananaPro(prompt, aspectRatio, falKey);
    case 'fal-banana-2':       return generateModelPhotoWithBanana2(prompt, aspectRatio, falKey);
    case 'openai-dalle':       return generateModelPhotoWithOpenAI(prompt, aspectRatio, openaiKey);
    default:                   return generateModelPhotoWithFluxPro(prompt, aspectRatio, falKey);
  }
};

export const generateModelPose = onCall(
  { secrets: [FAL_KEY, OPENAI_API_KEY], timeoutSeconds: 300 },
  async (request): Promise<GenerateModelPhotoResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión para usar esta función.');
    }

    const data = request.data as GenerateModelPhotoRequest;
    const {
      prompt,
      provider,
      aspectRatio,
      count,
      tempSessionId,
      clientId,
      modelId = null,
      stage = null,
      referenceStoragePath = null,
    } = data;

    if (!prompt || !provider || !aspectRatio || !count || !tempSessionId || !clientId) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
    }
    if (count < 1 || count > 12) {
      throw new HttpsError('invalid-argument', 'El número de fotos debe estar entre 1 y 12.');
    }

    const bucket = admin.storage().bucket();
    const falKey = FAL_KEY.value();
    const openaiKey = OPENAI_API_KEY.value();
    const referenceImageUrl = referenceStoragePath
      ? (await bucket.file(referenceStoragePath).getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000,
          version: 'v4',
        }))[0]
      : null;

    const generatePhoto = async (index: number) => {
        const result = await runProvider(provider, prompt, aspectRatio, falKey, openaiKey, referenceImageUrl);

        const ext = result.contentType.includes('jpeg') || result.contentType.includes('jpg') ? 'jpg' : 'png';
        const storageBasePath = modelId
          ? `model_generations/${clientId}/${modelId}/${stage ?? 'general'}/${tempSessionId}`
          : `model_generations/${clientId}/${tempSessionId}`;
        const storagePath = `${storageBasePath}/${index}.${ext}`;
        await bucket.file(storagePath).save(result.imageBytes, {
          metadata: { contentType: result.contentType },
          resumable: false,
        });

        return { index, storagePath, contentType: result.contentType };
    };

    const generateAndStorePhoto = async (index: number) => {
      let attempt = 0;

      while (true) {
        try {
          return await generatePhoto(index);
        } catch (error) {
          if (provider !== 'openai-dalle' || !isOpenAIRateLimitError(error) || attempt >= OPENAI_RATE_LIMIT_MAX_RETRIES) {
            throw error;
          }

          await sleep(getOpenAIRetryDelayMs(error));
          attempt += 1;
        }
      }
    };

    const results: PromiseSettledResult<{ index: number; storagePath: string; contentType: string }>[] = [];
    if (provider === 'openai-dalle') {
      for (let index = 0; index < count; index += 1) {
        try {
          results.push({ status: 'fulfilled', value: await generateAndStorePhoto(index) });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
    } else {
      results.push(
        ...(await Promise.allSettled(
          Array.from({ length: count }, (_, index) => generateAndStorePhoto(index)),
        )),
      );
    }

    const photos = results
      .filter(
        (r): r is PromiseFulfilledResult<{ index: number; storagePath: string; contentType: string }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r, i) => ({ index: i, message: String(r.reason?.message ?? 'Error desconocido') }));

    if (photos.length === 0) {
      throw new HttpsError(
        'internal',
        `Todas las generaciones fallaron: ${errors.map((e) => e.message).join('; ')}`,
      );
    }

    // Write cost log
    const costPerPhoto = MODEL_PHOTO_PROVIDER_COSTS[provider] ?? 0;
    const estimatedCostUsd = costPerPhoto * photos.length;
    await admin.firestore().collection('model_generation_logs').add({
      provider,
      requestedPhotos: count,
      completedPhotos: photos.length,
      estimatedCostUsd,
      clientId,
      modelId,
      stage,
      createdByUid: request.auth.uid,
      createdByDisplayName: request.auth.token.name ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true, photos, errors, estimatedCostUsd };
  },
);
