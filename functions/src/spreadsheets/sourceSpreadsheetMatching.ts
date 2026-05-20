import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import {
  ProductDraftValueSuggestion,
  SourceSpreadsheetMatchSummary,
  SpreadsheetTemplateCategory,
  UploadedGarmentInput,
  WizardSourceSpreadsheetInput,
} from '../../../shared/src/types';
import { getProductDraftSpecificationAttributeName } from '../../../shared/src/utils/spreadsheetDraftColumns';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { GEMINI_API_KEY, getGeminiImageReviewModel } from '../config/runtime';

const getBucket = () => admin.storage().bucket();
const MATCH_FINGERPRINT_CONCURRENCY = 2;
const MIN_AUTO_MATCH_SCORE = 34;
const HIGH_CONFIDENCE_MATCH_SCORE = 56;

type SourceColumnRole =
  | 'photo'
  | 'code'
  | 'productName'
  | 'description'
  | 'color'
  | 'size'
  | 'stock'
  | 'price'
  | 'weight'
  | 'length'
  | 'width'
  | 'height'
  | 'brand'
  | 'origin'
  | 'ipCharacter';

type SourceMatchStrategy = 'image' | 'text' | 'mixed';

interface WorkbookFileEntry {
  content?: unknown;
}

interface ImageMatchFingerprint {
  garmentType: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  visibleBrand: string | null;
  visibleText: string | null;
  pattern: string | null;
  hasHood: boolean | null;
  sleeveLength: string | null;
}

interface ParsedSourceSpreadsheetCell {
  header: string;
  normalizedHeader: string;
  value: string;
  columnIndex: number;
  role: SourceColumnRole | null;
}

interface ParsedSourceSpreadsheetImage {
  rowNumber: number;
  columnIndex: number;
  base64: string;
  mimeType: string;
}

interface ParsedSourceSpreadsheetRow {
  rowId: string;
  rowNumber: number;
  spu: string | null;
  codeValues: string[];
  productName: string | null;
  description: string | null;
  color: string | null;
  searchableText: string;
  cells: ParsedSourceSpreadsheetCell[];
  image: ParsedSourceSpreadsheetImage | null;
  fingerprint: ImageMatchFingerprint | null;
}

interface MatchedSourceSpreadsheetRow {
  row: ParsedSourceSpreadsheetRow;
  score: number;
  strategy: SourceMatchStrategy;
  evidence: string[];
}

interface MatchedSourceSpreadsheetRowsResult {
  matchedRowByGarmentId: Map<string, MatchedSourceSpreadsheetRow>;
  summary: SourceSpreadsheetMatchSummary;
}

interface GeminiMatchFingerprintPayload {
  garmentType?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  visibleBrand?: unknown;
  visibleText?: unknown;
  pattern?: unknown;
  hasHood?: unknown;
  sleeveLength?: unknown;
}

const MATCH_FINGERPRINT_RESPONSE_SCHEMA = {
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

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeCellString = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.replace(/_x000D_/g, '\n').trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const SOURCE_HEADER_ALIASES: Record<SourceColumnRole, RegExp[]> = {
  photo: [/^foto$/, /\bfoto\b/, /^image$/, /\bimage\b/, /imagen/, /picture/, /photo/],
  code: [
    /^spu$/,
    /\bspu\b/,
    /^sku$/,
    /\bsku\b/,
    /seller sku/,
    /supplier sku/,
    /^modelo$/,
    /\bmodelo\b/,
    /^model$/,
    /\bmodel\b/,
    /codigo/,
    /c[oó]digo/,
    /\bcode\b/,
    /referencia/,
    /^ref$/,
    /\bitem\b/,
  ],
  productName: [/nombre del producto/, /^nombre$/, /product name/, /titulo/, /title/, /^producto$/, /\bproducto\b/],
  description: [/descripcion/, /descripci[oó]n/, /detalle/, /details?/, /concepto/],
  color: [/^color$/, /\bcolor\b/, /colour/],
  size: [/^talla$/, /\bsize\b/, /medida/, /tamano/, /tamaño/],
  stock: [/^stock$/, /inventario/, /existencia/, /quantity/, /\bqty\b/, /cantidad/],
  price: [
    /precio minimo/,
    /precio mínimo/,
    /min price/,
    /^precio$/,
    /\bprecio\b/,
    /\bprice\b/,
    /costo/,
    /\bcost\b/,
    /iva incluido/,
    /importe/,
    /monto/,
  ],
  weight: [/peso/, /weight/, /peso gr/],
  length: [/largo/, /longitud/, /length/],
  width: [/ancho/, /width/],
  height: [/alto/, /height/],
  brand: [/^marca$/, /\bbrand\b/],
  origin: [/^origen$/, /\borigin\b/, /pais de origen/, /pa[ií]s de origen/, /country of origin/],
  ipCharacter: [/propiedad intelectual/, /\bip\b/, /character/, /personaje/, /licencia/],
};

const SOURCE_ROLE_LABELS: Record<SourceColumnRole, string> = {
  photo: 'foto',
  code: 'codigo/modelo',
  productName: 'nombre',
  description: 'descripcion',
  color: 'color',
  size: 'talla',
  stock: 'stock',
  price: 'precio/costo',
  weight: 'peso',
  length: 'largo',
  width: 'ancho',
  height: 'alto',
  brand: 'marca',
  origin: 'origen',
  ipCharacter: 'propiedad intelectual',
};

const SOURCE_ROLE_WEIGHTS: Record<SourceColumnRole, number> = {
  photo: 4,
  code: 4,
  productName: 3,
  description: 3,
  color: 2,
  size: 2,
  stock: 2,
  price: 2,
  weight: 1,
  length: 1,
  width: 1,
  height: 1,
  brand: 2,
  origin: 1,
  ipCharacter: 1,
};

const detectSourceColumnRole = (header: string): SourceColumnRole | null => {
  const normalized = normalizeComparable(header);
  if (!normalized) {
    return null;
  }

  const orderedRoles: SourceColumnRole[] = [
    'photo',
    'code',
    'productName',
    'description',
    'color',
    'size',
    'stock',
    'price',
    'weight',
    'length',
    'width',
    'height',
    'brand',
    'origin',
    'ipCharacter',
  ];
  return orderedRoles.find((role) => SOURCE_HEADER_ALIASES[role].some((matcher) => matcher.test(normalized))) || null;
};

const normalizeFingerprint = (payload: GeminiMatchFingerprintPayload): ImageMatchFingerprint => ({
  garmentType: normalizeText(payload.garmentType),
  primaryColor: normalizeText(payload.primaryColor),
  secondaryColor: normalizeText(payload.secondaryColor),
  visibleBrand: normalizeText(payload.visibleBrand),
  visibleText: normalizeText(payload.visibleText),
  pattern: normalizeText(payload.pattern),
  hasHood: normalizeBoolean(payload.hasHood),
  sleeveLength: normalizeText(payload.sleeveLength),
});

const workbookFilesOf = (workbook: XLSX.WorkBook): Record<string, WorkbookFileEntry> =>
  (workbook as XLSX.WorkBook & { files?: Record<string, WorkbookFileEntry> }).files || {};

const resolveRelativeXmlPath = (basePath: string, target: string): string => {
  if (target.startsWith('/')) {
    return target.replace(/^\/+/, '');
  }

  const segments = basePath.split('/');
  segments.pop();

  target.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return;
    }
    if (segment === '..') {
      segments.pop();
      return;
    }
    segments.push(segment);
  });

  return segments.join('/');
};

const getWorkbookSheetXmlPathMap = (workbook: XLSX.WorkBook): Map<string, string> => {
  const workbookFiles = workbookFilesOf(workbook);
  const workbookFile = workbookFiles['xl/workbook.xml'];
  const workbookRelsFile = workbookFiles['xl/_rels/workbook.xml.rels'];
  if (!workbookFile?.content || !workbookRelsFile?.content) {
    return new Map();
  }

  const workbookXml = String(workbookFile.content);
  const workbookRelsXml = String(workbookRelsFile.content);
  const relationshipTargetById = new Map<string, string>();

  for (const match of workbookRelsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*Type="[^"]*worksheet"/g)) {
    relationshipTargetById.set(match[1], `xl/${match[2]}`);
  }

  const sheetPathByName = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const sheetName = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const relationshipId = match[2];
    const target = relationshipTargetById.get(relationshipId);
    if (target) {
      sheetPathByName.set(sheetName, target);
    }
  }

  return sheetPathByName;
};

const mimeTypeFromPath = (filePath: string): string => {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }
  if (normalized.endsWith('.gif')) {
    return 'image/gif';
  }
  return 'image/png';
};

const toBuffer = (value: unknown): Buffer | null => {
  if (!value) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === 'string') {
    return Buffer.from(value, 'binary');
  }
  return null;
};

const toSheetRows = (worksheet: XLSX.WorkSheet): string[][] =>
  (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][]).map((row) => row.map((cell) => normalizeCellString(cell)));

const pickHeaderRowIndex = (rows: string[][]): number => {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.slice(0, 8).forEach((row, index) => {
    const score = row.reduce((total, cell) => {
      const role = detectSourceColumnRole(cell);
      return role ? total + SOURCE_ROLE_WEIGHTS[role] : total;
    }, 0);

    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex;
};

const pickSourceSheetName = (workbook: XLSX.WorkBook): string => {
  const rowsBySheet = workbook.SheetNames.map((sheetName) => ({
    sheetName,
    rows: toSheetRows(workbook.Sheets[sheetName]!),
  }));
  const scoredSheets = rowsBySheet.map(({ sheetName, rows }) => {
    const headerRow = rows[pickHeaderRowIndex(rows)] || [];
    const headerScore = headerRow.reduce((score, cell) => {
      const role = detectSourceColumnRole(cell);
      return role ? score + SOURCE_ROLE_WEIGHTS[role] : score;
    }, 0);
    return { sheetName, score: headerScore };
  });

  scoredSheets.sort((left, right) => right.score - left.score);
  return scoredSheets[0]?.sheetName || workbook.SheetNames[0]!;
};

const getSheetDrawingPath = (workbook: XLSX.WorkBook, sheetName: string): string | null => {
  const workbookFiles = workbookFilesOf(workbook);
  const sheetPath = getWorkbookSheetXmlPathMap(workbook).get(sheetName);
  if (!sheetPath) {
    return null;
  }

  const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const relsXml = workbookFiles[relsPath]?.content ? String(workbookFiles[relsPath]!.content) : '';
  const match = relsXml.match(/<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/);
  if (!match?.[1]) {
    return null;
  }

  return resolveRelativeXmlPath(sheetPath, match[1]);
};

const extractSheetImages = (workbook: XLSX.WorkBook, sheetName: string): ParsedSourceSpreadsheetImage[] => {
  const workbookFiles = workbookFilesOf(workbook);
  const drawingPath = getSheetDrawingPath(workbook, sheetName);
  if (!drawingPath) {
    return [];
  }

  const drawingXml = workbookFiles[drawingPath]?.content ? String(workbookFiles[drawingPath]!.content) : '';
  if (!drawingXml) {
    return [];
  }

  const drawingRelsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const drawingRelsXml = workbookFiles[drawingRelsPath]?.content ? String(workbookFiles[drawingRelsPath]!.content) : '';
  const mediaTargetByRelationId = new Map<string, string>();

  for (const match of drawingRelsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    mediaTargetByRelationId.set(match[1], resolveRelativeXmlPath(drawingPath, match[2]));
  }

  const images: ParsedSourceSpreadsheetImage[] = [];
  for (const match of drawingXml.matchAll(/<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>[\s\S]*?<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
    const columnIndex = Number(match[1]);
    const rowNumber = Number(match[2]) + 1;
    const relationId = match[3];
    const mediaPath = mediaTargetByRelationId.get(relationId);
    const mediaBuffer = mediaPath ? toBuffer(workbookFiles[mediaPath]?.content) : null;
    if (!mediaPath || !mediaBuffer) {
      continue;
    }

    images.push({
      rowNumber,
      columnIndex,
      mimeType: mimeTypeFromPath(mediaPath),
      base64: mediaBuffer.toString('base64'),
    });
  }

  return images;
};

const findBestCellValue = (cells: ParsedSourceSpreadsheetCell[], matchers: RegExp[]): string | null => {
  for (const matcher of matchers) {
    const match = cells.find((cell) => matcher.test(cell.normalizedHeader) && cell.value.trim());
    if (match) {
      return match.value.trim();
    }
  }
  return null;
};

const findMatchingCellValues = (cells: ParsedSourceSpreadsheetCell[], matchers: RegExp[]): string[] => {
  const results: string[] = [];

  matchers.forEach((matcher) => {
    cells.forEach((cell) => {
      if (!matcher.test(cell.normalizedHeader) || !cell.value.trim()) {
        return;
      }

      const value = cell.value.trim();
      if (!results.includes(value)) {
        results.push(value);
      }
    });
  });

  return results;
};

const findBestRoleValue = (cells: ParsedSourceSpreadsheetCell[], roles: SourceColumnRole[]): string | null => {
  const roleMatch = cells.find((cell) => cell.role && roles.includes(cell.role) && cell.value.trim());
  if (roleMatch) {
    return roleMatch.value.trim();
  }

  return findBestCellValue(cells, roles.flatMap((role) => SOURCE_HEADER_ALIASES[role]));
};

const findRoleValues = (cells: ParsedSourceSpreadsheetCell[], roles: SourceColumnRole[]): string[] => {
  const results = new Set<string>();
  cells.forEach((cell) => {
    if (cell.role && roles.includes(cell.role) && cell.value.trim()) {
      results.add(cell.value.trim());
    }
  });
  findMatchingCellValues(cells, roles.flatMap((role) => SOURCE_HEADER_ALIASES[role])).forEach((value) => results.add(value));
  return [...results];
};

const buildRowSearchableText = (cells: ParsedSourceSpreadsheetCell[]): string =>
  cells
    .filter((cell) => cell.role !== 'photo')
    .map((cell) => cell.value)
    .join(' ');

const hasUsefulSourceText = (row: Pick<ParsedSourceSpreadsheetRow, 'codeValues' | 'productName' | 'description' | 'color' | 'searchableText'>): boolean =>
  row.codeValues.length > 0
  || Boolean(row.productName)
  || Boolean(row.description)
  || Boolean(row.color)
  || normalizeComparable(row.searchableText).length >= 3;

export const buildSourceSpreadsheetRows = (
  workbook: XLSX.WorkBook,
): {
  rows: ParsedSourceSpreadsheetRow[];
  totalRows: number;
  directRowsWithPhotos: number;
  ignoredRows: number;
  reusedSpuPhotoRows: number;
  sheetName: string;
  headerRowNumber: number;
  textOnlyRows: number;
  detectedColumns: string[];
} => {
  const sheetName = pickSourceSheetName(workbook);
  const sheetRows = toSheetRows(workbook.Sheets[sheetName]!);
  const headerRowIndex = pickHeaderRowIndex(sheetRows);
  const headers = (sheetRows[headerRowIndex] || []).map((header, index) => header || `columna_${index + 1}`);
  const detectedColumns = [...new Set(headers.map(detectSourceColumnRole).filter((role): role is SourceColumnRole => Boolean(role)).map((role) => SOURCE_ROLE_LABELS[role]))];
  const photoColumnIndex = headers.findIndex((header) => detectSourceColumnRole(header) === 'photo');
  const images = extractSheetImages(workbook, sheetName);
  const directImagesByRow = images.reduce<Map<number, ParsedSourceSpreadsheetImage[]>>((result, image) => {
    const bucketForRow = result.get(image.rowNumber) || [];
    bucketForRow.push(image);
    result.set(image.rowNumber, bucketForRow);
    return result;
  }, new Map());

  const rawRows = sheetRows.slice(headerRowIndex + 1).map((rowValues, index) => {
    const rowNumber = headerRowIndex + index + 2;
    const cells = headers.reduce<ParsedSourceSpreadsheetCell[]>((result, header, columnIndex) => {
      const value = normalizeCellString(rowValues[columnIndex]);
      if (!value) {
        return result;
      }

      const role = detectSourceColumnRole(header);
      result.push({
        header,
        normalizedHeader: normalizeComparable(header),
        value,
        columnIndex,
        role,
      });
      return result;
    }, []);

    const candidateImages = directImagesByRow.get(rowNumber) || [];
    const directImage = candidateImages.length === 0
      ? null
      : [...candidateImages].sort((left, right) => {
          if (photoColumnIndex < 0) {
            return left.columnIndex - right.columnIndex;
          }
          return Math.abs(left.columnIndex - photoColumnIndex) - Math.abs(right.columnIndex - photoColumnIndex);
        })[0] || null;

    const codeValues = findRoleValues(cells, ['code']);
    const productName = findBestRoleValue(cells, ['productName']);
    const description = findBestRoleValue(cells, ['description']);
    const color = findBestRoleValue(cells, ['color']);
    const searchableText = buildRowSearchableText(cells);
    const spu = codeValues[0] || null;
    return {
      rowId: `row-${rowNumber}`,
      rowNumber,
      spu,
      codeValues,
      productName,
      description,
      color,
      searchableText,
      cells,
      image: directImage,
    };
  }).filter((row) => row.cells.length > 0 || row.image);

  const rowsByNormalizedSpu = rawRows.reduce<Map<string, typeof rawRows>>((result, row) => {
    const normalizedSpu = row.spu ? normalizeComparable(row.spu) : '';
    if (!normalizedSpu) {
      return result;
    }
    const bucketForSpu = result.get(normalizedSpu) || [];
    bucketForSpu.push(row);
    result.set(normalizedSpu, bucketForSpu);
    return result;
  }, new Map());

  let ignoredRows = 0;
  let reusedSpuPhotoRows = 0;
  const preparedRows = rawRows.reduce<ParsedSourceSpreadsheetRow[]>((result, row) => {
    if (row.image) {
      result.push({ ...row, fingerprint: null });
      return result;
    }

    const normalizedSpu = row.spu ? normalizeComparable(row.spu) : '';
    if (!normalizedSpu) {
      if (hasUsefulSourceText(row)) {
        result.push({ ...row, fingerprint: null });
      } else {
        ignoredRows += 1;
      }
      return result;
    }

    const rowsForSpu = rowsByNormalizedSpu.get(normalizedSpu) || [];
    if (rowsForSpu.length <= 1) {
      if (hasUsefulSourceText(row)) {
        result.push({ ...row, fingerprint: null });
      } else {
        ignoredRows += 1;
      }
      return result;
    }

    const representative = rowsForSpu.find((candidate) => candidate.image);
    if (!representative?.image) {
      if (hasUsefulSourceText(row)) {
        result.push({ ...row, fingerprint: null });
      } else {
        ignoredRows += 1;
      }
      return result;
    }

    reusedSpuPhotoRows += 1;
    result.push({
      ...row,
      image: representative.image,
      fingerprint: null,
    });
    return result;
  }, []);

  return {
    rows: preparedRows,
    totalRows: rawRows.length,
    directRowsWithPhotos: rawRows.filter((row) => Boolean(row.image)).length,
    ignoredRows,
    reusedSpuPhotoRows,
    sheetName,
    headerRowNumber: headerRowIndex + 1,
    textOnlyRows: preparedRows.filter((row) => !row.image).length,
    detectedColumns,
  };
};

const extractResponseText = (payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string => {
  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .find((value) => value.trim().length > 0);

  if (!text) {
    throw new Error('Gemini no devolvió datos utilizable para el matching del spreadsheet fuente.');
  }

  return text.trim();
};

const buildFingerprintPrompt = (label: string, contextLines: string[]): string => [
  `Analiza una foto de prenda para matching de catálogo: ${label}.`,
  'Devuelve SOLO JSON válido con rasgos visibles y deja null cuando no sea claro.',
  'No inventes marca, texto, color secundario ni patrón si no se ven con suficiente certeza.',
  'Usa español para colores y tipo de prenda.',
  ...contextLines,
].join('\n');

const extractImageFingerprint = async ({
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

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
};

const pickGarmentPhotosForFingerprint = (garment: UploadedGarmentInput) => {
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

const downloadStorageAsset = async (storagePath: string): Promise<{ mimeType: string; base64: string }> => {
  const [bytes] = await getBucket().file(storagePath).download();
  return {
    mimeType: mimeTypeFromPath(storagePath),
    base64: bytes.toString('base64'),
  };
};

const fingerprintSourceRows = async (
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

const fingerprintGarments = async (
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

const textSimilarityScore = (left: string | null, right: string | null, exactScore: number, partialScore: number): number => {
  if (!left || !right) {
    return 0;
  }

  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return exactScore;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return partialScore;
  }

  return 0;
};

const comparableTokens = (value: string | null | undefined): Set<string> =>
  new Set(
    normalizeComparable(value || '')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );

const tokenOverlapScore = (left: string | null | undefined, right: string | null | undefined, maxScore: number): number => {
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  return Math.round(maxScore * Math.min(1, overlap / denominator));
};

const buildGarmentSearchText = (
  garment: UploadedGarmentInput,
  garmentFingerprint: ImageMatchFingerprint | null,
): string => [
  garment.name,
  ...(garment.originalFileNames || []),
  garment.matchedCategoryLabel || '',
  garment.matchedColor || '',
  garmentFingerprint?.garmentType || '',
  garmentFingerprint?.primaryColor || '',
  garmentFingerprint?.visibleBrand || '',
  garmentFingerprint?.visibleText || '',
  garmentFingerprint?.pattern || '',
].join(' ');

interface MatchScoreResult {
  score: number;
  strategy: SourceMatchStrategy;
  evidence: string[];
}

const computeMatchScore = (
  row: ParsedSourceSpreadsheetRow,
  garment: UploadedGarmentInput,
  garmentFingerprint: ImageMatchFingerprint | null,
): MatchScoreResult => {
  const rowFingerprint = row.fingerprint;
  const evidence: string[] = [];
  const garmentText = buildGarmentSearchText(garment, garmentFingerprint);
  let score = 0;

  row.codeValues.forEach((codeValue) => {
    const codeScore = Math.max(
      textSimilarityScore(codeValue, garment.name, 72, 42),
      ...(garment.originalFileNames || []).map((fileName) => textSimilarityScore(codeValue, fileName, 72, 42)),
    );
    if (codeScore > 0) {
      score += codeScore;
      evidence.push(`codigo/modelo coincide: ${codeValue}`);
    }
  });

  const descriptionScore = Math.max(
    tokenOverlapScore(row.productName, garmentText, 26),
    tokenOverlapScore(row.description, garmentText, 24),
    tokenOverlapScore(row.searchableText, garmentText, 18),
  );
  if (descriptionScore > 0) {
    score += descriptionScore;
    evidence.push('texto descriptivo compatible');
  }

  const rowColor = row.color || findBestCellValue(row.cells, SOURCE_HEADER_ALIASES.color);
  const colorScore = textSimilarityScore(rowColor, garment.matchedColor || garmentFingerprint?.primaryColor || null, 18, 9);
  if (colorScore > 0) {
    score += colorScore;
    evidence.push(`color compatible: ${rowColor}`);
  }

  if (rowFingerprint && garmentFingerprint) {
    const imageScore =
      textSimilarityScore(rowFingerprint.garmentType, garmentFingerprint.garmentType, 30, 18)
      + textSimilarityScore(rowFingerprint.primaryColor, garmentFingerprint.primaryColor, 24, 12)
      + textSimilarityScore(rowFingerprint.secondaryColor, garmentFingerprint.secondaryColor, 8, 4)
      + textSimilarityScore(rowFingerprint.visibleBrand, garmentFingerprint.visibleBrand, 20, 10)
      + textSimilarityScore(rowFingerprint.visibleText, garmentFingerprint.visibleText, 26, 14)
      + textSimilarityScore(rowFingerprint.pattern, garmentFingerprint.pattern, 10, 5)
      + textSimilarityScore(rowFingerprint.garmentType, garment.matchedCategoryLabel || null, 16, 8);

    if (imageScore > 0) {
      score += imageScore;
      evidence.push('huella visual compatible');
    }

    if (rowFingerprint.hasHood !== null && garmentFingerprint.hasHood !== null) {
      const hoodScore = rowFingerprint.hasHood === garmentFingerprint.hasHood ? 10 : -12;
      score += hoodScore;
      if (hoodScore > 0) {
        evidence.push('capucha coincide');
      }
    }

    if (rowFingerprint.sleeveLength && garmentFingerprint.sleeveLength) {
      const sleeveScore = textSimilarityScore(rowFingerprint.sleeveLength, garmentFingerprint.sleeveLength, 8, 4);
      score += sleeveScore;
      if (sleeveScore > 0) {
        evidence.push('largo de manga compatible');
      }
    }
  }

  const strategy: SourceMatchStrategy = rowFingerprint && score > descriptionScore + colorScore ? (descriptionScore > 0 ? 'mixed' : 'image') : 'text';
  return {
    score,
    strategy,
    evidence,
  };
};

const resolveMatchedRowByGarment = (
  rows: ParsedSourceSpreadsheetRow[],
  garments: UploadedGarmentInput[],
  garmentFingerprintsById: Map<string, ImageMatchFingerprint>,
): Map<string, MatchedSourceSpreadsheetRow> => {
  const candidatePairs = rows.flatMap((row) =>
    garments.map((garment) => {
      const match = computeMatchScore(row, garment, garmentFingerprintsById.get(garment.id) || null);
      return {
        row,
        garment,
        ...match,
      };
    }),
  );

  candidatePairs.sort((left, right) => right.score - left.score);
  const assignedGarments = new Set<string>();
  const assignedRows = new Set<string>();
  const matchedByGarmentId = new Map<string, MatchedSourceSpreadsheetRow>();

  candidatePairs.forEach(({ row, garment, score, strategy, evidence }) => {
    if (score < MIN_AUTO_MATCH_SCORE || assignedGarments.has(garment.id) || assignedRows.has(row.rowId)) {
      return;
    }

    matchedByGarmentId.set(garment.id, { row, score, strategy, evidence });
    assignedGarments.add(garment.id);
    assignedRows.add(row.rowId);
  });

  return matchedByGarmentId;
};

const getSourceValueAliases = (column: Pick<SpreadsheetTemplateCategory, 'label'>['label'], key: string): RegExp[] => {
  const normalizedLabel = normalizeComparable(column);
  const normalizedKey = normalizeComparable(key);

  if (normalizedKey.includes('spu') || normalizedKey.includes('sku') || normalizedLabel.includes('spu') || normalizedLabel.includes('sku')) {
    return SOURCE_HEADER_ALIASES.code;
  }
  if (normalizedLabel.includes('nombre de producto') || normalizedKey.includes('default product name')) {
    return SOURCE_HEADER_ALIASES.productName;
  }
  if (normalizedLabel.includes('descripcion del producto') || normalizedKey.includes('default product desc')) {
    return SOURCE_HEADER_ALIASES.description;
  }
  if (normalizedLabel.includes('color')) {
    return SOURCE_HEADER_ALIASES.color;
  }
  if (normalizedLabel.includes('talla') || normalizedKey.includes('size')) {
    return SOURCE_HEADER_ALIASES.size;
  }
  if (normalizedLabel.includes('stock')) {
    return SOURCE_HEADER_ALIASES.stock;
  }
  if (normalizedLabel.includes('precio') || normalizedLabel.includes('costo')) {
    return SOURCE_HEADER_ALIASES.price;
  }
  if (normalizedLabel.includes('peso')) {
    return SOURCE_HEADER_ALIASES.weight;
  }
  if (normalizedLabel.includes('largo') || normalizedLabel.includes('longitud')) {
    return SOURCE_HEADER_ALIASES.length;
  }
  if (normalizedLabel.includes('ancho') || normalizedKey.includes('width')) {
    return SOURCE_HEADER_ALIASES.width;
  }
  if (normalizedLabel.includes('alto') || normalizedKey.includes('height')) {
    return SOURCE_HEADER_ALIASES.height;
  }

  return [
    new RegExp(normalizedLabel.replace(/\s+/g, '\\s+')),
    new RegExp(normalizedKey.replace(/\s+/g, '\\s+')),
  ];
};

const getSpecificSourceValueForColumn = (
  row: ParsedSourceSpreadsheetRow,
  category: SpreadsheetTemplateCategory,
  column: SpreadsheetTemplateCategory['columns'][number],
): string | null => {
  const normalizedKey = normalizeComparable(column.key).replace(/\s+/g, '_');
  const normalizedLabel = normalizeComparable(column.label);
  const specificationAttributeName = getProductDraftSpecificationAttributeName(category, column);
  const normalizedSpecificationName = specificationAttributeName ? normalizeComparable(specificationAttributeName) : '';
  const spuValues = findMatchingCellValues(row.cells, [...SOURCE_HEADER_ALIASES.code]);

  if (normalizedKey === 'supplier_code') {
    return spuValues[0] || null;
  }

  if (normalizedKey === 'supplier_sku') {
    return spuValues[1] || spuValues[0] || null;
  }

  if (normalizedKey === 'default_product_name_es' || normalizedKey === 'default_product_name') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.productName]);
  }

  if (normalizedKey === 'default_product_desc_es' || normalizedKey === 'default_product_desc') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.description]);
  }

  if (normalizedKey === 'brand_code' || normalizedLabel === 'marca') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.brand]);
  }

  if (normalizedKey === 'origin_code' || normalizedLabel === 'origen') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.origin]);
  }

  if (normalizedKey === 'ip_character' || normalizedLabel.includes('propiedad intelectual')) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.ipCharacter]);
  }

  if (normalizedKey.includes('stock') || normalizedLabel === 'stock') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.stock]);
  }

  if (normalizedKey.includes('price') || normalizedKey.includes('precio') || normalizedLabel.includes('precio')) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.price]);
  }

  if (
    normalizedKey.includes('weight')
    || normalizedKey.includes('peso')
    || normalizedLabel.includes('peso')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.weight]);
  }

  if (
    normalizedKey.includes('length')
    || normalizedKey.includes('largo')
    || normalizedKey.includes('package_length')
    || normalizedLabel.includes('largo')
    || normalizedLabel.includes('longitud')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.length]);
  }

  if (
    normalizedKey.includes('width')
    || normalizedKey.includes('ancho')
    || normalizedKey.includes('package_width')
    || normalizedLabel.includes('ancho')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.width]);
  }

  if (
    normalizedKey.includes('height')
    || normalizedKey.includes('alto')
    || normalizedKey.includes('package_height')
    || normalizedLabel.includes('alto')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.height]);
  }

  if (
    normalizedKey === 'main_attribute_value'
    || normalizedLabel.includes('color')
    || normalizedSpecificationName.includes('color')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.color]);
  }

  if (
    normalizedKey.endsWith('_value')
    && (
      normalizedLabel.includes('talla')
      || normalizedLabel.includes('size')
      || normalizedSpecificationName.includes('talla')
      || normalizedSpecificationName.includes('size')
      || normalizedSpecificationName.includes('tamano')
    )
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.size]);
  }

  if (normalizedKey === 'main_img' || normalizedKey === 'square_img') {
    return null;
  }

  return null;
};

const findSourceCellValueForColumn = (
  row: ParsedSourceSpreadsheetRow,
  category: SpreadsheetTemplateCategory,
  column: SpreadsheetTemplateCategory['columns'][number],
): string | null => {
  const explicitValue = getSpecificSourceValueForColumn(row, category, column);
  if (explicitValue) {
    return explicitValue;
  }

  const aliases = getSourceValueAliases(column.label, column.key);
  for (const alias of aliases) {
    const directMatch = row.cells.find((cell) => alias.test(cell.normalizedHeader) && cell.value.trim());
    if (directMatch) {
      return directMatch.value.trim();
    }
  }

  return null;
};

export const buildSourceSpreadsheetSuggestions = (
  category: SpreadsheetTemplateCategory,
  match: MatchedSourceSpreadsheetRow | null,
): Record<string, ProductDraftValueSuggestion> => {
  if (!match) {
    return {};
  }

  const { row } = match;
  return category.columns.reduce<Record<string, ProductDraftValueSuggestion>>((result, column) => {
    const value = findSourceCellValueForColumn(row, category, column);
    if (!value) {
      return result;
    }

    result[column.key] = {
      value,
      confidence: Math.min(0.98, Math.max(0.62, match.score / 100)),
      reasoning: [
        `Valor recuperado de la fila ${row.rowNumber} del spreadsheet fuente.`,
        `Match ${match.strategy} con score ${match.score}.`,
        match.evidence.length > 0 ? `Evidencia: ${match.evidence.slice(0, 3).join('; ')}.` : null,
      ].filter(Boolean).join(' '),
      source: 'spreadsheet_source',
    };
    return result;
  }, {});
};

export const resolveSourceSpreadsheetRowColor = (
  row: ParsedSourceSpreadsheetRow | null,
  category: SpreadsheetTemplateCategory,
): string | null => {
  if (!row) {
    return null;
  }

  const rawColor = findBestCellValue(row.cells, [/^color$/, /\bcolor\b/]);
  if (!rawColor) {
    return null;
  }

  const colorOptions = category.attributes.find((attribute) => /color/.test(normalizeComparable(attribute.name)))?.values || [];
  return pickBestOption(colorOptions, [rawColor]) || rawColor;
};

export const matchSourceSpreadsheetRowsToGarments = async ({
  sourceSpreadsheet,
  garments,
  userUid,
}: {
  sourceSpreadsheet: WizardSourceSpreadsheetInput;
  garments: UploadedGarmentInput[];
  userUid: string;
}): Promise<MatchedSourceSpreadsheetRowsResult> => {
  const [buffer] = await getBucket().file(sourceSpreadsheet.storagePath).download();
  const workbook = XLSX.read(buffer, { type: 'buffer', bookFiles: true });
  const parsed = buildSourceSpreadsheetRows(workbook);
  const warnings = [
    sourceSpreadsheet.originalFileName.toLowerCase().endsWith('.xls') && parsed.directRowsWithPhotos === 0
      ? 'El archivo .xls no expuso imágenes embebidas al parser; se usaron columnas de texto/código para el matching.'
      : null,
    parsed.detectedColumns.length === 0
      ? 'No se detectaron columnas semánticas conocidas; el matching se limitó al texto visible de las filas.'
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  if (parsed.rows.length === 0 || garments.length === 0) {
    return {
      matchedRowByGarmentId: new Map(),
      summary: {
        totalRows: parsed.totalRows,
        rowsWithPhotos: parsed.directRowsWithPhotos,
        ignoredRows: parsed.ignoredRows,
        reusedSpuPhotoRows: parsed.reusedSpuPhotoRows,
        matchedRows: 0,
        matchedGarments: 0,
        unmatchedGarments: garments.length,
        sheetName: parsed.sheetName,
        headerRowNumber: parsed.headerRowNumber,
        textOnlyRows: parsed.textOnlyRows,
        matchedByImage: 0,
        matchedByText: 0,
        highConfidenceMatches: 0,
        needsReviewMatches: 0,
        detectedColumns: parsed.detectedColumns,
        warnings,
      },
    };
  }

  const fingerprintedRows = await fingerprintSourceRows(parsed.rows, userUid);
  const garmentFingerprintsById = await fingerprintGarments(garments, userUid);
  const matchedRowByGarmentId = resolveMatchedRowByGarment(fingerprintedRows, garments, garmentFingerprintsById);
  const matches = [...matchedRowByGarmentId.values()];

  return {
    matchedRowByGarmentId,
    summary: {
      totalRows: parsed.totalRows,
      rowsWithPhotos: parsed.directRowsWithPhotos,
      ignoredRows: parsed.ignoredRows,
      reusedSpuPhotoRows: parsed.reusedSpuPhotoRows,
      matchedRows: matchedRowByGarmentId.size,
      matchedGarments: matchedRowByGarmentId.size,
      unmatchedGarments: Math.max(0, garments.length - matchedRowByGarmentId.size),
      sheetName: parsed.sheetName,
      headerRowNumber: parsed.headerRowNumber,
      textOnlyRows: parsed.textOnlyRows,
      matchedByImage: matches.filter((match) => match.strategy === 'image' || match.strategy === 'mixed').length,
      matchedByText: matches.filter((match) => match.strategy === 'text').length,
      highConfidenceMatches: matches.filter((match) => match.score >= HIGH_CONFIDENCE_MATCH_SCORE).length,
      needsReviewMatches: matches.filter((match) => match.score < HIGH_CONFIDENCE_MATCH_SCORE).length,
      detectedColumns: parsed.detectedColumns,
      warnings,
    },
  };
};
