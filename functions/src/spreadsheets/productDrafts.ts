import * as admin from 'firebase-admin';
import {
  Client,
  Model,
  ProductDraft,
  ProductDraftInput,
  ProductDraftRow,
  ProductDraftValueSuggestion,
  SourceSpreadsheetMatchSummary,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
  UploadedGarmentInput,
  WizardSourceSpreadsheetInput,
} from '../../../shared/src/types';
import {
  getProductDraftSpecificationAttributeName,
  resolveProductDraftColumnValue,
} from '../../../shared/src/utils/spreadsheetDraftColumns';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { GEMINI_API_KEY, getGeminiImageReviewModel } from '../config/runtime';
import {
  buildSourceSpreadsheetSuggestions,
  matchSourceSpreadsheetRowsToGarments,
  resolveSourceSpreadsheetRowColor,
} from './sourceSpreadsheetMatching';

const bucket = admin.storage().bucket();
const PRODUCT_DRAFT_PREVIEW_CONCURRENCY = 2;

interface GeminiDraftExtractionPayload {
  title?: unknown;
  description?: unknown;
  brand?: unknown;
  gender?: unknown;
  garmentType?: unknown;
  primaryColor?: unknown;
  sport?: unknown;
  material?: unknown;
  sleeveLength?: unknown;
  neckline?: unknown;
  fitType?: unknown;
  careInstructions?: unknown;
  characteristics?: unknown;
  details?: unknown;
  estimatedWeightGrams?: unknown;
  estimatedPackageLengthCm?: unknown;
  estimatedPackageWidthCm?: unknown;
  estimatedPackageHeightCm?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const PRODUCT_DRAFT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    gender: { type: ['string', 'null'] },
    garmentType: { type: ['string', 'null'] },
    primaryColor: { type: ['string', 'null'] },
    sport: { type: ['string', 'null'] },
    material: { type: ['string', 'null'] },
    sleeveLength: { type: ['string', 'null'] },
    neckline: { type: ['string', 'null'] },
    fitType: { type: ['string', 'null'] },
    careInstructions: { type: ['string', 'null'] },
    characteristics: {
      type: 'array',
      items: { type: 'string' },
    },
    details: {
      type: 'array',
      items: { type: 'string' },
    },
    estimatedWeightGrams: { type: ['number', 'null'] },
    estimatedPackageLengthCm: { type: ['number', 'null'] },
    estimatedPackageWidthCm: { type: ['number', 'null'] },
    estimatedPackageHeightCm: { type: ['number', 'null'] },
  },
  required: [
    'title',
    'description',
    'brand',
    'gender',
    'garmentType',
    'primaryColor',
    'sport',
    'material',
    'sleeveLength',
    'neckline',
    'fitType',
    'careInstructions',
    'characteristics',
    'details',
    'estimatedWeightGrams',
    'estimatedPackageLengthCm',
    'estimatedPackageWidthCm',
    'estimatedPackageHeightCm',
  ],
};

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : [];

const normalizeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const extractResponseText = (payload: GeminiGenerateContentResponse): string => {
  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .find((value) => value.trim().length > 0);

  if (!text) {
    throw new Error('Gemini no devolvió datos utilizable para el draft del producto.');
  }

  return text.trim();
};

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

const findAttributeValues = (category: SpreadsheetTemplateCategory, matcher: RegExp): string[] =>
  category.attributes.find((attribute) => matcher.test(normalizeComparable(attribute.name)))?.values || [];

const addSuggestion = (
  target: Record<string, ProductDraftValueSuggestion>,
  key: string,
  value: string | null,
  confidence: number,
  reasoning: string,
): void => {
  if (!value?.trim()) {
    return;
  }

  target[key] = {
    value: value.trim(),
    confidence,
    reasoning,
    source: 'gemini',
  };
};

const buildInferenceFromGemini = ({
  template,
  category,
  garment,
  payload,
}: {
  template: SpreadsheetTemplate;
  category: SpreadsheetTemplateCategory;
  garment: UploadedGarmentInput;
  payload: GeminiDraftExtractionPayload;
}): Record<string, ProductDraftValueSuggestion> => {
  const inferredValues: Record<string, ProductDraftValueSuggestion> = {};
  const title = normalizeText(payload.title);
  const description = normalizeText(payload.description);
  const brand = normalizeText(payload.brand);
  const primaryColor = normalizeText(payload.primaryColor);
  const sport = normalizeText(payload.sport);
  const material = normalizeText(payload.material);
  const sleeveLength = normalizeText(payload.sleeveLength);
  const neckline = normalizeText(payload.neckline);
  const fitType = normalizeText(payload.fitType);
  const careInstructions = normalizeText(payload.careInstructions);
  const characteristics = normalizeStringArray(payload.characteristics);
  const details = normalizeStringArray(payload.details);
  const estimatedWeightGrams = normalizeNumber(payload.estimatedWeightGrams);
  const estimatedPackageLengthCm = normalizeNumber(payload.estimatedPackageLengthCm);
  const estimatedPackageWidthCm = normalizeNumber(payload.estimatedPackageWidthCm);
  const estimatedPackageHeightCm = normalizeNumber(payload.estimatedPackageHeightCm);

  const brandOption = pickBestOption(template.brandOptions, [brand]);
  const colorOption = pickBestOption(findAttributeValues(category, /color/), [garment.matchedColor || null, primaryColor]);
  const materialOption = pickBestOption(findAttributeValues(category, /material|composicion/), [material]);
  const sleeveLengthOption = pickBestOption(findAttributeValues(category, /manga/), [sleeveLength]);
  const necklineOption = pickBestOption(findAttributeValues(category, /escote|cuello/), [neckline]);
  const fitTypeOption = pickBestOption(findAttributeValues(category, /ajuste/), [fitType]);
  const activityOption = pickBestOption(findAttributeValues(category, /actividad|deporte/), [sport]);
  const careOption = pickBestOption(findAttributeValues(category, /cuidado/), [careInstructions]);
  const characteristicOption = pickBestOption(findAttributeValues(category, /caracteristica/), characteristics);
  const detailOption = pickBestOption(findAttributeValues(category, /detalle/), details);

  category.columns.forEach((column) => {
    const normalizedKey = normalizeComparable(column.key);
    const normalizedLabel = normalizeComparable(column.label);
    const specificationAttributeName = getProductDraftSpecificationAttributeName(category, column);
    const isColorSpecificationValueColumn = Boolean(
      specificationAttributeName && normalizeComparable(specificationAttributeName).includes('color'),
    );

    if (normalizedKey.includes('default_product_name') || normalizedLabel.includes('nombre de producto')) {
      addSuggestion(inferredValues, column.key, title, 0.88, 'Sugerido por Gemini a partir de la prenda y la categoría.');
      return;
    }

    if (normalizedKey.includes('default_product_desc') || normalizedLabel.includes('descripcion del producto')) {
      addSuggestion(
        inferredValues,
        column.key,
        description,
        0.82,
        'Descripción comercial sugerida por Gemini a partir de la foto de la prenda.',
      );
      return;
    }

    if (normalizedKey.includes('brand') || normalizedLabel === 'marca') {
      addSuggestion(
        inferredValues,
        column.key,
        brandOption || brand,
        brandOption ? 0.9 : 0.55,
        brandOption
          ? 'Marca visible alineada con una opción válida del template.'
          : 'Marca sugerida por Gemini, pendiente de validación manual.',
      );
      return;
    }

    if (normalizedLabel.includes('color') || isColorSpecificationValueColumn) {
      addSuggestion(
        inferredValues,
        column.key,
        colorOption || garment.matchedColor || primaryColor,
        colorOption ? 0.9 : 0.6,
        colorOption
          ? 'Color visible alineado con un valor permitido del template.'
          : 'Color sugerido por Gemini, pendiente de validación manual.',
      );
      return;
    }

    if (normalizedLabel.includes('material') || normalizedLabel.includes('composicion')) {
      addSuggestion(
        inferredValues,
        column.key,
        materialOption || material,
        materialOption ? 0.76 : 0.52,
        'Material sugerido por Gemini según la apariencia textil.',
      );
      return;
    }

    if (normalizedLabel.includes('manga')) {
      addSuggestion(
        inferredValues,
        column.key,
        sleeveLengthOption || sleeveLength,
        sleeveLengthOption ? 0.78 : 0.55,
        'Longitud de manga sugerida por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('escote') || normalizedLabel.includes('cuello')) {
      addSuggestion(
        inferredValues,
        column.key,
        necklineOption || neckline,
        necklineOption ? 0.72 : 0.48,
        'Escote o cuello sugerido por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('ajuste')) {
      addSuggestion(
        inferredValues,
        column.key,
        fitTypeOption || fitType,
        fitTypeOption ? 0.68 : 0.44,
        'Tipo de ajuste sugerido por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('actividad') || normalizedLabel.includes('deporte')) {
      addSuggestion(
        inferredValues,
        column.key,
        activityOption || sport,
        activityOption ? 0.64 : 0.4,
        'Actividad o uso sugerido por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('cuidado')) {
      addSuggestion(
        inferredValues,
        column.key,
        careOption || careInstructions,
        careOption ? 0.74 : 0.46,
        'Instrucciones de cuidado sugeridas por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('caracteristica')) {
      addSuggestion(
        inferredValues,
        column.key,
        characteristicOption || characteristics[0] || null,
        characteristicOption ? 0.65 : 0.4,
        'Característica visible sugerida por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('detalle')) {
      addSuggestion(
        inferredValues,
        column.key,
        detailOption || details[0] || null,
        detailOption ? 0.6 : 0.38,
        'Detalle visual sugerido por Gemini.',
      );
      return;
    }

    if (normalizedLabel.includes('peso') && estimatedWeightGrams !== null) {
      addSuggestion(
        inferredValues,
        column.key,
        String(Math.round(estimatedWeightGrams)),
        0.18,
        'Estimación aproximada de Gemini; validar manualmente antes de exportar.',
      );
      return;
    }

    if ((normalizedLabel.includes('largo') || normalizedLabel.includes('longitud')) && estimatedPackageLengthCm !== null) {
      addSuggestion(
        inferredValues,
        column.key,
        String(Math.round(estimatedPackageLengthCm)),
        0.15,
        'Estimación aproximada de Gemini; validar manualmente antes de exportar.',
      );
      return;
    }

    if (normalizedLabel.includes('ancho') && estimatedPackageWidthCm !== null) {
      addSuggestion(
        inferredValues,
        column.key,
        String(Math.round(estimatedPackageWidthCm)),
        0.15,
        'Estimación aproximada de Gemini; validar manualmente antes de exportar.',
      );
      return;
    }

    if (normalizedLabel.includes('alto') && estimatedPackageHeightCm !== null) {
      addSuggestion(
        inferredValues,
        column.key,
        String(Math.round(estimatedPackageHeightCm)),
        0.15,
        'Estimación aproximada de Gemini; validar manualmente antes de exportar.',
      );
    }
  });

  return inferredValues;
};

const downloadStorageAsset = async (storagePath: string): Promise<{ mimeType: string; base64: string }> => {
  const [bytes] = await bucket.file(storagePath).download();
  const normalized = storagePath.toLowerCase();
  const mimeType = normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')
    ? 'image/jpeg'
    : normalized.endsWith('.webp')
      ? 'image/webp'
      : 'image/png';

  return {
    mimeType,
    base64: bytes.toString('base64'),
  };
};

const extractGeminiDraftPayload = async ({
  client,
  model,
  template,
  category,
  garment,
  userUid,
}: {
  client: Client;
  model: Model;
  template: SpreadsheetTemplate;
  category: SpreadsheetTemplateCategory;
  garment: UploadedGarmentInput;
  userUid: string;
}): Promise<GeminiDraftExtractionPayload> => {
  const photos = (garment.photos || []).slice(0, 3);
  const imageParts = await Promise.all(
    photos.map(async (photo) => {
      const image = await downloadStorageAsset(photo.storagePath);
      return {
        inline_data: {
          mime_type: image.mimeType,
          data: image.base64,
        },
      };
    }),
  );

  const promptSections = [
    'Analiza una prenda para preparar un borrador editable de carga masiva de marketplace.',
    'Devuelve SOLO JSON valido siguiendo el schema.',
    'No inventes datos operativos si no son visibles o no se pueden inferir con suficiente certeza.',
    'Si no estas seguro, devuelve null o un array vacio.',
    `Cliente: ${client.name}`,
    `Categoria del template: ${category.label}`,
    `Nombre de prenda interna: ${garment.name}`,
    garment.matchedColor ? `Color detectado previamente: ${garment.matchedColor}` : 'Color detectado previamente: sin dato.',
    `Marca visible esperable: ${template.brandOptions.slice(0, 25).join(', ') || 'sin catalogo de marcas'}`,
    model.identityTraits
      ? `Rasgos fisicos del modelo: sexo=${model.identityTraits.sex || 'sin dato'}, edad=${model.identityTraits.age || 'sin dato'}, tono_piel=${model.identityTraits.skin || 'sin dato'}, color_pelo=${model.identityTraits.hairColor || 'sin dato'}, largo_pelo=${model.identityTraits.hairLength || 'sin dato'}, complexion=${model.identityTraits.build || 'sin dato'}`
      : 'Rasgos fisicos del modelo: sin datos cargados.',
    `Campos editables del template: ${category.columns.map((column) => column.label).join(', ')}`,
    `Atributos validos destacados: ${category.attributes.slice(0, 18).map((attribute) => `${attribute.name}: ${attribute.values.slice(0, 12).join(' / ')}`).join(' | ')}`,
    'Genera un titulo y descripcion comercial en espanol.',
    'Intenta inferir color, tipo de prenda, deporte/uso, material, manga, cuello/escote, ajuste, cuidados, detalles y caracteristicas visibles.',
    'Si estimas peso o medidas de empaque, marcarlos solo si tienes evidencia razonable y sepas que son aproximados.',
  ];

  const { payload } = await callGeminiGenerateContent<GeminiGenerateContentResponse>({
    apiKey: GEMINI_API_KEY.value(),
    model: getGeminiImageReviewModel(),
    context: {
      feature: 'product_draft_enrichment',
      clientId: client.id || null,
      clientNameSnapshot: client.name,
      modelId: model.id || null,
      modelNameSnapshot: model.name,
      garmentId: garment.id,
      garmentName: garment.name,
      userUid,
    },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptSections.join('\n\n') },
            ...imageParts,
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: PRODUCT_DRAFT_RESPONSE_SCHEMA,
      },
    },
  });

  return JSON.parse(extractResponseText(payload)) as GeminiDraftExtractionPayload;
};

const buildSeedRow = (
  category: SpreadsheetTemplateCategory,
  inferredValues: Record<string, ProductDraftValueSuggestion>,
): ProductDraftRow => {
  const values = category.columns.reduce<Record<string, string>>((result, column) => {
    result[column.key] = resolveProductDraftColumnValue({
      category,
      column,
      rowValues: result,
      candidates: [inferredValues[column.key]?.value || null],
    });
    return result;
  }, {});

  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    values,
  };
};

const mapWithConcurrencyLimit = async <TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> => {
  const concurrency = Math.max(1, Math.trunc(limit) || 1);
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
};

const resolveDraftCategory = ({
  categoriesById,
  garment,
  fallbackCategoryId,
}: {
  categoriesById: Map<string, SpreadsheetTemplateCategory>;
  garment: UploadedGarmentInput;
  fallbackCategoryId?: string | null;
}): SpreadsheetTemplateCategory => {
  const requestedCategoryId = garment.matchedCategoryId || fallbackCategoryId || null;
  if (requestedCategoryId) {
    const category = categoriesById.get(requestedCategoryId);
    if (category) {
      return category;
    }
  }

  const [firstCategory] = categoriesById.values();
  if (!firstCategory) {
    throw new Error(`No hay categorías disponibles para preparar el draft de ${garment.name}.`);
  }

  return firstCategory;
};

export const buildPreviewProductDrafts = async ({
  client,
  model,
  template,
  categoriesById,
  garments,
  userUid,
  fallbackCategoryId,
  sourceSpreadsheet,
}: {
  client: Client;
  model: Model;
  template: SpreadsheetTemplate;
  categoriesById: Map<string, SpreadsheetTemplateCategory>;
  garments: UploadedGarmentInput[];
  userUid: string;
  fallbackCategoryId?: string | null;
  sourceSpreadsheet?: WizardSourceSpreadsheetInput | null;
}): Promise<{ productDrafts: ProductDraftInput[]; sourceSpreadsheetSummary: SourceSpreadsheetMatchSummary | null }> => {
  const sourceSpreadsheetMatch = sourceSpreadsheet
    ? await matchSourceSpreadsheetRowsToGarments({
        sourceSpreadsheet,
        garments,
        userUid,
      })
    : null;

  const productDrafts = await mapWithConcurrencyLimit(
    garments,
    PRODUCT_DRAFT_PREVIEW_CONCURRENCY,
    async (garment) => {
      const category = resolveDraftCategory({
        categoriesById,
        garment,
        fallbackCategoryId,
      });
      const geminiPayload = await extractGeminiDraftPayload({
        client,
        model,
        template,
        category,
        garment,
        userUid,
      });
      const inferredValues = buildInferenceFromGemini({
        template,
        category,
        garment,
        payload: geminiPayload,
      });
      const matchedSourceRow = sourceSpreadsheetMatch?.matchedRowByGarmentId.get(garment.id) || null;
      const sourceValues = buildSourceSpreadsheetSuggestions(category, matchedSourceRow);
      const mergedInferredValues = {
        ...inferredValues,
        ...sourceValues,
      };
      const sourceMatchedColor = resolveSourceSpreadsheetRowColor(matchedSourceRow, category);

      return {
        garmentId: garment.id,
        garmentName: garment.name,
        categoryId: category.id!,
        categoryName: category.label,
        matchedColor: sourceMatchedColor || garment.matchedColor || null,
        inferredValues: mergedInferredValues,
        rows: [buildSeedRow(category, mergedInferredValues)],
      };
    },
  );
  
  return {
    productDrafts,
    sourceSpreadsheetSummary: sourceSpreadsheetMatch?.summary || null,
  };
};

export const buildStoredProductDraft = ({
  batchId,
  client,
  model,
  template,
  category,
  garment,
  draftInput,
  createdByUid,
}: {
  batchId: string;
  client: Client;
  model: Model;
  template: SpreadsheetTemplate;
  category: SpreadsheetTemplateCategory;
  garment: UploadedGarmentInput;
  draftInput: ProductDraftInput;
  createdByUid: string;
}): Omit<ProductDraft, 'id' | 'createdAt' | 'updatedAt'> => ({
  batchId,
  clientId: client.id!,
  clientNameSnapshot: client.name,
  modelId: model.id!,
  modelNameSnapshot: model.name,
  templateId: template.id!,
  templateNameSnapshot: template.name,
  categoryId: category.id!,
  categoryNameSnapshot: category.label,
  garmentId: garment.id,
  garmentName: garment.name,
  garmentFilePath: garment.storagePath,
  garmentPhotoId: garment.photos?.[0]?.id || null,
  garmentPhotoFileName: garment.photos?.[0]?.fileName || null,
  matchedColor: draftInput.matchedColor || garment.matchedColor || null,
  inferredValues: draftInput.inferredValues || {},
  rows: draftInput.rows,
  originalImages: (garment.photos || []).map((photo) => ({
    photoId: photo.id,
    fileName: photo.fileName,
    storagePath: photo.storagePath,
    view: photo.view || null,
    sourceIndex: photo.sourceIndex,
  })),
  generatedImages: [],
  createdByUid,
  updatedByUid: createdByUid,
});
