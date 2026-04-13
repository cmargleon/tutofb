import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ModelPhotoProvider } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

type BackfillModelPosesRequest = {
  dryRun?: boolean;
  provider?: ModelPhotoProvider;
  chunkSize?: number;
  cursor?: string | null;
};

type BackfillModelPosesResponse = {
  success: boolean;
  operationId: string;
};

const isModelPhotoProvider = (value: unknown): value is ModelPhotoProvider =>
  value === 'fal-seedream-v4.5'
  || value === 'fal-banana-pro'
  || value === 'openai-dalle'
  || value === 'fal-nano-banana-2'
  || value === 'fal-seedream-5';

export const backfillModelPoses = onCall<
  BackfillModelPosesRequest,
  Promise<BackfillModelPosesResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const provider = isModelPhotoProvider(request.data?.provider) ? request.data.provider : 'openai-dalle';
  const chunkSize = Math.max(1, Math.min(5, Math.trunc(Number(request.data?.chunkSize) || 1)));
  const cursor = typeof request.data?.cursor === 'string' && request.data.cursor.trim()
    ? request.data.cursor.trim()
    : null;

  try {
    const operationRef = getAppFirestore().collection('adminOperations').doc();
    await operationRef.set({
      kind: 'backfill_missing_model_poses',
      status: 'queued',
      dryRun: request.data?.dryRun === true,
      provider,
      chunkSize,
      cursor,
      processedModelCount: 0,
      eligibleModelCount: 0,
      createdPoseCount: 0,
      failedModelCount: 0,
      skippedModelCount: 0,
      errorMessages: [],
      lastProcessedModelId: null,
      lastProcessedModelName: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      operationId: operationRef.id,
    };
  } catch (error) {
    console.error('Error queueing backfillModelPoses:', error);
    throw new HttpsError('internal', 'No se pudo encolar el backfill de poses.');
  }
});
