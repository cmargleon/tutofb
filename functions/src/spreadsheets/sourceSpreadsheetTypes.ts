import { SourceSpreadsheetMatchSummary } from '../../../shared/src/types';

export type SourceColumnRole =
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

export type SourceMatchStrategy = 'image' | 'text' | 'mixed';

export interface WorkbookFileEntry {
  content?: unknown;
}

export interface ImageMatchFingerprint {
  garmentType: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  visibleBrand: string | null;
  visibleText: string | null;
  pattern: string | null;
  hasHood: boolean | null;
  sleeveLength: string | null;
}

export interface ParsedSourceSpreadsheetCell {
  header: string;
  normalizedHeader: string;
  value: string;
  columnIndex: number;
  role: SourceColumnRole | null;
}

export interface ParsedSourceSpreadsheetImage {
  rowNumber: number;
  columnIndex: number;
  base64: string;
  mimeType: string;
}

export interface ParsedSourceSpreadsheetRow {
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

export interface MatchedSourceSpreadsheetRow {
  row: ParsedSourceSpreadsheetRow;
  score: number;
  strategy: SourceMatchStrategy;
  evidence: string[];
}

export interface MatchedSourceSpreadsheetRowsResult {
  matchedRowByGarmentId: Map<string, MatchedSourceSpreadsheetRow>;
  summary: SourceSpreadsheetMatchSummary;
}

export interface GeminiMatchFingerprintPayload {
  garmentType?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  visibleBrand?: unknown;
  visibleText?: unknown;
  pattern?: unknown;
  hasHood?: unknown;
  sleeveLength?: unknown;
}

export interface MatchScoreResult {
  score: number;
  strategy: SourceMatchStrategy;
  evidence: string[];
}
