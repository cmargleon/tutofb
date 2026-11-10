import * as XLSX from 'xlsx';
import { UploadedGarmentInput, WizardSourceSpreadsheetInput } from '../../../shared/src/types';
import { fingerprintGarments, fingerprintSourceRows, getBucket } from './sourceSpreadsheetFingerprint';
import { buildSourceSpreadsheetRows } from './sourceSpreadsheetRows';
import { resolveMatchedRowByGarment } from './sourceSpreadsheetScoring';
import { MatchedSourceSpreadsheetRowsResult } from './sourceSpreadsheetTypes';

// Public entry point for source-spreadsheet matching. The implementation lives in the neighbouring
// sourceSpreadsheet*.ts modules; these re-exports keep the original import surface stable.
export { buildSourceSpreadsheetRows } from './sourceSpreadsheetRows';
export { buildSourceSpreadsheetSuggestions, resolveSourceSpreadsheetRowColor } from './sourceSpreadsheetSuggestions';

const HIGH_CONFIDENCE_MATCH_SCORE = 56;

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
