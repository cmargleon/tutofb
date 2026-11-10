import { UploadedGarmentInput } from '../../../shared/src/types';
import { findBestCellValue, normalizeComparable, SOURCE_HEADER_ALIASES } from './sourceSpreadsheetColumns';
import {
  ImageMatchFingerprint,
  MatchedSourceSpreadsheetRow,
  MatchScoreResult,
  ParsedSourceSpreadsheetRow,
  SourceMatchStrategy,
} from './sourceSpreadsheetTypes';

export const MIN_AUTO_MATCH_SCORE = 34;

export const pickBestOption = (options: string[], candidates: Array<string | null | undefined>): string | null => {
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

export const textSimilarityScore = (left: string | null, right: string | null, exactScore: number, partialScore: number): number => {
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

export const comparableTokens = (value: string | null | undefined): Set<string> =>
  new Set(
    normalizeComparable(value || '')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );

export const tokenOverlapScore = (left: string | null | undefined, right: string | null | undefined, maxScore: number): number => {
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  return Math.round(maxScore * Math.min(1, overlap / denominator));
};

export const buildGarmentSearchText = (
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

export const computeMatchScore = (
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

export const resolveMatchedRowByGarment = (
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
