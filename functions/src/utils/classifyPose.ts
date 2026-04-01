import * as admin from 'firebase-admin';
import { Pose, PoseFraming, PoseOrientationDetail } from '../../../shared/src/types';
import {
  isPoseFraming,
  isPoseOrientationDetail,
} from '../../../shared/src/utils/poseAiClassification';

import { callGeminiGenerateContent } from '../analytics/geminiUsage';

export interface PoseClassificationResult {
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  faceVisible: boolean;
  confidence: number | null;
  reasoning: string | null;
}

interface GeminiPoseClassificationPayload {
  orientationDetail?: unknown;
  framing?: unknown;
  faceVisible?: unknown;
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
      enum: ['full_body', 'three_quarter_body', 'medium_body', 'lower_body', 'feet_closeup', 'unknown'],
      description:
        'Classify the crop/framing of the pose image. full_body: whole body head to feet. three_quarter_body: head to roughly knee. medium_body: torso/upper body dominant. lower_body: hips to feet with no upper body or face visible. feet_closeup: close-up shot focused on feet and ankles only. unknown: unclear framing.',
    },
    faceVisible: {
      type: 'boolean',
      description: 'True if the face or head of the model is clearly visible in the image.',
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
  required: ['orientationDetail', 'framing', 'faceVisible', 'confidence', 'reasoning'],
};

const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const clampConfidence = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, value));
};

const extractResponseText = (payload: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string => {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini no devolvió texto utilizable para la clasificación de poses.');
  }

  return text;
};

const downloadStorageImage = async (
  storagePath: string,
): Promise<{ bytes: Buffer; mimeType: string }> => {
  const bucket = admin.storage().bucket();
  const [bytes] = await bucket.file(storagePath).download();
  return { bytes, mimeType: mimeTypeFromStoragePath(storagePath) };
};

export const classifyPoseWithGemini = async ({
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
}): Promise<PoseClassificationResult> => {
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
    '- full_body: cuerpo completo visible de cabeza a pies',
    '- three_quarter_body: se ve casi todo el cuerpo, hasta aproximadamente la rodilla',
    '- medium_body: domina torso/medio cuerpo, sin ver piernas',
    '- lower_body: encuadre de cadera hacia abajo, sin torso ni cara visibles (ideal para pantalones, faldas, zapatos)',
    '- feet_closeup: plano cerrado enfocado en pies y tobillos solamente',
    '- unknown: encuadre no claro',
    'faceVisible: true si la cara/cabeza del modelo es claramente visible en la imagen.',
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

  return {
    orientationDetail: isPoseOrientationDetail(parsed.orientationDetail)
      ? parsed.orientationDetail
      : 'ambiguous',
    framing: isPoseFraming(parsed.framing) ? parsed.framing : 'unknown',
    faceVisible: parsed.faceVisible === true,
    confidence: clampConfidence(parsed.confidence),
    reasoning:
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : null,
  };
};
