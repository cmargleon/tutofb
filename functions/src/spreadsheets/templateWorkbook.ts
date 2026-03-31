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

const TEMPLATE_PARSER_VERSION = 1;
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

const toSheetRows = (worksheet: XLSX.WorkSheet): string[][] =>
  (XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][]).map((row) => row.map((cell) => normalizeCellString(cell)));

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

const buildCategoryColumns = (rows: string[][]): SpreadsheetTemplateCategoryColumn[] => {
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
    const categoryLabel = normalizeCellString(row[0]);
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
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const validAttributesSheet = findAuxiliarySheet(workbook, /atributo|attribute/);
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
    const columns = buildCategoryColumns(rows);

    categories.push({
      templateId: '',
      clientId,
      sheetName,
      label,
      rowStart: CATEGORY_DATA_START_ROW,
      columns,
      attributes: attributeMapByCategory.get(label) || [],
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

const buildGeneratedImageFallbacks = (draft: ProductDraft): Record<string, string> => {
  const generatedImages = sortGeneratedImages(draft).filter((entry) => entry.downloadUrl);
  if (generatedImages.length === 0) {
    return {};
  }

  const firstUrl = generatedImages[0]?.downloadUrl || '';
  const fallbacks: Record<string, string> = {};
  if (firstUrl) {
    fallbacks.main_img = firstUrl;
    fallbacks.square_img = firstUrl;
  }

  generatedImages.forEach((image, index) => {
    if (!image.downloadUrl) {
      return;
    }

    fallbacks[`detail_img_${index + 1}`] = image.downloadUrl;
  });

  return fallbacks;
};

const resolveCellValue = (
  draft: ProductDraft,
  row: ProductDraft['rows'][number],
  column: SpreadsheetTemplateCategoryColumn,
): string => {
  const directValue = row.values[column.key];
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }

  const inferred = draft.inferredValues?.[column.key]?.value;
  if (typeof inferred === 'string' && inferred.trim()) {
    return inferred.trim();
  }

  const generatedFallback = buildGeneratedImageFallbacks(draft)[column.key];
  if (generatedFallback) {
    return generatedFallback;
  }

  return '';
};

export const getProductDraftMissingRequiredKeys = (
  draft: ProductDraft,
  row: ProductDraft['rows'][number],
  category: SpreadsheetTemplateCategory,
): string[] =>
  category.columns
    .filter((column) => column.required)
    .filter((column) => !resolveCellValue(draft, row, column))
    .map((column) => column.key);

export const exportBatchSpreadsheetWorkbook = async ({
  templateStoragePath,
  category,
  productDrafts,
}: {
  templateStoragePath: string;
  category: SpreadsheetTemplateCategory;
  productDrafts: ProductDraft[];
}): Promise<Buffer> => {
  const workbook = await loadWorkbookFromStorage(templateStoragePath);
  const worksheet = workbook.Sheets[category.sheetName];

  if (!worksheet) {
    throw new Error(`La hoja ${category.sheetName} ya no existe en la plantilla original.`);
  }

  clearCategorySheetData(worksheet, category.columns, category.rowStart);

  let exportRowIndex = category.rowStart - 1;
  productDrafts.forEach((draft) => {
    draft.rows.forEach((row) => {
      category.columns.forEach((column) => {
        const value = resolveCellValue(draft, row, column);
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

  const currentRange = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  const maxColumnIndex = Math.max(currentRange.e.c, ...category.columns.map((column) => column.index));
  const maxRowIndex = Math.max(currentRange.e.r, Math.max(category.rowStart - 1, exportRowIndex - 1));
  worksheet['!ref'] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: maxColumnIndex, r: maxRowIndex },
  });

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
