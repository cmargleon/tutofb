import type { GeminiUsageContext } from '../analytics/geminiUsage';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ClassifyGarmentViewsGarmentInput,
  ClassifyGarmentViewsRequest,
  ClassifyGarmentViewsResponse,
  ClassifiedGarmentPhoto,
  GarmentAccessoryType,
  GarmentBodyArea,
  GarmentPhotoAssetInput,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import {
  inferGarmentAccessoryTypeFromText,
  isGarmentAccessoryType,
} from '../../../shared/src/utils/accessoryMatching';
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
  quality?: unknown;
}

interface GeminiGarmentClassificationPayload {
  itemKind?: unknown;
  itemKindConfidence?: unknown;
  itemKindReasoning?: unknown;
  itemLabel?: unknown;
  garmentGender?: unknown;
  garmentGenderConfidence?: unknown;
  garmentGenderReasoning?: unknown;
  photos?: unknown;
  bodyArea?: unknown;
  accessoryType?: unknown;
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
    itemKind: { type: ['string', 'null'], enum: ['garment', 'product', null] },
    itemKindConfidence: { type: 'number' },
    itemKindReasoning: { type: 'string' },
    itemLabel: { type: ['string', 'null'] },
    garmentGender: { type: ['string', 'null'], enum: ['male', 'female', 'unisex', null] },
    garmentGenderConfidence: { type: ['number', 'null'] },
    garmentGenderReasoning: { type: ['string', 'null'] },
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
      enum: ['upper_body', 'lower_body', 'footwear', 'head_accessory', 'full_body', 'carry_accessory', null],
    },
    accessoryType: {
      type: ['string', 'null'],
      enum: ['backpack', 'shoulder_bag', 'crossbody_bag', 'handbag', 'tote_bag', 'duffel_bag', 'generic_carry_accessory', null],
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
    'itemKind',
    'itemKindConfidence',
    'itemKindReasoning',
    'itemLabel',
    'garmentGender',
    'garmentGenderConfidence',
    'garmentGenderReasoning',
    'photos',
    'bodyArea',
    'accessoryType',
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
const VALID_GARMENT_BODY_AREAS: GarmentBodyArea[] = ['upper_body', 'lower_body', 'footwear', 'head_accessory', 'full_body', 'carry_accessory'];

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

const normalizeGarmentAccessoryType = (
  bodyArea: GarmentBodyArea | null,
  value: unknown,
  fallbackText: Array<string | null | undefined> = [],
): GarmentAccessoryType | null =>
  bodyArea === 'carry_accessory'
    ? (isGarmentAccessoryType(value) ? value : inferGarmentAccessoryTypeFromText(fallbackText))
    : null;

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

interface OrganizerClassifierAdapter {
  readImage(id: string): Promise<{ bytes: Buffer; mimeType: string }>;
  generate(body: unknown): Promise<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>;
}

export const classifyGarmentWithGemini = async ({
  apiKey,
  model,
  garment,
  userUid,
  categories,
  fallbackCategoryId, automation, clientId, organizer,
}: {
  automation?: GeminiUsageContext['automation'];
  clientId?: string;
  organizer?: OrganizerClassifierAdapter;
  apiKey: string;
  model: string;
  garment: ClassifyGarmentViewsGarmentInput;
  userUid?: string | null;
  categories: SpreadsheetTemplateCategory[];
  fallbackCategoryId: string | null;
}): Promise<ClassifyGarmentViewsResponse['garments'][number] & { referenceQuality?: Record<string, number> }> => {
  const photos = garment.photos.slice(0, 4);
  const imageParts = await Promise.all(
    photos.map(async (photo) => {
      const image = await (organizer ? organizer.readImage(photo.id) : downloadStorageImage(photo.storagePath));
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
    'Analiza el artículo principal de las fotos para un workflow de fotografía de catálogo. Las fotos son referencias del mismo artículo.',
    'Primero identifica itemKind: garment para ropa, calzado y accesorios que se visten o llevan sobre el cuerpo; product para los demás objetos. Si no puedes identificar el artículo principal, devuelve null. No clasifiques por la presencia de una persona o por el nombre del archivo.',
    'Devuelve itemKindConfidence entre 0 y 1, itemKindReasoning explicando la detección e itemLabel con un nombre breve en español, como Camiseta, Mochila o Lámpara.',
    'Para garment estima el público de la prenda principal con todas sus referencias: garmentGender male (masculino), female (femenino) o unisex (igualmente apropiada para ambos, 50/50). Evalúa corte, diseño y etiquetas visibles; no decidas solo por el color, nombre de archivo ni por la persona que la lleva.',
    'Devuelve garmentGenderConfidence entre 0 y 1 como confianza en esa clasificación y garmentGenderReasoning breve en español. Unisex no significa incertidumbre: si no hay evidencia suficiente, devuelve garmentGender null. Para product devuelve los tres campos de género null.',
    'Para objetos product devuelve bodyArea y accessoryType null; no inventes un área del cuerpo. Para ropa y accesorios garment identifica el área del cuerpo y el accesorio.',
    'Devuelve la vista principal de cada foto (front/back/side), el área del cuerpo (upper_body/lower_body/footwear/head_accessory/full_body/carry_accessory), el tipo de accesorio si aplica, la categoría final más probable del spreadsheet y el color principal visible de la prenda.',
    'Usa head_accessory para gorras, gorros, sombreros, lentes, gafas, diademas y accesorios cuyo foco principal sea cabeza o rostro.',
    'Usa footwear para zapatos, tenis, botas, sandalias y productos cuyo foco principal sean pies o tobillos.',
    'Usa carry_accessory para mochilas, bolsas de hombro, crossbody, handbags, totes, duffels y productos que se cargan o cuelgan del cuerpo.',
    'Para carry_accessory devuelve accessoryType: backpack, shoulder_bag, crossbody_bag, handbag, tote_bag, duffel_bag o generic_carry_accessory. Si es mochila o backpack, usa backpack.',
    'Para productos carry_accessory, front/back/side describen la vista del producto fotografiado, no la pose del modelo.',
    'Usa front si la foto muestra el frente de la prenda o si es la única foto y no hay evidencia de espalda.',
    'El color debe salir en español y, si hay categorías disponibles, conviene aproximarlo a un valor real del catálogo de color de la categoría elegida.',
    'No inventes categoría ni color si la imagen no da base suficiente; en ese caso devuelve null.',
    `Prenda interna: ${garment.garmentName}`,
    `Fotos recibidas: ${photos.map((photo, index) => `${index + 1}:${photo.id}:${photo.fileName}`).join(' | ')}`,
    `Categorías disponibles: ${categoryLines.join(' || ')}`,
    fallbackCategoryId ? `Categoría fallback sugerida por el usuario: ${fallbackCategoryId}` : 'Sin categoría fallback del usuario.',
    ...(organizer ? ['Evalúa quality de cada foto entre 0 y 1 para su uso como referencia.'] : []),
    'Devuelve solo JSON con el schema solicitado.',
  ].join('\n');

  const request = {
    apiKey,
    model,
    context: {
      ...(automation ? { automation, clientId } : {}),
      feature: 'garment_view_category_color_classification' as const,
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
        ...(automation ? { maxOutputTokens: 4096 } : {}),
        responseMimeType: 'application/json',
        responseJsonSchema: organizer ? {
          ...GARMENT_CLASSIFICATION_RESPONSE_SCHEMA,
          properties: { ...GARMENT_CLASSIFICATION_RESPONSE_SCHEMA.properties, photos: { type: 'array',
            items: { ...GARMENT_CLASSIFICATION_RESPONSE_SCHEMA.properties.photos.items,
              properties: { ...GARMENT_CLASSIFICATION_RESPONSE_SCHEMA.properties.photos.items.properties, quality: { type: 'number' } },
              required: [...GARMENT_CLASSIFICATION_RESPONSE_SCHEMA.properties.photos.items.required, 'quality'] } } },
        } : GARMENT_CLASSIFICATION_RESPONSE_SCHEMA,
      },
    },
  };
  const payload = organizer ? await organizer.generate(request.body)
    : (await callGeminiGenerateContent<Awaited<ReturnType<OrganizerClassifierAdapter['generate']>>>(request)).payload;

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

  const itemKind = parsed.itemKind === 'garment' || parsed.itemKind === 'product' ? parsed.itemKind : null;
  const garmentBodyArea = itemKind !== 'product' && isGarmentBodyArea(parsed.bodyArea) ? parsed.bodyArea : null;
  const garmentAccessoryType = normalizeGarmentAccessoryType(
    garmentBodyArea,
    parsed.accessoryType,
    [garment.garmentName, normalizeText(parsed.matchedCategory)],
  );

  return {
    garmentId: garment.garmentId,
    garmentName: garment.garmentName,
    photos: classifiedPhotos,
    availableViews: [...new Set(classifiedPhotos.map((photo) => photo.view))] as ClassifyGarmentViewsResponse['garments'][number]['availableViews'],
    garmentBodyArea,
    garmentAccessoryType,
    usedGemini: true,
    itemKind,
    itemKindConfidence: clampConfidence(parsed.itemKindConfidence),
    itemKindReasoning: normalizeText(parsed.itemKindReasoning),
    itemLabel: normalizeText(parsed.itemLabel),
    garmentGender: itemKind === 'garment' && ['male', 'female', 'unisex'].includes(parsed.garmentGender as string)
      ? parsed.garmentGender as 'male' | 'female' | 'unisex' : null,
    garmentGenderConfidence: itemKind === 'garment' ? clampConfidence(parsed.garmentGenderConfidence) : null,
    garmentGenderReasoning: itemKind === 'garment' ? normalizeText(parsed.garmentGenderReasoning) : null,
    matchedCategoryId: matchedCategory?.id || null,
    matchedCategoryLabel: matchedCategory?.label || null,
    matchedCategoryConfidence: clampConfidence(parsed.matchedCategoryConfidence),
    matchedCategoryReasoning: normalizeText(parsed.matchedCategoryReasoning),
    matchedColor,
    matchedColorConfidence: clampConfidence(parsed.matchedColorConfidence),
    matchedColorReasoning: normalizeText(parsed.matchedColorReasoning),
    ...(organizer ? { referenceQuality: Object.fromEntries(photos.map(photo => [
      photo.id, clampConfidence(parsedPhotosById.get(photo.id)?.quality) ?? 0,
    ])) } : {}),
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
