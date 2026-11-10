import * as XLSX from 'xlsx';
import {
  detectSourceColumnRole,
  findBestRoleValue,
  findRoleValues,
  normalizeCellString,
  normalizeComparable,
  SOURCE_ROLE_LABELS,
} from './sourceSpreadsheetColumns';
import { ParsedSourceSpreadsheetCell, ParsedSourceSpreadsheetImage, ParsedSourceSpreadsheetRow, SourceColumnRole } from './sourceSpreadsheetTypes';
import { extractSheetImages, pickHeaderRowIndex, pickSourceSheetName, toSheetRows } from './sourceSpreadsheetWorkbook';

export const buildRowSearchableText = (cells: ParsedSourceSpreadsheetCell[]): string =>
  cells
    .filter((cell) => cell.role !== 'photo')
    .map((cell) => cell.value)
    .join(' ');

export const hasUsefulSourceText = (row: Pick<ParsedSourceSpreadsheetRow, 'codeValues' | 'productName' | 'description' | 'color' | 'searchableText'>): boolean =>
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
