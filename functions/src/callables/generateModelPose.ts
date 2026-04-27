import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FAL_KEY, OPENAI_API_KEY } from '../config/runtime';
import {
  GenerateModelPhotoRequest,
  GenerateModelPhotoResponse,
} from '../../../shared/src/types';
import { getModelPhotoProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import {
  generateSingleModelPhoto,
  mapModelPhotoProviderToProvider,
} from '../utils/modelPhotoGeneration';

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
      imageConfig,
      count,
      tempSessionId,
      clientId,
      modelId = null,
      stage = null,
      referenceStoragePath = null,
      preserveReferenceDetails = true,
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
    const systemConfig = await getSystemConfigCached();
    assertProviderEnabledInSystemConfig(
      mapModelPhotoProviderToProvider(provider),
      systemConfig,
      'usar para generar fotos de modelo',
    );
    const normalizedImageConfig = normalizeProviderImageConfig(
      mapModelPhotoProviderToProvider(provider),
      imageConfig,
      aspectRatio,
    ).imageConfig;
    const referenceImageUrl = referenceStoragePath
      ? (await bucket.file(referenceStoragePath).getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000,
          version: 'v4',
        }))[0]
      : null;

    const generatePhoto = async (index: number) => {
        const result = await generateSingleModelPhoto({
          provider,
          prompt,
          imageConfig: normalizedImageConfig,
          falKey,
          openaiKey,
          referenceImageUrl,
          preserveReferenceDetails,
        });

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

    const generateAndStorePhoto = async (index: number) => generatePhoto(index);

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
    const costPerPhoto = getModelPhotoProviderCostUsd(provider, normalizedImageConfig);
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
