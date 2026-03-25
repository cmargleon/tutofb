import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Model,
  ModelPoseTaggingModelSummary,
  ModelPoseTaggingRequest,
  ModelPoseTaggingResponse,
  Pose,
  PoseFraming,
  PoseOrientationDetail,
  TaggedModelPoseSummary,
} from '../../../shared/src/types';
import {
  buildPoseAiClassification,
  isPoseFraming,
  isPoseOrientationDetail,
} from '../../../shared/src/utils/poseAiClassification';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { assertCallableRoles } from '../auth/roles';
import { GEMINI_API_KEY, getGeminiPoseClassificationModel } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';

interface GeminiPoseClassificationPayload {
  orientationDetail?: unknown;
  framing?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

const POSE_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    orientationDetail: {
      type: 'string',
      enum: [
        'front',
        'front_three_quarter',
        'back',
        'back_three_quarter',
        'left_profile',
        'right_profile',
        'ambiguous',
      ],
      description:
        'Classify only the visible orientation of the human pose in the image. Use ambiguous if the body direction is not clear.',
    },
    framing: {
      type: 'string',
      enum: ['full_body', 'three_quarter_body', 'medium_body', 'unknown'],
      description:
        'Classify the crop/framing of the pose image. full_body means the full body is visible, three_quarter_body means most of the body is visible, medium_body means torso/upper body dominant.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence between 0 and 1.',
    },
    reasoning: {
      type: 'string',
      description: 'Very short explanation in Spanish.',
    },
  },
  required: ['orientationDetail', 'framing', 'confidence', 'reasoning'],
};

const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const normalizeModelName = (value: string): string => value.trim().toLocaleLowerCase('es');

const normalizeModelStatus = (model: Model): 'active' | 'archived' =>
  model.status === 'archived' ? 'archived' : 'active';

const clampConfidence = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
};

const extractResponseText = (payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string => {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini no devolvió texto utilizable para la clasificación de poses.');
  }

  return text;
};

const downloadStorageImage = async (storagePath: string): Promise<{ bytes: Buffer; mimeType: string }> => {
  const bucket = admin.storage().bucket();
  const [bytes] = await bucket.file(storagePath).download();
  return {
    bytes,
    mimeType: mimeTypeFromStoragePath(storagePath),
  };
};

const classifyPoseWithGemini = async ({
  apiKey,
  model,
  pose,
  clientId,
  clientNameSnapshot,
  modelId,
  modelName,
  userUid,
}: {
  apiKey: string;
  model: string;
  pose: Pose;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  userUid?: string | null;
}): Promise<{
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  confidence: number | null;
  reasoning: string | null;
}> => {
  const image = await downloadStorageImage(pose.storagePath);

  const prompt = [
    'Clasifica una imagen de pose de modelo para un sistema de catalogo de moda.',
    'Solo debes analizar la orientacion del cuerpo y el encuadre de la pose.',
    'NO analices la prenda. NO inventes detalles fuera de la imagen.',
    'Reglas:',
    '- front: cuerpo mayormente de frente',
    '- front_three_quarter: cuerpo de frente con giro parcial visible',
    '- back: cuerpo mayormente de espalda',
    '- back_three_quarter: cuerpo de espalda con giro parcial visible',
    '- left_profile / right_profile: perfil claro del cuerpo',
    '- ambiguous: si la orientacion no es clara',
    '- full_body: cuerpo completo visible',
    '- three_quarter_body: se ve casi todo el cuerpo, pero no completamente',
    '- medium_body: domina torso/medio cuerpo',
    '- unknown: encuadre no claro',
    `Nombre de archivo: ${pose.fileName}`,
    'Devuelve solo JSON con el schema solicitado.',
  ].join('\n');

  const { payload } = await callGeminiGenerateContent<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>({
    apiKey,
    model,
    context: {
      feature: 'pose_classification',
      clientId,
      clientNameSnapshot,
      modelId,
      modelNameSnapshot: modelName,
      poseId: pose.id,
      poseFileName: pose.fileName,
      userUid,
    },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: image.mimeType,
                data: image.bytes.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: POSE_CLASSIFICATION_RESPONSE_SCHEMA,
      },
    },
  });
  const parsed = JSON.parse(extractResponseText(payload)) as GeminiPoseClassificationPayload;

  const orientationDetail = isPoseOrientationDetail(parsed.orientationDetail)
    ? parsed.orientationDetail
    : 'ambiguous';
  const framing = isPoseFraming(parsed.framing) ? parsed.framing : 'unknown';
  const confidence = clampConfidence(parsed.confidence);
  const reasoning =
    typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
      ? parsed.reasoning.trim()
      : null;

  return {
    orientationDetail,
    framing,
    confidence,
    reasoning,
  };
};

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

    const targetModelName =
      typeof request.data?.targetModelName === 'string' && request.data.targetModelName.trim().length > 0
        ? request.data.targetModelName.trim()
        : 'Jorge';
    const dryRun = request.data?.dryRun !== false;
    const deleteOtherModels = request.data?.deleteOtherModels === true;

    const db = getAppFirestore();
    const snapshot = await db.collection('models').get();
    const models = snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Model));

    const targetMatches = models.filter(
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

    const targetModel = targetMatches[0];
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

    const otherModels = models.filter((model) => model.id !== targetModel.id);
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

    const modelSummaries: ModelPoseTaggingModelSummary[] = models
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
