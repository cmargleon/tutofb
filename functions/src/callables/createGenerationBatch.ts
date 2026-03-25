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
import { getBatchMaxJobs, getJobAutoReviewMaxAttempts, getJobMaxRetries } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
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
    const validated = validateCreateGenerationBatchInput(request.data, request.auth!.uid, getBatchMaxJobs());

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
    const actualJobMultiplier = validated.experiment?.mode === 'ab_paired'
      ? validated.experiment.arms.length
      : 1;
    const actualTotalJobs = compatibleCombinations.length * actualJobMultiplier;

    if (actualTotalJobs === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Ninguna prenda del lote tiene vistas compatibles con las poses seleccionadas.',
      );
    }

    if (actualTotalJobs > getBatchMaxJobs()) {
      throw new HttpsError(
        'out-of-range',
        `El lote excede el límite configurado de ${getBatchMaxJobs()} trabajos (${actualTotalJobs} solicitados).`,
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batchRef = db.collection('batches').doc();
    const experimentId = validated.experiment ? batchRef.id : null;
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
      experimentEnabled: Boolean(validated.experiment),
      experimentId,
      experimentMode: validated.experiment?.mode || null,
      experimentArms: validated.experiment?.arms || null,
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

    const maxRetries = getJobMaxRetries();
    const autoReviewMaxAttempts = getJobAutoReviewMaxAttempts();
    let combinationIndex = 0;

    for (const { garment, pose } of compatibleCombinations) {
        const selectedGarmentPhoto = resolveGarmentPhotoForPose(garment, pose);

        const comparisonKey = `${pose.id}::${garment.id}`;
        const assignedArms = validated.experiment
          ? (
              validated.experiment.mode === 'ab_paired'
                ? validated.experiment.arms
                : [validated.experiment.arms[combinationIndex % validated.experiment.arms.length]]
            )
          : [null];

        assignedArms.forEach((assignedArm) => {
          const selectedProvider = assignedArm?.provider || validated.provider;
          const jobRef = db.collection('jobs').doc();
          const jobDraft = buildJobDraft(
            {
              garmentIsMultiAngle: garment.isMultiAngle,
              garmentReferenceImageType: 'single_view',
            } as Pick<Job, 'garmentIsMultiAngle' | 'garmentReferenceImageType'>,
            selectedProvider,
            validated.promptBase,
            autoReviewMaxAttempts,
          );
          const jobData: Omit<Job, 'id'> = {
            batchId: batchRef.id,
            clientId: client.id!,
            clientNameSnapshot: client.name,
            modelId: model.id!,
            modelNameSnapshot: model.name,
            experimentEnabled: Boolean(assignedArm),
            experimentId,
            experimentMode: validated.experiment?.mode || null,
            experimentArmId: assignedArm?.id || null,
            experimentArmLabel: assignedArm?.label || null,
            experimentComparisonKey: assignedArm ? comparisonKey : null,
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
        });

      combinationIndex += 1;
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
