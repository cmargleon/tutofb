import * as admin from 'firebase-admin';
import { UploadedGarmentInput } from '../../../shared/src/types';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { GEMINI_API_KEY, getGeminiImageReviewModel } from '../config/runtime';
import { findBestCellValue, normalizeBoolean, normalizeText } from './sourceSpreadsheetColumns';
import { GeminiMatchFingerprintPayload, ImageMatchFingerprint, ParsedSourceSpreadsheetRow } from './sourceSpreadsheetTypes';
import { mimeTypeFromPath } from './sourceSpreadsheetWorkbook';

export const getBucket = () => admin.storage().bucket();
export const MATCH_FINGERPRINT_CONCURRENCY = 2;

export const MATCH_FINGERPRINT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    garmentType: { type: ['string', 'null'] },
    primaryColor: { type: ['string', 'null'] },
    secondaryColor: { type: ['string', 'null'] },
    visibleBrand: { type: ['string', 'null'] },
    visibleText: { type: ['string', 'null'] },
    pattern: { type: ['string', 'null'] },
    hasHood: { type: ['boolean', 'null'] },
    sleeveLength: { type: ['string', 'null'] },
  },
  required: [
    'garmentType',
    'primaryColor',
    'secondaryColor',
    'visibleBrand',
    'visibleText',
    'pattern',
    'hasHood',
    'sleeveLength',
  ],
};

export const normalizeFingerprint = (payload: GeminiMatchFingerprintPayload): ImageMatchFingerprint => ({
  garmentType: normalizeText(payload.garmentType),
  primaryColor: normalizeText(payload.primaryColor),
  secondaryColor: normalizeText(payload.secondaryColor),
  visibleBrand: normalizeText(payload.visibleBrand),
  visibleText: normalizeText(payload.visibleText),
  pattern: normalizeText(payload.pattern),
  hasHood: normalizeBoolean(payload.hasHood),
  sleeveLength: normalizeText(payload.sleeveLength),
});

export const extractResponseText = (payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string => {
  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .find((value) => value.trim().length > 0);

  if (!text) {
    throw new Error('Gemini no devolvió datos utilizable para el matching del spreadsheet fuente.');
  }

  return text.trim();
};

export const buildFingerprintPrompt = (label: string, contextLines: string[]): string => [
  `Analiza una foto de prenda para matching de catálogo: ${label}.`,
  'Devuelve SOLO JSON válido con rasgos visibles y deja null cuando no sea claro.',
  'No inventes marca, texto, color secundario ni patrón si no se ven con suficiente certeza.',
  'Usa español para colores y tipo de prenda.',
  ...contextLines,
].join('\n');

export const extractImageFingerprint = async ({
  label,
  contextLines,
  imageParts,
  garmentId,
  garmentName,
  userUid,
}: {
  label: string;
  contextLines: string[];
  imageParts: Array<{ inline_data: { mime_type: string; data: string } }>;
  garmentId: string;
  garmentName: string;
  userUid: string;
}): Promise<ImageMatchFingerprint> => {
  const { payload } = await callGeminiGenerateContent<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>({
    apiKey: GEMINI_API_KEY.value(),
    model: getGeminiImageReviewModel(),
    context: {
      feature: 'spreadsheet_source_matching',
      garmentId,
      garmentName,
      userUid,
    },
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildFingerprintPrompt(label, contextLines) },
            ...imageParts,
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: MATCH_FINGERPRINT_RESPONSE_SCHEMA,
      },
    },
  });

  return normalizeFingerprint(JSON.parse(extractResponseText(payload)) as GeminiMatchFingerprintPayload);
};

export const mapWithConcurrencyLimit = async <TInput, TOutput>(
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

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
};

export const pickGarmentPhotosForFingerprint = (garment: UploadedGarmentInput) => {
  const preferred = [...(garment.photos || [])].sort((left, right) => {
    if (left.view === 'front' && right.view !== 'front') {
      return -1;
    }
    if (left.view !== 'front' && right.view === 'front') {
      return 1;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  return preferred.slice(0, 2);
};

export const downloadStorageAsset = async (storagePath: string): Promise<{ mimeType: string; base64: string }> => {
  const [bytes] = await getBucket().file(storagePath).download();
  return {
    mimeType: mimeTypeFromPath(storagePath),
    base64: bytes.toString('base64'),
  };
};

export const fingerprintSourceRows = async (
  rows: ParsedSourceSpreadsheetRow[],
  userUid: string,
): Promise<ParsedSourceSpreadsheetRow[]> =>
  mapWithConcurrencyLimit(rows, MATCH_FINGERPRINT_CONCURRENCY, async (row) => {
    if (!row.image) {
      return row;
    }

    const contextLines = [
      row.spu ? `SPU visible en la fila: ${row.spu}` : 'SPU visible en la fila: sin dato',
      (() => {
        const title = findBestCellValue(row.cells, [/nombre del producto/, /^nombre$/, /product name/, /titulo/]);
        return title ? `Nombre visible en la fila: ${title}` : 'Nombre visible en la fila: sin dato';
      })(),
      (() => {
        const color = findBestCellValue(row.cells, [/^color$/, /\bcolor\b/]);
        return color ? `Color escrito en la fila: ${color}` : 'Color escrito en la fila: sin dato';
      })(),
    ];

    const fingerprint = await extractImageFingerprint({
      label: `fila ${row.rowNumber} del spreadsheet fuente`,
      contextLines,
      imageParts: [
        {
          inline_data: {
            mime_type: row.image.mimeType,
            data: row.image.base64,
          },
        },
      ],
      garmentId: row.rowId,
      garmentName: `spreadsheet_row_${row.rowNumber}`,
      userUid,
    });

    return {
      ...row,
      fingerprint,
    };
  });

export const fingerprintGarments = async (
  garments: UploadedGarmentInput[],
  userUid: string,
): Promise<Map<string, ImageMatchFingerprint>> => {
  const entries = await mapWithConcurrencyLimit(garments, MATCH_FINGERPRINT_CONCURRENCY, async (garment) => {
    const photos = pickGarmentPhotosForFingerprint(garment);
    const imageParts = await Promise.all(
      photos.map(async (photo) => {
        const downloaded = await downloadStorageAsset(photo.storagePath);
        return {
          inline_data: {
            mime_type: downloaded.mimeType,
            data: downloaded.base64,
          },
        };
      }),
    );

    const fingerprint = await extractImageFingerprint({
      label: `prenda del wizard ${garment.name}`,
      contextLines: [
        garment.matchedCategoryLabel ? `Categoría detectada: ${garment.matchedCategoryLabel}` : 'Categoría detectada: sin dato',
        garment.matchedColor ? `Color detectado: ${garment.matchedColor}` : 'Color detectado: sin dato',
      ],
      imageParts,
      garmentId: garment.id,
      garmentName: garment.name,
      userUid,
    });

    return [garment.id, fingerprint] as const;
  });

  return new Map(entries);
};
