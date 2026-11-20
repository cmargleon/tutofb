import { MODEL_NEUTRAL_TONES, modelBackgroundVerification } from '../../../shared/src/modelBackgrounds';
import { MODEL_POSE_RECIPES_BY_ID } from '../../../shared/src/modelPoseRecipes';
import { MODEL_BASE_FILLER_VERIFICATION } from '../../../shared/src/modelPhotoSets';
import sharp from 'sharp';
import { verifyWhiteBackground } from '../media/verifyWhiteBackground';
import * as admin from 'firebase-admin';
import { Pose, PoseFraming, PoseOrientationDetail } from '../../../shared/src/types';
import {
  isPoseFraming,
  isPoseOrientationDetail,
} from '../../../shared/src/utils/poseAiClassification';

import { callGeminiGenerateContent } from '../analytics/geminiUsage';

export interface PoseClassificationResult {
  usageCostUsd?: number;
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
      concretePoseMatches: { type: 'boolean' }, concretePoseEvidence: { type: 'string' },
      pose: { type: 'string', enum: ['front', 'front_three_quarter', 'commercial_back', 'profile', 'unknown'] },
      lookingAtCamera: { type: 'boolean' }, mainPoseCompliant: { type: 'boolean' },
      identityCoherent: { type: 'boolean' }, identityEvidence: { type: 'string' },
      audience: { type: 'string', enum: ['baby', 'child', 'adult'] },
      orientation: { type: 'string', enum: ['front', 'back', 'side'] },
      posture: { type: 'string', enum: ['standing', 'other'] },
      framing: { type: 'string', enum: ['upper_body', 'lower_body', 'full_body'] },
      backgroundTone: { type: 'string', enum: ['white', 'neutral', ...MODEL_NEUTRAL_TONES, 'context', 'unknown'] },
      backgroundMatches: { type: 'boolean' }, backgroundEvidence: { type: 'string' },
      background: { type: 'string', enum: ['white', 'neutral', 'context'] },
      garmentVisible: { type: 'boolean' }, accessories: { type: 'boolean' }, evidence: { type: 'string' },
      fillerOutfitCompliant: { type: 'boolean' }, fillerOutfitEvidence: { type: 'string' },
    }, required: ['fillerOutfitCompliant', 'fillerOutfitEvidence', 'concretePoseMatches', 'concretePoseEvidence', 'pose', 'lookingAtCamera', 'mainPoseCompliant', 'identityCoherent', 'identityEvidence', 'audience', 'orientation', 'posture', 'framing', 'background', 'backgroundTone', 'backgroundMatches', 'backgroundEvidence', 'garmentVisible', 'accessories', 'evidence'] },
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
  identityStoragePath,
  performer,
  onUsage,
}: {
  apiKey: string;
  model: string;
  pose: Pose;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  userUid?: string | null;
  identityStoragePath?: string;
  performer?: 'real' | 'synthetic';
  onUsage?: (estimatedCostUsd: number) => Promise<void>;
}): Promise<PoseClassificationResult> => {
  const image = await downloadStorageImage(pose.storagePath);
  const identity = identityStoragePath ? await downloadStorageImage(identityStoragePath) : null;

  const prompt = [
    'Clasifica una imagen de pose de modelo para un sistema de catalogo de moda.',
    'Analiza orientación, postura, encuadre, fondo observado (white solo si visualmente puro), visibilidad de la prenda base, accesorios ajenos y público del modelo. Registra evidencia visible por photoObservation. La receta o el nombre del archivo no acreditan cumplimiento.',
    'No inventes detalles fuera de la imagen. Comprueba que la zona donde se sustituirá la prenda esté completa y libre de brazos, cabello o accesorios que oculten detalles.',
    'La ÚLTIMA imagen es la pose evaluada. Si hay una primera imagen de identidad, compara misma persona, edad y proporciones. identityCoherent solo true si existe esa referencia y coincide; explica identityEvidence.',
    'photoObservation.pose: front exige frontal real; front_three_quarter es giro comercial natural con frente y lateral visibles; profile es perfil rígido a 90 grados y NO sirve como tres cuartos; commercial_back exige espalda protagonista y rostro mirando a cámara por encima del hombro únicamente si el rostro aparece. El giro no debe ocultar la espalda.',
    'lookingAtCamera solo evalúa mirada cuando se ve el rostro. mainPoseCompliant exige de pie, frontal, ojos abiertos, boca cerrada y brazos a los lados cuando sean visibles. El nombre de la toma no es evidencia.',
    'photoObservation.framing: upper_body desde muslos hasta encima de cabeza; lower_body desde pecho o cintura hasta debajo de pies, sin rostro, cintura y bajos completos; full_body cabeza a pies completa.',
    ...(pose.marketplaceBaseSpec?.poseRecipeId ? [`Pose concreta solicitada: ${JSON.stringify(MODEL_POSE_RECIPES_BY_ID.get(pose.marketplaceBaseSpec.poseRecipeId))}. Evalúa sus detalles visibles y modificadores (por ejemplo caminando, contrapposto, diagonal). concretePoseMatches solo true si coincide también esta pose concreta, no basta compartir orientación. Explica concretePoseEvidence.`] : ['Sin pose concreta solicitada: concretePoseMatches=false.']),
    ...(pose.marketplaceBaseSpec?.rulesRevision !== undefined ? [`Configuración editable de Reglas Marketplace: ${JSON.stringify(pose.marketplaceBaseSpec)}. concretePoseMatches evalúa la postura, orientación y gesto de la pose concreta. Para encuadre y mirada prevalece esta configuración sobre el texto genérico del catálogo de poses. Registra lo observado; no des por cumplida la configuración solicitada.`] : []),
    MODEL_BASE_FILLER_VERIFICATION,
    ...(pose.marketplaceBaseSpec ? [modelBackgroundVerification(pose.marketplaceBaseSpec)] : ['Reporta backgroundTone aproximado y backgroundEvidence visible; sin fondo solicitado backgroundMatches=false.']),
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

  const { payload, usage } = await callGeminiGenerateContent<{
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
            ...(identity ? [{ inline_data: { mime_type: identity.mimeType, data: identity.bytes.toString('base64') } }] : []),
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

  await onUsage?.(usage.estimatedCostUsd);
  const parsed = JSON.parse(extractResponseText(payload)) as GeminiPoseClassificationPayload;
  if (pose.marketplaceBaseSpec) {
    const observation = parsed.photoObservation;
    const booleans = ['concretePoseMatches', 'lookingAtCamera', 'mainPoseCompliant', 'identityCoherent', 'garmentVisible', 'accessories', 'fillerOutfitCompliant'];
    if (!observation || booleans.some(key => typeof observation[key] !== 'boolean')
      || typeof parsed.faceVisible !== 'boolean' || typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)
      || !['front', 'front_three_quarter', 'commercial_back', 'profile', 'unknown'].includes(observation.pose)
      || !['upper_body', 'lower_body', 'full_body'].includes(observation.framing)
      || !['white', 'neutral', 'context'].includes(observation.background)
      || !['white', 'neutral', ...MODEL_NEUTRAL_TONES, 'context', 'unknown'].includes(observation.backgroundTone)
      || typeof observation.backgroundMatches !== 'boolean' || typeof observation.backgroundEvidence !== 'string' || !observation.backgroundEvidence.trim()
      || !['baby', 'child', 'adult'].includes(observation.audience)
      || !['standing', 'other'].includes(observation.posture))
      throw new Error('Respuesta incompleta de Gemini; conserva la imagen para volver a verificar sin regenerar.');
  }
  const whiteRgbVerified = parsed.photoObservation?.background === 'white' && await verifyWhiteBackground(image.bytes);
  const metadata = await sharp(image.bytes).metadata();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
  const width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;

  return {
    usageCostUsd: usage.estimatedCostUsd,
    ...(parsed.photoObservation ? { photoObservation: { ...parsed.photoObservation, width, height, faceVisible: parsed.faceVisible === true, identityCoherent: Boolean(identity && parsed.photoObservation.identityCoherent === true), whiteRgbVerified, verified: (clampConfidence(parsed.confidence) || 0) >= .8, performer: performer || (pose.storagePath.startsWith('model_generations/') ? 'synthetic' as const : pose.photoObservation?.performer || 'unknown' as const) } } : {}),
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
