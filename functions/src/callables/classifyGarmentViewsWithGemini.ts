import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ClassifyGarmentViewsGarmentInput,
  ClassifyGarmentViewsRequest,
  ClassifyGarmentViewsResponse,
  ClassifiedGarmentPhoto,
  GarmentPhotoAssetInput,
} from '../../../shared/src/types';
import { getSortedUniqueGarmentViews } from '../../../shared/src/utils/garmentViewMatching';
import { assertCallableRoles } from '../auth/roles';
import {
  GEMINI_API_KEY,
  getGeminiGarmentViewClassificationModel,
} from '../config/runtime';

interface GeminiGarmentViewClassificationPayload {
  view?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

const GARMENT_VIEW_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    view: {
      type: 'string',
      enum: ['front', 'back', 'side'],
      description:
        'Classify the garment image orientation. Use front for frontal view, back for rear view, and side for profile/lateral view.',
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
  required: ['view', 'confidence', 'reasoning'],
};

const bucket = admin.storage().bucket();

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const ensureDraftOwnership = (uid: string, storagePath: string, garmentName: string): void => {
  if (!storagePath.startsWith(`garments/drafts/${uid}/`)) {
    throw new HttpsError(
      'permission-denied',
      `La foto de la prenda ${garmentName} no pertenece al usuario autenticado o no está en la ruta esperada.`,
    );
  }
};

const normalizePhotoInput = (
  value: unknown,
  garmentName: string,
  fallbackIndex: number,
): GarmentPhotoAssetInput => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', `La prenda ${garmentName} tiene una foto inválida.`);
  }

  const photo = value as Partial<GarmentPhotoAssetInput>;
  return {
    id: requireNonEmptyString(photo.id, `El id de una foto de ${garmentName}`),
    fileName: requireNonEmptyString(photo.fileName, `El nombre de una foto de ${garmentName}`),
    storagePath: requireNonEmptyString(photo.storagePath, `La ruta de una foto de ${garmentName}`),
    sourceIndex:
      typeof photo.sourceIndex === 'number' && Number.isFinite(photo.sourceIndex)
        ? Math.max(0, Math.trunc(photo.sourceIndex))
        : fallbackIndex,
  };
};

const normalizeGarmentInput = (value: unknown): ClassifyGarmentViewsGarmentInput => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', 'Cada prenda debe ser un objeto válido.');
  }

  const garment = value as Partial<ClassifyGarmentViewsGarmentInput>;
  const garmentName = requireNonEmptyString(garment.garmentName, 'El nombre de la prenda');
  const photos = Array.isArray(garment.photos)
    ? garment.photos.map((photo, index) => normalizePhotoInput(photo, garmentName, index))
    : [];

  if (photos.length === 0) {
    throw new HttpsError('invalid-argument', `La prenda ${garmentName} debe incluir al menos una foto.`);
  }

  return {
    garmentId: requireNonEmptyString(garment.garmentId, `El id de ${garmentName}`),
    garmentName,
    photos,
  };
};

const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

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
    throw new Error('Gemini no devolvió texto utilizable para clasificar la prenda.');
  }

  return text;
};

const downloadStorageImage = async (storagePath: string): Promise<{ bytes: Buffer; mimeType: string }> => {
  const [bytes] = await bucket.file(storagePath).download();
  return {
    bytes,
    mimeType: mimeTypeFromStoragePath(storagePath),
  };
};

const classifyGarmentPhotoWithGemini = async ({
  apiKey,
  model,
  photo,
}: {
  apiKey: string;
  model: string;
  photo: GarmentPhotoAssetInput;
}): Promise<Pick<ClassifiedGarmentPhoto, 'view' | 'confidence' | 'reasoning' | 'classifiedBy'>> => {
  const image = await downloadStorageImage(photo.storagePath);

  const prompt = [
    'Clasifica una foto individual de una prenda para un catalogo.',
    'Devuelve solo una vista principal entre front, back o side.',
    'front = se ve el frente principal de la prenda.',
    'back = se ve la espalda o parte trasera principal.',
    'side = vista lateral o perfil; usa side si no es claramente front ni back.',
    'No inventes detalles fuera de la imagen.',
    `Nombre de archivo: ${photo.fileName}`,
    'Devuelve solo JSON con el schema solicitado.',
  ].join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
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
          responseJsonSchema: GARMENT_VIEW_CLASSIFICATION_RESPONSE_SCHEMA,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parsed = JSON.parse(extractResponseText(payload)) as GeminiGarmentViewClassificationPayload;
  const view = parsed.view === 'back' || parsed.view === 'side' ? parsed.view : 'front';

  return {
    view,
    confidence: clampConfidence(parsed.confidence),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() || null : null,
    classifiedBy: 'gemini',
  };
};

export const classifyGarmentViewsWithGemini = onCall<ClassifyGarmentViewsRequest, Promise<ClassifyGarmentViewsResponse>>(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 540 },
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);

    const garments = Array.isArray(request.data?.garments)
      ? request.data.garments.map(normalizeGarmentInput)
      : [];

    if (garments.length === 0) {
      throw new HttpsError('invalid-argument', 'Debes enviar al menos una prenda para clasificar.');
    }

    garments.forEach((garment) =>
      garment.photos.forEach((photo) =>
        ensureDraftOwnership(request.auth!.uid, photo.storagePath, garment.garmentName),
      ),
    );

    const geminiModel = getGeminiGarmentViewClassificationModel();
    const responseGarments: ClassifyGarmentViewsResponse['garments'] = [];

    for (const garment of garments) {
      if (garment.photos.length === 1) {
        const [photo] = garment.photos;
        const assumedPhoto: ClassifiedGarmentPhoto = {
          ...photo,
          view: 'front',
          confidence: null,
          reasoning: 'Se asumió frente porque la prenda solo tiene una foto.',
          classifiedBy: 'assumed_single_front',
        };

        responseGarments.push({
          garmentId: garment.garmentId,
          garmentName: garment.garmentName,
          photos: [assumedPhoto],
          availableViews: ['front'],
          usedGemini: false,
        });
        continue;
      }

      const classifiedPhotos: ClassifiedGarmentPhoto[] = [];
      for (const photo of garment.photos) {
        const classification = await classifyGarmentPhotoWithGemini({
          apiKey: GEMINI_API_KEY.value(),
          model: geminiModel,
          photo,
        });

        classifiedPhotos.push({
          ...photo,
          ...classification,
        });
      }

      responseGarments.push({
        garmentId: garment.garmentId,
        garmentName: garment.garmentName,
        photos: classifiedPhotos,
        availableViews: getSortedUniqueGarmentViews(classifiedPhotos.map((photo) => photo.view)),
        usedGemini: true,
      });
    }

    return {
      success: true,
      garments: responseGarments,
    };
  },
);
