import sharp from 'sharp';
import * as admin from 'firebase-admin';
import { Pose, PoseFraming, PoseOrientationDetail } from '../../../shared/src/types';
import {
  isPoseFraming,
  isPoseOrientationDetail,
} from '../../../shared/src/utils/poseAiClassification';

import { callGeminiGenerateContent } from '../analytics/geminiUsage';

export interface PoseClassificationResult {
  photoObservation?: import('../../../shared/src/types').PhotoBaseObservation;
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  faceVisible: boolean;
  confidence: number | null;
  reasoning: string | null;
}

interface GeminiPoseClassificationPayload {
  photoObservation?: any;
  orientationDetail?: unknown;
  framing?: unknown;
  faceVisible?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

const POSE_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    photoObservation: { type: 'object', properties: {
      audience: { type: 'string', enum: ['baby', 'child', 'adult'] },
      orientation: { type: 'string', enum: ['front', 'back', 'side'] },
      posture: { type: 'string', enum: ['standing', 'other'] },
      framing: { type: 'string', enum: ['upper_body', 'lower_body', 'full_body'] },
      background: { type: 'string', enum: ['white', 'neutral', 'context'] },
      garmentVisible: { type: 'boolean' }, accessories: { type: 'boolean' }, evidence: { type: 'string' },
    }, required: ['audience', 'orientation', 'posture', 'framing', 'background', 'garmentVisible', 'accessories', 'evidence'] },
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
  required: ['photoObservation', 'orientationDetail', 'framing', 'faceVisible', 'confidence', 'reasoning'],
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
    'Analiza orientación, postura, encuadre, fondo observado (white solo si visualmente puro), visibilidad de la prenda base, accesorios ajenos y público del modelo. Registra evidencia visible por photoObservation. La receta o el nombre del archivo no acreditan cumplimiento.',
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
  let whiteRgbVerified = false;
  if (parsed.photoObservation?.background === 'white') {
    const { data, info } = await sharp(image.bytes).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    whiteRgbVerified = [[0, 0], [info.width - 8, 0], [0, info.height - 8], [info.width - 8, info.height - 8]].every(([x, y]) => {
      for (let row = y; row < y + 8; row++) for (let col = x; col < x + 8; col++) for (let c = 0; c < 3; c++) if (data[(row * info.width + col) * info.channels + c] !== 255) return false;
      return true;
    });
  }

  return {
    ...(parsed.photoObservation ? { photoObservation: { ...parsed.photoObservation, whiteRgbVerified, verified: (clampConfidence(parsed.confidence) || 0) >= .8, performer: pose.storagePath.startsWith('model_generations/') ? 'synthetic' as const : pose.photoObservation?.performer || 'unknown' as const } } : {}),
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
