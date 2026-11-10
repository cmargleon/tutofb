import * as XLSX from 'xlsx';
import { detectSourceColumnRole, normalizeCellString, SOURCE_ROLE_WEIGHTS } from './sourceSpreadsheetColumns';
import { ParsedSourceSpreadsheetImage, WorkbookFileEntry } from './sourceSpreadsheetTypes';

export const workbookFilesOf = (workbook: XLSX.WorkBook): Record<string, WorkbookFileEntry> =>
  (workbook as XLSX.WorkBook & { files?: Record<string, WorkbookFileEntry> }).files || {};

export const resolveRelativeXmlPath = (basePath: string, target: string): string => {
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

export const getWorkbookSheetXmlPathMap = (workbook: XLSX.WorkBook): Map<string, string> => {
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

export const mimeTypeFromPath = (filePath: string): string => {
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

export const toBuffer = (value: unknown): Buffer | null => {
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

export const toSheetRows = (worksheet: XLSX.WorkSheet): string[][] =>
  (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][]).map((row) => row.map((cell) => normalizeCellString(cell)));

export const pickHeaderRowIndex = (rows: string[][]): number => {
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

export const pickSourceSheetName = (workbook: XLSX.WorkBook): string => {
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

export const getSheetDrawingPath = (workbook: XLSX.WorkBook, sheetName: string): string | null => {
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

export const extractSheetImages = (workbook: XLSX.WorkBook, sheetName: string): ParsedSourceSpreadsheetImage[] => {
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
