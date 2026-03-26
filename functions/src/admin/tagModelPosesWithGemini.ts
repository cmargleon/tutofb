import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Model,
  ModelPoseTaggingModelSummary,
  ModelPoseTaggingRequest,
  ModelPoseTaggingResponse,
  Pose,
  TaggedModelPoseSummary,
} from '../../../shared/src/types';
import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import { assertCallableRoles } from '../auth/roles';
import { GEMINI_API_KEY, getGeminiPoseClassificationModel } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { classifyPoseWithGemini } from '../utils/classifyPose';

const normalizeModelName = (value: string): string => value.trim().toLocaleLowerCase('es');

const normalizeModelStatus = (model: Model): 'active' | 'archived' =>
  model.status === 'archived' ? 'archived' : 'active';

const buildModelSummary = (model: Model): ModelPoseTaggingModelSummary => ({
  id: model.id || '',
  name: model.name,
  status: normalizeModelStatus(model),
  poseCount: Array.isArray(model.poses) ? model.poses.length : 0,
  action: 'delete',
});

export const tagModelPosesWithGemini = onCall<ModelPoseTaggingRequest, Promise<ModelPoseTaggingResponse>>(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 540 },
  async (request) => {
    await assertCallableRoles(request, ['admin']);

    const modelId = typeof request.data?.modelId === 'string' && request.data.modelId.trim().length > 0
      ? request.data.modelId.trim()
      : null;
    const targetModelName =
      typeof request.data?.targetModelName === 'string' && request.data.targetModelName.trim().length > 0
        ? request.data.targetModelName.trim()
        : 'Jorge';
    const dryRun = request.data?.dryRun !== false;
    const deleteOtherModels = request.data?.deleteOtherModels === true;

    const db = getAppFirestore();

    let targetModel: Model;
    let allModels: Model[] | null = null;

    if (modelId) {
      const modelDoc = await db.collection('models').doc(modelId).get();
      if (!modelDoc.exists) {
        throw new HttpsError('not-found', `No se encontró un modelo con id "${modelId}".`);
      }
      targetModel = { id: modelDoc.id, ...modelDoc.data() } as Model;
    } else {
      const snapshot = await db.collection('models').get();
      allModels = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Model));

      const targetMatches = allModels.filter(
        (model) => normalizeModelName(model.name) === normalizeModelName(targetModelName),
      );

      if (targetMatches.length === 0) {
        throw new HttpsError(
          'not-found',
          `No se encontró un modelo con nombre "${targetModelName}" en la colección models.`,
        );
      }

      if (targetMatches.length > 1) {
        throw new HttpsError(
          'failed-precondition',
          `Se encontraron ${targetMatches.length} modelos con nombre "${targetModelName}". Resuelve la duplicidad antes de ejecutar esta tarea.`,
        );
      }

      targetModel = targetMatches[0];
    }
    if (!targetModel.id) {
      throw new HttpsError('internal', 'El modelo objetivo no tiene id.');
    }

    if (!Array.isArray(targetModel.poses) || targetModel.poses.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        `El modelo "${targetModel.name}" no tiene poses para clasificar.`,
      );
    }

    const geminiModel = getGeminiPoseClassificationModel();
    const taggedAt = admin.firestore.Timestamp.now();
    const classifiedPoses: Array<{
      original: Pose;
      aiClassification: ReturnType<typeof buildPoseAiClassification>;
      summary: TaggedModelPoseSummary;
    }> = [];

    for (const pose of targetModel.poses) {
      const classification = await classifyPoseWithGemini({
        apiKey: GEMINI_API_KEY.value(),
        model: geminiModel,
        pose,
        clientId: targetModel.clientId,
        clientNameSnapshot: targetModel.clientNameSnapshot,
        modelId: targetModel.id,
        modelName: targetModel.name,
        userUid: request.auth?.uid,
      });

      const aiClassification = buildPoseAiClassification({
        orientationDetail: classification.orientationDetail,
        framing: classification.framing,
        confidence: classification.confidence,
        taggedAt,
        reasoning: classification.reasoning,
      });

      classifiedPoses.push({
        original: pose,
        aiClassification,
        summary: {
          poseId: pose.id,
          fileName: pose.fileName,
          storagePath: pose.storagePath,
          orientationGroup: aiClassification.orientationGroup,
          orientationDetail: aiClassification.orientationDetail,
          framing: aiClassification.framing,
          autoCategory: aiClassification.autoCategory,
          usableForGarmentViews: aiClassification.usableForGarmentViews,
          confidence: aiClassification.confidence,
        },
      });
    }

    const nextPoses = targetModel.poses.map((pose) => {
      const classified = classifiedPoses.find((entry) => entry.original.id === pose.id);
      if (!classified) {
        return pose;
      }

      return {
        ...pose,
        aiClassification: classified.aiClassification,
      };
    });

    const otherModels = allModels
      ? allModels.filter((model) => model.id !== targetModel.id)
      : [];
    const deletedModelIds: string[] = [];
    const warnings: string[] = [];

    if (otherModels.length === 0) {
      warnings.push('No se encontraron otros modelos para borrar.');
    } else if (!deleteOtherModels) {
      warnings.push('Se clasificaron las poses del modelo objetivo, pero no se borraron otros modelos.');
    }

    if (!dryRun) {
      await db.collection('models').doc(targetModel.id).update({
        poses: nextPoses,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (deleteOtherModels) {
        for (const model of otherModels) {
          const modelRef = db.collection('models').doc(model.id!);
          if (normalizeModelStatus(model) !== 'archived') {
            await modelRef.update({
              status: 'archived',
              archivedAt: admin.firestore.FieldValue.serverTimestamp(),
              archivedByUid: request.auth?.uid || null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          await modelRef.delete();
          deletedModelIds.push(model.id!);
        }
      }
    }

    const displayModels = allModels ?? [targetModel];
    const modelSummaries: ModelPoseTaggingModelSummary[] = displayModels
      .map((model): ModelPoseTaggingModelSummary => ({
        ...buildModelSummary(model),
        action:
          model.id === targetModel.id
            ? 'keep'
            : deleteOtherModels ? 'delete' : 'keep',
      }))
      .sort((left, right) => {
        if (left.action === right.action) {
          return left.name.localeCompare(right.name, 'es');
        }
        return left.action === 'keep' ? -1 : 1;
      });

    return {
      success: true,
      targetModelName: targetModel.name,
      targetModelId: targetModel.id,
      dryRun,
      models: modelSummaries,
      taggedPoses: classifiedPoses.map((entry) => entry.summary),
      deletedModelIds,
      warnings,
    };
  },
);
