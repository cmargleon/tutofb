import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ClassifyGarmentViewsGarmentInput,
  ClassifyGarmentViewsRequest,
  ClassifyGarmentViewsResponse,
  ClassifiedGarmentPhoto,
  GarmentBodyArea,
  GarmentPhotoAssetInput,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { assertCallableRoles } from '../auth/roles';
import {
  GEMINI_API_KEY,
  getGeminiGarmentViewClassificationModel,
} from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';

interface GeminiGarmentPhotoClassificationPayload {
  photoId?: unknown;
  view?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

interface GeminiGarmentClassificationPayload {
  photos?: unknown;
  bodyArea?: unknown;
  matchedCategory?: unknown;
  matchedCategoryConfidence?: unknown;
  matchedCategoryReasoning?: unknown;
  matchedColor?: unknown;
  matchedColorConfidence?: unknown;
  matchedColorReasoning?: unknown;
}

const GARMENT_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          photoId: { type: 'string' },
          view: {
            type: 'string',
            enum: ['front', 'back', 'side'],
          },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['photoId', 'view', 'confidence', 'reasoning'],
      },
    },
    bodyArea: {
      type: ['string', 'null'],
      enum: ['upper_body', 'lower_body', 'footwear', 'full_body', null],
    },
    matchedCategory: {
      type: ['string', 'null'],
    },
    matchedCategoryConfidence: {
      type: ['number', 'null'],
    },
    matchedCategoryReasoning: {
      type: ['string', 'null'],
    },
    matchedColor: {
      type: ['string', 'null'],
    },
    matchedColorConfidence: {
      type: ['number', 'null'],
    },
    matchedColorReasoning: {
      type: ['string', 'null'],
    },
  },
  required: [
    'photos',
    'bodyArea',
    'matchedCategory',
    'matchedCategoryConfidence',
    'matchedCategoryReasoning',
    'matchedColor',
    'matchedColorConfidence',
    'matchedColorReasoning',
  ],
};

const bucket = admin.storage().bucket();
const db = getAppFirestore();
const VALID_GARMENT_BODY_AREAS: GarmentBodyArea[] = ['upper_body', 'lower_body', 'footwear', 'full_body'];

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

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const pickBestOption = (options: string[], candidates: Array<string | null | undefined>): string | null => {
  const normalizedOptions = options.map((option) => ({ raw: option, normalized: normalizeComparable(option) }));

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalizedCandidate = normalizeComparable(candidate);
    const exact = normalizedOptions.find((option) => option.normalized === normalizedCandidate);
    if (exact) {
      return exact.raw;
    }

    const partial = normalizedOptions.find(
      (option) => option.normalized.includes(normalizedCandidate) || normalizedCandidate.includes(option.normalized),
    );
    if (partial) {
      return partial.raw;
    }
  }

  return null;
};

const isGarmentBodyArea = (value: unknown): value is GarmentBodyArea =>
  typeof value === 'string' && (VALID_GARMENT_BODY_AREAS as string[]).includes(value);

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

const findColorOptions = (category: SpreadsheetTemplateCategory | null): string[] =>
  category?.attributes.find((attribute) => /color/.test(normalizeComparable(attribute.name)))?.values || [];

const resolveCategoryMatch = (
  categories: SpreadsheetTemplateCategory[],
  candidate: string | null,
  fallbackCategoryId: string | null,
): SpreadsheetTemplateCategory | null => {
  if (categories.length === 0) {
    return null;
  }

  if (candidate) {
    const normalizedCandidate = normalizeComparable(candidate);
    const exact = categories.find((category) => normalizeComparable(category.label) === normalizedCandidate);
    if (exact) {
      return exact;
    }

    const partial = categories.find((category) => {
      const normalizedLabel = normalizeComparable(category.label);
      return normalizedLabel.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedLabel);
    });
    if (partial) {
      return partial;
    }
  }

  if (fallbackCategoryId) {
    return categories.find((category) => category.id === fallbackCategoryId) || null;
  }

  return categories.length === 1 ? categories[0] : null;
};

const loadTemplateCategories = async (
  clientId: string | null,
  spreadsheetTemplateId: string | null,
): Promise<SpreadsheetTemplateCategory[]> => {
  if (!clientId || !spreadsheetTemplateId) {
    return [];
  }

  const snapshot = await db
    .collection('clients')
    .doc(clientId)
    .collection('spreadsheetTemplates')
    .doc(spreadsheetTemplateId)
    .collection('categories')
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SpreadsheetTemplateCategory));
};

const classifyGarmentWithGemini = async ({
  apiKey,
  model,
  garment,
  userUid,
  categories,
  fallbackCategoryId,
}: {
  apiKey: string;
  model: string;
  garment: ClassifyGarmentViewsGarmentInput;
  userUid?: string | null;
  categories: SpreadsheetTemplateCategory[];
  fallbackCategoryId: string | null;
}): Promise<ClassifyGarmentViewsResponse['garments'][number]> => {
  const photos = garment.photos.slice(0, 4);
  const imageParts = await Promise.all(
    photos.map(async (photo) => {
      const image = await downloadStorageImage(photo.storagePath);
      return {
        photo,
        part: {
          inline_data: {
            mime_type: image.mimeType,
            data: image.bytes.toString('base64'),
          },
        },
      };
    }),
  );

  const categoryLines = categories.length === 0
    ? ['No hay categorías de spreadsheet cargadas para esta clasificación.']
    : categories.map((category, index) => {
        const colorPreview = findColorOptions(category).slice(0, 12).join(' / ') || 'sin catálogo de color';
        const requiredPreview = category.columns
          .filter((column) => column.required)
          .slice(0, 8)
          .map((column) => column.label)
          .join(', ');

        return `${index + 1}. ${category.label} | colores: ${colorPreview} | requeridos: ${requiredPreview || 'sin requeridos destacados'}`;
      });

  const prompt = [
    'Clasifica una prenda para un workflow de catálogo y spreadsheet.',
    'Devuelve la vista principal de cada foto (front/back/side), el área del cuerpo (upper_body/lower_body/footwear/full_body), la categoría final más probable del spreadsheet y el color principal visible de la prenda.',
    'Usa front si la foto muestra el frente de la prenda o si es la única foto y no hay evidencia de espalda.',
    'El color debe salir en español y, si hay categorías disponibles, conviene aproximarlo a un valor real del catálogo de color de la categoría elegida.',
    'No inventes categoría ni color si la imagen no da base suficiente; en ese caso devuelve null.',
    `Prenda interna: ${garment.garmentName}`,
    `Fotos recibidas: ${photos.map((photo, index) => `${index + 1}:${photo.id}:${photo.fileName}`).join(' | ')}`,
    `Categorías disponibles: ${categoryLines.join(' || ')}`,
    fallbackCategoryId ? `Categoría fallback sugerida por el usuario: ${fallbackCategoryId}` : 'Sin categoría fallback del usuario.',
    'Devuelve solo JSON con el schema solicitado.',
  ].join('\n');

  const { payload } = await callGeminiGenerateContent<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>({
    apiKey,
    model,
    context: {
      feature: 'garment_view_category_color_classification',
      garmentId: garment.garmentId,
      garmentName: garment.garmentName,
      userUid,
    },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            ...imageParts.map((entry) => entry.part),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: GARMENT_CLASSIFICATION_RESPONSE_SCHEMA,
      },
    },
  });

  const parsed = JSON.parse(extractResponseText(payload)) as GeminiGarmentClassificationPayload;
  const parsedPhotos = Array.isArray(parsed.photos) ? parsed.photos as GeminiGarmentPhotoClassificationPayload[] : [];
  const parsedPhotosById = new Map(
    parsedPhotos
      .map((photo) => {
        const photoId = normalizeText(photo.photoId);
        return photoId ? [photoId, photo] : null;
      })
      .filter((entry): entry is [string, GeminiGarmentPhotoClassificationPayload] => Boolean(entry)),
  );

  const matchedCategory = resolveCategoryMatch(categories, normalizeText(parsed.matchedCategory), fallbackCategoryId);
  const matchedColor = matchedCategory
    ? pickBestOption(findColorOptions(matchedCategory), [normalizeText(parsed.matchedColor)])
    : normalizeText(parsed.matchedColor);

  const classifiedPhotos: ClassifiedGarmentPhoto[] = photos.map((photo) => {
    const parsedPhoto = parsedPhotosById.get(photo.id);
    return {
      ...photo,
      view: parsedPhoto?.view === 'back' || parsedPhoto?.view === 'side' ? parsedPhoto.view : 'front',
      confidence: clampConfidence(parsedPhoto?.confidence),
      reasoning: normalizeText(parsedPhoto?.reasoning),
      classifiedBy: 'gemini',
    };
  });

  return {
    garmentId: garment.garmentId,
    garmentName: garment.garmentName,
    photos: classifiedPhotos,
    availableViews: [...new Set(classifiedPhotos.map((photo) => photo.view))] as ClassifyGarmentViewsResponse['garments'][number]['availableViews'],
    garmentBodyArea: isGarmentBodyArea(parsed.bodyArea) ? parsed.bodyArea : null,
    usedGemini: true,
    matchedCategoryId: matchedCategory?.id || null,
    matchedCategoryLabel: matchedCategory?.label || null,
    matchedCategoryConfidence: clampConfidence(parsed.matchedCategoryConfidence),
    matchedCategoryReasoning: normalizeText(parsed.matchedCategoryReasoning),
    matchedColor,
    matchedColorConfidence: clampConfidence(parsed.matchedColorConfidence),
    matchedColorReasoning: normalizeText(parsed.matchedColorReasoning),
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

    const clientId = typeof request.data?.clientId === 'string' ? request.data.clientId.trim() : '';
    const spreadsheetTemplateId = typeof request.data?.spreadsheetTemplateId === 'string'
      ? request.data.spreadsheetTemplateId.trim()
      : '';
    const fallbackCategoryId = typeof request.data?.fallbackCategoryId === 'string' && request.data.fallbackCategoryId.trim()
      ? request.data.fallbackCategoryId.trim()
      : null;
    const categories = await loadTemplateCategories(clientId || null, spreadsheetTemplateId || null);
    const geminiModel = getGeminiGarmentViewClassificationModel();
    const responseGarments: ClassifyGarmentViewsResponse['garments'] = [];

    for (const garment of garments) {
      responseGarments.push(await classifyGarmentWithGemini({
        apiKey: GEMINI_API_KEY.value(),
        model: geminiModel,
        garment,
        userUid: request.auth?.uid,
        categories,
        fallbackCategoryId,
      }));
    }

    return {
      success: true,
      garments: responseGarments,
    };
  },
);
