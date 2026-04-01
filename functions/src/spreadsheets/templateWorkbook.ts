import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import {
  ProductDraft,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
  SpreadsheetTemplateCategoryAttribute,
  SpreadsheetTemplateCategoryColumn,
  SpreadsheetTemplateOriginOption,
} from '../../../shared/src/types';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { resolveProductDraftColumnValue } from '../../../shared/src/utils/spreadsheetDraftColumns';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';

const TEMPLATE_PARSER_VERSION = 4;
const CATEGORY_HEADER_ROW_INDEX = 1;
const CATEGORY_KEY_ROW_INDEX = 2;
const CATEGORY_REQUIREMENT_ROW_INDEX = 3;
const CATEGORY_GUIDANCE_ROW_INDEX = 4;
const CATEGORY_VALIDATION_ROW_INDEX = 5;
const CATEGORY_DATA_START_ROW = 7;
const bucket = admin.storage().bucket();

interface ParsedTemplateImportArgs {
  clientId: string;
  clientNameSnapshot: string;
  storagePath: string;
  originalFileName: string;
  createdByUid: string;
  buffer: Buffer;
}

interface ParsedTemplateImportResult {
  template: Omit<SpreadsheetTemplate, 'id' | 'createdAt' | 'updatedAt'>;
  categories: Array<Omit<SpreadsheetTemplateCategory, 'id' | 'createdAt' | 'updatedAt'>>;
}

export const getSpreadsheetTemplateParserVersion = (): number => TEMPLATE_PARSER_VERSION;

interface SpreadsheetColumnDropdownValidation {
  formula: string;
  options: string[];
}

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

const normalizeWorksheetRange = (worksheet: XLSX.WorkSheet): void => {
  const cellAddresses = Object.keys(worksheet).filter((key) => !key.startsWith('!'));
  if (cellAddresses.length === 0) {
    return;
  }

  const decodedCells = cellAddresses.map((address) => XLSX.utils.decode_cell(address));
  const range = decodedCells.reduce(
    (current, cell) => ({
      s: {
        c: Math.min(current.s.c, cell.c),
        r: Math.min(current.s.r, cell.r),
      },
      e: {
        c: Math.max(current.e.c, cell.c),
        r: Math.max(current.e.r, cell.r),
      },
    }),
    {
      s: { c: decodedCells[0]!.c, r: decodedCells[0]!.r },
      e: { c: decodedCells[0]!.c, r: decodedCells[0]!.r },
    },
  );

  worksheet['!ref'] = XLSX.utils.encode_range(range);
};

const toSheetRows = (worksheet: XLSX.WorkSheet): string[][] => {
  normalizeWorksheetRange(worksheet);
  return (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][]).map((row) => row.map((cell) => normalizeCellString(cell)));
};

const slugify = (value: string): string => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'category';
};

const columnLetterFromIndex = (index: number): string => XLSX.utils.encode_col(index);

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const getWorkbookSheetXmlPathMap = (workbook: XLSX.WorkBook): Map<string, string> => {
  const workbookFiles = (workbook as XLSX.WorkBook & { files?: Record<string, { content?: unknown }> }).files;
  const workbookFile = workbookFiles?.['xl/workbook.xml'];
  const workbookRelsFile = workbookFiles?.['xl/_rels/workbook.xml.rels'];
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
    const sheetName = decodeXmlEntities(match[1]);
    const relationshipId = match[2];
    const target = relationshipTargetById.get(relationshipId);
    if (target) {
      sheetPathByName.set(sheetName, target);
    }
  }

  return sheetPathByName;
};

const getWorksheetRangeValues = (
  workbook: XLSX.WorkBook,
  sheetName: string,
  startColumn: string,
  startRow: number,
  endColumn: string,
  endRow: number,
): string[] => {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return [];
  }

  const range = XLSX.utils.decode_range(`${startColumn}${startRow}:${endColumn}${endRow}`);
  const values: string[] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex })];
      const value = normalizeCellString(cell?.v);
      if (value) {
        values.push(value);
      }
    }
  }

  return values;
};

const normalizeDefinedNameKey = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getNamedRangeValues = (workbook: XLSX.WorkBook, definedName: string): string[] => {
  const normalizedTarget = normalizeDefinedNameKey(definedName);
  const namedRange = workbook.Workbook?.Names?.find((entry) => normalizeDefinedNameKey(entry.Name) === normalizedTarget);
  if (!namedRange?.Ref) {
    return [];
  }

  const decodedRef = decodeXmlEntities(namedRange.Ref);
  const rangeMatch = decodedRef.match(/^'?([^']+)'?!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/);
  if (!rangeMatch) {
    return [];
  }

  const [, sheetName, startColumn, startRow, endColumn, endRow] = rangeMatch;
  return getWorksheetRangeValues(workbook, sheetName, startColumn, Number(startRow), endColumn, Number(endRow));
};

const resolveDropdownOptionsFromFormula = (workbook: XLSX.WorkBook, formula: string): string[] => {
  const normalizedFormula = decodeXmlEntities(formula.trim());
  const quotedListMatch = normalizedFormula.match(/^"([\s\S]*)"$/);
  if (quotedListMatch) {
    return quotedListMatch[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const rangeMatch = normalizedFormula.match(/^'?([^']+)'?!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/);
  if (rangeMatch) {
    const [, sheetName, startColumn, startRow, endColumn, endRow] = rangeMatch;
    return getWorksheetRangeValues(workbook, sheetName, startColumn, Number(startRow), endColumn, Number(endRow));
  }

  return [];
};

const buildDropdownValidationsByColumnLetter = (
  workbook: XLSX.WorkBook,
  sheetName: string,
): Map<string, SpreadsheetColumnDropdownValidation> => {
  const sheetPath = getWorkbookSheetXmlPathMap(workbook).get(sheetName);
  if (!sheetPath) {
    return new Map();
  }

  const workbookFiles = (workbook as XLSX.WorkBook & { files?: Record<string, { content?: unknown }> }).files;
  const sheetXmlFile = workbookFiles?.[sheetPath];
  if (!sheetXmlFile?.content) {
    return new Map();
  }

  const sheetXml = String(sheetXmlFile.content);
  const validationsByLetter = new Map<string, SpreadsheetColumnDropdownValidation>();

  for (const match of sheetXml.matchAll(/<dataValidation\b[^>]*type="list"[^>]*sqref="([^"]+)"[^>]*>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>[\s\S]*?<\/dataValidation>/g)) {
    const sqref = match[1];
    const formula = decodeXmlEntities(match[2]);
    const columnLetter = sqref.split(':')[0]?.replace(/[0-9]/g, '') || '';
    if (!columnLetter) {
      continue;
    }

    validationsByLetter.set(columnLetter, {
      formula,
      options: resolveDropdownOptionsFromFormula(workbook, formula),
    });
  }

  return validationsByLetter;
};

const stripTrailingCategoryCode = (value: string): string =>
  value.replace(/\s*\(\d+(?:-\d+)?\)\s*$/, '').trim();

const normalizeCategoryLookupKey = (value: string): string =>
  stripTrailingCategoryCode(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const extractTrailingSheetCode = (sheetName: string): string | null => {
  const match = sheetName.match(/-(\d+)\)\s*$/);
  return match?.[1] || null;
};

const isTruthyFlag = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === 'si' || normalized === 'sí' || normalized === 'yes' || normalized === 'true';
};

const buildTemplateFingerprint = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');

const isCategorySheet = (rows: string[][]): boolean => {
  const keyRow = rows[CATEGORY_KEY_ROW_INDEX] || [];
  return keyRow.some((value) => value === 'supplier_code');
};

const buildCategoryColumns = (
  rows: string[][],
  dropdownValidationsByLetter: Map<string, SpreadsheetColumnDropdownValidation> = new Map(),
): SpreadsheetTemplateCategoryColumn[] => {
  const labelRow = rows[CATEGORY_HEADER_ROW_INDEX] || [];
  const keyRow = rows[CATEGORY_KEY_ROW_INDEX] || [];
  const requirementRow = rows[CATEGORY_REQUIREMENT_ROW_INDEX] || [];
  const guidanceRow = rows[CATEGORY_GUIDANCE_ROW_INDEX] || [];
  const validationRow = rows[CATEGORY_VALIDATION_ROW_INDEX] || [];
  const maxLength = Math.max(
    labelRow.length,
    keyRow.length,
    requirementRow.length,
    guidanceRow.length,
    validationRow.length,
  );

  const columns: SpreadsheetTemplateCategoryColumn[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    const label = normalizeCellString(labelRow[index]);
    const key = normalizeCellString(keyRow[index]);
    const requirementLabel = normalizeCellString(requirementRow[index]) || null;
    const guidance = normalizeCellString(guidanceRow[index]) || null;
    const validation = normalizeCellString(validationRow[index]) || null;

    if (!label && !key && !guidance && !validation) {
      continue;
    }

    columns.push({
      index,
      letter: columnLetterFromIndex(index),
      label: label || key || `Columna ${index + 1}`,
      key: key || `column_${index + 1}`,
      required: requirementLabel?.toLowerCase().includes('requerido') || false,
      requirementLabel,
      guidance,
      validation,
      dropdownOptions: dropdownValidationsByLetter.get(columnLetterFromIndex(index))?.options || [],
      dropdownFormula: dropdownValidationsByLetter.get(columnLetterFromIndex(index))?.formula || null,
    });
  }

  return columns;
};

const buildAttributeMapByCategory = (worksheet: XLSX.WorkSheet | undefined): Map<string, SpreadsheetTemplateCategoryAttribute[]> => {
  if (!worksheet) {
    return new Map();
  }

  const rows = toSheetRows(worksheet);
  const attributesByCategory = new Map<string, SpreadsheetTemplateCategoryAttribute[]>();

  rows.slice(1).forEach((row) => {
    const categoryLabel = normalizeCategoryLookupKey(normalizeCellString(row[0]));
    const attributeName = normalizeCellString(row[2]);
    if (!categoryLabel || !attributeName) {
      return;
    }

    const values = row
      .slice(5)
      .map((value) => normalizeCellString(value))
      .filter(Boolean);

    const nextValue: SpreadsheetTemplateCategoryAttribute = {
      attributeType: normalizeCellString(row[1]) || null,
      name: attributeName,
      required: isTruthyFlag(normalizeCellString(row[3])),
      important: isTruthyFlag(normalizeCellString(row[4])),
      values,
    };

    const current = attributesByCategory.get(categoryLabel) || [];
    current.push(nextValue);
    attributesByCategory.set(categoryLabel, current);
  });

  return attributesByCategory;
};

const buildBrandOptions = (worksheet: XLSX.WorkSheet | undefined): string[] => {
  if (!worksheet) {
    return [];
  }

  const rows = toSheetRows(worksheet);
  return rows
    .slice(1)
    .map((row) => normalizeCellString(row[0]))
    .filter(Boolean);
};

const buildOriginOptions = (worksheet: XLSX.WorkSheet | undefined): SpreadsheetTemplateOriginOption[] => {
  if (!worksheet) {
    return [];
  }

  const rows = toSheetRows(worksheet);
  return rows
    .slice(1)
    .map((row) => ({
      label: normalizeCellString(row[0]),
      code: normalizeCellString(row[1]),
    }))
    .filter((entry) => entry.label && entry.code);
};

const buildAttributesFromTemplateSpecificSheets = (
  workbook: XLSX.WorkBook,
  sheetName: string,
): SpreadsheetTemplateCategoryAttribute[] => {
  const sheetCode = extractTrailingSheetCode(sheetName);
  if (!sheetCode) {
    return [];
  }

  const attributeNamesSheet = workbook.Sheets[`AttributeNames_${sheetCode}`];
  if (!attributeNamesSheet) {
    return [];
  }

  const primaryAttributesSheet = workbook.Sheets[`MainAttr_${sheetCode}`];
  const attributeRows = toSheetRows(attributeNamesSheet);
  const primaryRows = primaryAttributesSheet ? toSheetRows(primaryAttributesSheet) : [];
  const importantNames = new Set(
    primaryRows
      .map((row) => normalizeCellString(row[0]))
      .filter(Boolean),
  );

  return attributeRows
    .map((row) => normalizeCellString(row[0]))
    .filter(Boolean)
    .map((name) => ({
      attributeType: null,
      name,
      required: false,
      important: importantNames.has(name),
      values: [],
    }));
};

const getPrimarySpecificationName = (workbook: XLSX.WorkBook, sheetName: string): string | null => {
  const sheetCode = extractTrailingSheetCode(sheetName);
  if (!sheetCode) {
    return null;
  }

  const primaryAttributesSheet = workbook.Sheets[`MainAttr_${sheetCode}`];
  if (!primaryAttributesSheet) {
    return null;
  }

  return normalizeCellString(primaryAttributesSheet.A1?.v) || null;
};

const buildMainAttributeValueOptions = (workbook: XLSX.WorkBook, sheetName: string): string[] => {
  const sheetCode = extractTrailingSheetCode(sheetName);
  const primarySpecificationName = getPrimarySpecificationName(workbook, sheetName);
  if (!sheetCode || !primarySpecificationName) {
    return [];
  }

  return getNamedRangeValues(workbook, `CAT_${sheetCode}_${primarySpecificationName}`);
};

const mergeAttributeValues = (
  attributes: SpreadsheetTemplateCategoryAttribute[],
  attributeName: string | null,
  values: string[],
): SpreadsheetTemplateCategoryAttribute[] => {
  if (!attributeName || values.length === 0) {
    return attributes;
  }

  const normalizedTarget = normalizeCategoryLookupKey(attributeName);
  let matched = false;
  const nextAttributes = attributes.map((attribute) => {
    if (normalizeCategoryLookupKey(attribute.name) !== normalizedTarget) {
      return attribute;
    }

    matched = true;
    return {
      ...attribute,
      values: attribute.values.length > 0 ? attribute.values : values,
    };
  });

  if (matched) {
    return nextAttributes;
  }

  return [
    ...nextAttributes,
    {
      attributeType: 'Especificación',
      name: attributeName,
      required: false,
      important: true,
      values,
    },
  ];
};

const findAuxiliarySheet = (workbook: XLSX.WorkBook, matcher: RegExp): XLSX.WorkSheet | undefined => {
  const matchingName = workbook.SheetNames.find((sheetName) => matcher.test(sheetName.toLowerCase()));
  return matchingName ? workbook.Sheets[matchingName] : undefined;
};

export const parseSpreadsheetTemplateWorkbook = ({
  clientId,
  clientNameSnapshot,
  storagePath,
  originalFileName,
  createdByUid,
  buffer,
}: ParsedTemplateImportArgs): ParsedTemplateImportResult => {
  const workbook = XLSX.read(buffer, { type: 'buffer', bookFiles: true });
  const validAttributesSheet = findAuxiliarySheet(workbook, /valor de atributo valido|valor de atributo válido|valid attribute/)
    || findAuxiliarySheet(workbook, /atributo|attribute/);
  const brandSheet = findAuxiliarySheet(workbook, /marca|brand/);
  const originSheet = findAuxiliarySheet(workbook, /origen|origin/);
  const attributeMapByCategory = buildAttributeMapByCategory(validAttributesSheet);
  const categories: Array<Omit<SpreadsheetTemplateCategory, 'id' | 'createdAt' | 'updatedAt'>> = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = toSheetRows(worksheet);
    if (!isCategorySheet(rows)) {
      return;
    }

    const label = sheetName.trim();
    const dropdownValidationsByLetter = buildDropdownValidationsByColumnLetter(workbook, sheetName);
    const mainAttributeValueOptions = buildMainAttributeValueOptions(workbook, sheetName);
    const columns = buildCategoryColumns(rows, dropdownValidationsByLetter).map((column) =>
      column.key === 'main_attribute_value' && mainAttributeValueOptions.length > 0
        ? {
            ...column,
            dropdownOptions: mainAttributeValueOptions,
          }
        : column,
    );

    const lookupKey = normalizeCategoryLookupKey(label);
    const parsedAttributes = attributeMapByCategory.get(lookupKey) || [];
    const baseAttributes = parsedAttributes.length > 0
      ? parsedAttributes
      : buildAttributesFromTemplateSpecificSheets(workbook, sheetName);
    const fallbackAttributes = mergeAttributeValues(
      baseAttributes,
      getPrimarySpecificationName(workbook, sheetName),
      mainAttributeValueOptions,
    );

    categories.push({
      templateId: '',
      clientId,
      sheetName,
      label,
      rowStart: CATEGORY_DATA_START_ROW,
      columns,
      attributes: fallbackAttributes,
    });
  });

  const template: Omit<SpreadsheetTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
    clientId,
    clientNameSnapshot,
    name: originalFileName.replace(/\.[^.]+$/, ''),
    originalFileName,
    storagePath,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    status: 'active',
    archivedAt: null,
    archivedByUid: null,
    parserVersion: TEMPLATE_PARSER_VERSION,
    templateFingerprint: buildTemplateFingerprint(buffer),
    categoryIds: categories.map((category) => slugify(category.sheetName)),
    categories: categories.map((category) => ({
      id: slugify(category.sheetName),
      sheetName: category.sheetName,
      label: category.label,
      columnCount: category.columns.length,
      attributeCount: category.attributes.length,
      rowStart: category.rowStart,
    })),
    brandOptions: buildBrandOptions(brandSheet),
    originOptions: buildOriginOptions(originSheet),
    createdByUid,
  };

  return {
    template,
    categories: categories.map((category) => ({
      ...category,
      templateId: '',
    })),
  };
};

export const parseStoredSpreadsheetTemplateWorkbook = async ({
  clientId,
  clientNameSnapshot,
  template,
  createdByUid,
}: {
  clientId: string;
  clientNameSnapshot: string;
  template: Pick<SpreadsheetTemplate, 'storagePath' | 'originalFileName'>;
  createdByUid: string;
}): Promise<ParsedTemplateImportResult> => {
  const [buffer] = await bucket.file(template.storagePath).download();
  return parseSpreadsheetTemplateWorkbook({
    clientId,
    clientNameSnapshot,
    storagePath: template.storagePath,
    originalFileName: template.originalFileName,
    createdByUid,
    buffer,
  });
};

const loadWorkbookFromStorage = async (storagePath: string): Promise<XLSX.WorkBook> => {
  const [buffer] = await bucket.file(storagePath).download();
  return XLSX.read(buffer, { type: 'buffer' });
};

const clearCategorySheetData = (
  worksheet: XLSX.WorkSheet,
  columns: SpreadsheetTemplateCategoryColumn[],
  rowStart: number,
): void => {
  const ref = worksheet['!ref'];
  if (!ref) {
    return;
  }

  const range = XLSX.utils.decode_range(ref);
  const firstDataRowIndex = Math.max(0, rowStart - 1);

  for (let rowIndex = firstDataRowIndex; rowIndex <= range.e.r; rowIndex += 1) {
    columns.forEach((column) => {
      delete worksheet[XLSX.utils.encode_cell({ c: column.index, r: rowIndex })];
    });
  }
}

const sortGeneratedImages = (draft: ProductDraft): ProductDraft['generatedImages'] =>
  [...(draft.generatedImages || [])].sort((left, right) => toMillisOrZero(left.selectedAt) - toMillisOrZero(right.selectedAt));

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const isImageColumn = (column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label'>): boolean => {
  const normalizedKey = normalizeComparable(column.key);
  const normalizedLabel = normalizeComparable(column.label);
  return normalizedKey.includes('img') || normalizedLabel.includes('foto') || normalizedLabel.includes('imagen');
};

const isColorColumn = (column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label'>): boolean => {
  const normalizedKey = normalizeComparable(column.key);
  const normalizedLabel = normalizeComparable(column.label);
  return normalizedKey === 'attr 27' || normalizedKey === 'attr_27' || normalizedLabel.includes('color');
};

const selectPreferredMainImage = (draft: ProductDraft): string | null => {
  const generatedImages = sortGeneratedImages(draft).filter((entry) => entry.downloadUrl);
  const frontThreeQuarter = generatedImages.find((entry) => entry.poseOrientationDetail === 'front_three_quarter');
  if (frontThreeQuarter?.downloadUrl) {
    return frontThreeQuarter.downloadUrl;
  }

  const frontImage = generatedImages.find((entry) => entry.poseOrientationGroup === 'front');
  if (frontImage?.downloadUrl) {
    return frontImage.downloadUrl;
  }

  return generatedImages[0]?.downloadUrl || null;
};

const buildDraftImageAvailability = (draft: ProductDraft): Record<string, boolean> => {
  const generatedImages = sortGeneratedImages(draft);
  const originalImages = [...(draft.originalImages || [])].sort((left, right) => left.sourceIndex - right.sourceIndex);
  const hasMain = Boolean(selectPreferredMainImage(draft) || originalImages.find((image) => image.view === 'front') || originalImages[0]);
  const hasBack = Boolean(
    generatedImages.find((image) => image.poseOrientationGroup === 'back')
    || originalImages.find((image) => image.view === 'back'),
  );
  const hasOriginal = originalImages.length > 0;
  const detailCount = generatedImages.length + originalImages.length;
  const availability: Record<string, boolean> = {
    main_img: hasMain,
    square_img: hasMain,
    fa_img: hasBack,
    piece_img: hasOriginal || hasMain,
    block_img: hasOriginal || hasMain,
  };

  for (let index = 1; index <= Math.max(detailCount, 8); index += 1) {
    availability[`detail_img_${index}`] = detailCount >= index;
  }

  return availability;
};

const buildDraftImageFallbacks = async (draft: ProductDraft): Promise<Record<string, string>> => {
  const generatedImages = sortGeneratedImages(draft).filter((entry) => entry.downloadUrl);
  const originalImages = [...(draft.originalImages || [])].sort((left, right) => left.sourceIndex - right.sourceIndex);
  const originalImagesWithUrls = await Promise.all(
    originalImages.map(async (image) => ({
      ...image,
      downloadUrl: await ensureStorageDownloadUrl(image.storagePath),
    })),
  );

  const mainGeneratedUrl = selectPreferredMainImage(draft);
  const firstFrontOriginal = originalImagesWithUrls.find((image) => image.view === 'front');
  const firstBackOriginal = originalImagesWithUrls.find((image) => image.view === 'back');
  const firstOriginal = originalImagesWithUrls[0];
  const backGeneratedUrl = generatedImages.find((image) => image.poseOrientationGroup === 'back')?.downloadUrl || null;

  const detailUrls = [
    ...generatedImages.map((image) => image.downloadUrl).filter((value): value is string => Boolean(value)),
    ...originalImagesWithUrls.map((image) => image.downloadUrl).filter(Boolean),
  ].filter((value, index, list) => list.indexOf(value) === index);

  const mainUrl = mainGeneratedUrl || firstFrontOriginal?.downloadUrl || firstOriginal?.downloadUrl || '';
  const pieceUrl = firstFrontOriginal?.downloadUrl || firstOriginal?.downloadUrl || mainUrl;
  const fallbacks: Record<string, string> = {};

  if (mainUrl) {
    fallbacks.main_img = mainUrl;
    fallbacks.square_img = mainUrl;
  }

  if (backGeneratedUrl || firstBackOriginal?.downloadUrl) {
    fallbacks.fa_img = backGeneratedUrl || firstBackOriginal?.downloadUrl || '';
  }

  if (pieceUrl) {
    fallbacks.piece_img = pieceUrl;
    fallbacks.block_img = pieceUrl;
  }

  detailUrls.forEach((url, index) => {
    fallbacks[`detail_img_${index + 1}`] = url;
  });

  return fallbacks;
};

const resolveCellValue = (
  draft: ProductDraft,
  row: ProductDraft['rows'][number],
  column: SpreadsheetTemplateCategoryColumn,
  category: SpreadsheetTemplateCategory,
  imageFallbacks: Record<string, string>,
): string => {
  const generatedFallback = imageFallbacks[column.key];
  return resolveProductDraftColumnValue({
    category,
    column,
    rowValues: row.values,
    candidates: [
      row.values[column.key],
      draft.inferredValues?.[column.key]?.value,
      generatedFallback,
    ],
  });
};

export const getProductDraftMissingRequiredKeys = (
  draft: ProductDraft,
  row: ProductDraft['rows'][number],
  category: SpreadsheetTemplateCategory,
): string[] =>
  category.columns
    .filter((column) => column.required || isImageColumn(column) || isColorColumn(column))
    .filter((column) => {
      const resolvedValue = resolveProductDraftColumnValue({
        category,
        column,
        rowValues: row.values,
        candidates: [row.values[column.key], draft.inferredValues?.[column.key]?.value],
      });
      if (resolvedValue) {
        return false;
      }

      return !buildDraftImageAvailability(draft)[column.key];
    })
    .map((column) => column.key);

export const exportBatchSpreadsheetWorkbook = async ({
  templateStoragePath,
  categoriesById,
  productDrafts,
}: {
  templateStoragePath: string;
  categoriesById: Map<string, SpreadsheetTemplateCategory>;
  productDrafts: ProductDraft[];
}): Promise<Buffer> => {
  const workbook = await loadWorkbookFromStorage(templateStoragePath);
  const draftsByCategoryId = productDrafts.reduce<Map<string, ProductDraft[]>>((result, draft) => {
    const current = result.get(draft.categoryId) || [];
    current.push(draft);
    result.set(draft.categoryId, current);
    return result;
  }, new Map());
  const imageFallbacksByDraftId = new Map(
    await Promise.all(
      productDrafts.map(async (draft) => [draft.id || draft.garmentId, await buildDraftImageFallbacks(draft)] as const),
    ),
  );

  draftsByCategoryId.forEach((drafts, categoryId) => {
    const category = categoriesById.get(categoryId);
    if (!category) {
      throw new Error(`La categoría ${categoryId} ya no existe en la plantilla original.`);
    }

    const worksheet = workbook.Sheets[category.sheetName];
    if (!worksheet) {
      throw new Error(`La hoja ${category.sheetName} ya no existe en la plantilla original.`);
    }

    clearCategorySheetData(worksheet, category.columns, category.rowStart);

    let exportRowIndex = category.rowStart - 1;
    drafts.forEach((draft) => {
      const imageFallbacks = imageFallbacksByDraftId.get(draft.id || draft.garmentId) || {};
      draft.rows.forEach((row) => {
        category.columns.forEach((column) => {
          const value = resolveCellValue(draft, row, column, category, imageFallbacks);
          if (!value) {
            return;
          }

          worksheet[XLSX.utils.encode_cell({ c: column.index, r: exportRowIndex })] = {
            t: 's',
            v: value,
          };
        });
        exportRowIndex += 1;
      });
    });

    const currentRange = worksheet['!ref']
      ? XLSX.utils.decode_range(worksheet['!ref'])
      : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
    const maxColumnIndex = Math.max(currentRange.e.c, ...category.columns.map((column) => column.index));
    const maxRowIndex = Math.max(currentRange.e.r, Math.max(category.rowStart - 1, exportRowIndex - 1));
    worksheet['!ref'] = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: maxColumnIndex, r: maxRowIndex },
    });
  });

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
