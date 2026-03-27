import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Batch,
  Client,
  CreateGenerationBatchRequest,
  CreateGenerationBatchResponse,
  Job,
  Model,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getJobAutoReviewMaxAttempts } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { getSystemConfigCached } from '../admin/systemConfig';
import {
  assertModelOwnershipAndPoses,
  buildJobDraft,
  getCompatibleGarmentPoseCombinations,
  resolveGarmentPhotoForPose,
  validateCreateGenerationBatchInput,
} from './createGenerationBatch.helpers';

export const createGenerationBatch = onCall<CreateGenerationBatchRequest, Promise<CreateGenerationBatchResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);
    const systemConfig = await getSystemConfigCached();
    const validated = validateCreateGenerationBatchInput(request.data, request.auth!.uid, systemConfig.batchMaxJobs);

    const db = getAppFirestore();
    const clientRef = db.collection('clients').doc(validated.clientId);
    const modelRef = db.collection('models').doc(validated.modelId);
    const userRef = db.collection('users').doc(request.auth!.uid);
    const [clientSnapshot, modelSnapshot, userSnapshot] = await Promise.all([clientRef.get(), modelRef.get(), userRef.get()]);

    if (!clientSnapshot.exists) {
      throw new HttpsError('not-found', 'No se encontró el cliente seleccionado.');
    }

    if (!modelSnapshot.exists) {
      throw new HttpsError('not-found', 'No se encontró el modelo seleccionado.');
    }

    const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
    const model = { id: modelSnapshot.id, ...modelSnapshot.data() } as Model;
    const createdByDisplayName =
      userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data()!.displayName
        : null;

    if (model.clientId !== client.id) {
      throw new HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }

    const poseMap = assertModelOwnershipAndPoses(client, model, validated.poseIds);
    const selectedPoses = validated.poseIds
      .map((poseId) => poseMap.get(poseId))
      .filter((pose): pose is Model['poses'][number] => Boolean(pose));
    const compatibleCombinations = getCompatibleGarmentPoseCombinations(validated.garments, selectedPoses);
    const actualTotalJobs = compatibleCombinations.length;

    if (actualTotalJobs === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Ninguna prenda del lote tiene vistas compatibles con las poses seleccionadas.',
      );
    }

    if (actualTotalJobs > systemConfig.batchMaxJobs) {
      throw new HttpsError(
        'out-of-range',
        `El lote excede el límite configurado de ${systemConfig.batchMaxJobs} trabajos (${actualTotalJobs} solicitados).`,
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batchRef = db.collection('batches').doc();
    const batchData: Omit<Batch, 'id'> = {
      clientId: client.id!,
      clientNameSnapshot: client.name,
      clientSnapshot: {
        id: client.id!,
        name: client.name,
      },
      modelId: model.id!,
      modelNameSnapshot: model.name,
      modelSnapshot: {
        id: model.id!,
        clientId: model.clientId,
        name: model.name,
        poseCount: model.poseCount,
        coverPoseId: model.coverPoseId || model.poses[0]?.id || null,
        coverPosePath: model.coverPosePath || model.poses[0]?.storagePath || null,
      },
      provider: validated.provider,
      aspectRatio: validated.aspectRatio,
      promptBase: validated.promptBase,
      poseIds: validated.poseIds,
      garmentCount: validated.garments.length,
      totalJobs: actualTotalJobs,
      pendingJobs: actualTotalJobs,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      completedOutputCount: 0,
      status: 'pending',
      latestJobCreatedAt: now,
      lastJobCompletedAt: null,
      createdAt: now,
      updatedAt: now,
      createdByUid: request.auth!.uid,
      createdByDisplayName,
    };

    const writeBatch = db.batch();
    writeBatch.set(batchRef, batchData);

    const maxRetries = systemConfig.jobMaxRetries;
    const autoReviewMaxAttempts = getJobAutoReviewMaxAttempts();
    for (const { garment, pose } of compatibleCombinations) {
      const selectedGarmentPhoto = resolveGarmentPhotoForPose(garment, pose);
      const jobRef = db.collection('jobs').doc();
      const jobDraft = buildJobDraft(
        {
          garmentIsMultiAngle: garment.isMultiAngle,
          garmentReferenceImageType: 'single_view',
        } as Pick<Job, 'garmentIsMultiAngle' | 'garmentReferenceImageType'>,
        validated.provider,
        validated.promptBase,
        autoReviewMaxAttempts,
      );
      const jobData: Omit<Job, 'id'> = {
        batchId: batchRef.id,
        clientId: client.id!,
        clientNameSnapshot: client.name,
        modelId: model.id!,
        modelNameSnapshot: model.name,
        poseImageId: pose.id,
        poseImagePath: pose.storagePath,
        poseFileName: pose.fileName,
        garmentId: garment.id,
        garmentName: garment.name,
        garmentFilePath: selectedGarmentPhoto.storagePath,
        garmentPhotoId: selectedGarmentPhoto.id,
        garmentPhotoFileName: selectedGarmentPhoto.fileName,
        garmentView: selectedGarmentPhoto.view,
        garmentSourceType: garment.sourceType,
        garmentOriginalFileNames: garment.originalFileNames || [],
        garmentIsMultiAngle: garment.isMultiAngle,
        garmentReferenceImageType: 'single_view',
        aspectRatio: validated.aspectRatio,
        ...jobDraft,
        maxRetries,
        completedAt: null,
        latestOutputCreatedAt: null,
        currentOutputId: null,
        currentOutput: null,
        completedOutputCount: 0,
        totalCostUsd: 0,
        totalDurationSeconds: 0,
        providerUsage: {},
        manualRegenerationCount: 0,
        traceability: {
          batchCreatedAt: now,
          batchCreatedByUid: request.auth!.uid,
          batchCreatedByDisplayName: createdByDisplayName,
          lastAttemptStartedAt: null,
          lastCompletedAt: null,
          lastManualRegenerationAt: null,
          lastManualRegeneratedByUid: null,
          lastManualRegeneratedByDisplayName: null,
          lastProviderErrorAt: null,
          lastProviderErrorMessage: null,
        },
        createdAt: now,
        updatedAt: now,
        createdByUid: request.auth!.uid,
        lastError: null,
      };

      writeBatch.set(jobRef, jobData);
    }

    writeBatch.set(
      clientRef,
      {
        batchCount: admin.firestore.FieldValue.increment(1),
        lastBatchCreatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    await writeBatch.commit();

    return {
      batchId: batchRef.id,
      createdJobs: actualTotalJobs,
    };
  },
);
