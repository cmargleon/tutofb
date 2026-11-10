import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { UploadedGarmentInput } from '../shared/src/types';
import type { ImageMatchFingerprint, ParsedSourceSpreadsheetRow } from '../functions/src/spreadsheets/sourceSpreadsheetTypes';

const require = createRequire(import.meta.url);
const scoring = require('../functions/lib/functions/src/spreadsheets/sourceSpreadsheetScoring.js') as typeof import('../functions/src/spreadsheets/sourceSpreadsheetScoring');
const columns = require('../functions/lib/functions/src/spreadsheets/sourceSpreadsheetColumns.js') as typeof import('../functions/src/spreadsheets/sourceSpreadsheetColumns');
const workbook = require('../functions/lib/functions/src/spreadsheets/sourceSpreadsheetWorkbook.js') as typeof import('../functions/src/spreadsheets/sourceSpreadsheetWorkbook');

const row = (overrides: Partial<ParsedSourceSpreadsheetRow>): ParsedSourceSpreadsheetRow => ({
  rowId: 'row-2',
  rowNumber: 2,
  spu: null,
  codeValues: [],
  productName: null,
  description: null,
  color: null,
  searchableText: '',
  cells: [],
  image: null,
  fingerprint: null,
  ...overrides,
});

const garment = (overrides: Partial<UploadedGarmentInput>): UploadedGarmentInput =>
  ({ id: 'g1', name: 'garment', originalFileNames: [], photos: [], ...overrides } as unknown as UploadedGarmentInput);

const fingerprint = (overrides: Partial<ImageMatchFingerprint>): ImageMatchFingerprint => ({
  garmentType: null,
  primaryColor: null,
  secondaryColor: null,
  visibleBrand: null,
  visibleText: null,
  pattern: null,
  hasHood: null,
  sleeveLength: null,
  ...overrides,
});

test('normalizeComparable and column role detection', () => {
  assert.equal(columns.normalizeComparable('  Descripción_Del  PRODUCTO! '), 'descripcion del producto');
  assert.equal(columns.detectSourceColumnRole('FOTO'), 'photo');
  assert.equal(columns.detectSourceColumnRole('Código'), 'code');
  assert.equal(columns.detectSourceColumnRole('Precio mínimo'), 'price');
  assert.equal(columns.detectSourceColumnRole('Notas'), null);
  assert.equal(columns.detectSourceColumnRole(''), null);
});

test('text similarity and token overlap scores', () => {
  assert.equal(scoring.textSimilarityScore('Rojo', 'rojo', 18, 9), 18);
  assert.equal(scoring.textSimilarityScore('Rojo', 'rojo oscuro', 18, 9), 9);
  assert.equal(scoring.textSimilarityScore('Rojo', 'azul', 18, 9), 0);
  assert.equal(scoring.textSimilarityScore(null, 'azul', 18, 9), 0);
  assert.equal(scoring.tokenOverlapScore('polera algodon roja', 'polera roja', 26), 26);
  assert.equal(scoring.tokenOverlapScore('polera algodon', 'polera azul', 26), 13);
  assert.equal(scoring.tokenOverlapScore('ab', 'ab', 26), 0);
  assert.equal(scoring.pickBestOption(['Rojo intenso', 'Azul'], [null, 'azul']), 'Azul');
  assert.equal(scoring.pickBestOption(['Rojo intenso', 'Azul'], ['rojo']), 'Rojo intenso');
  assert.equal(scoring.pickBestOption(['Azul'], ['verde']), null);
});

test('computeMatchScore combines code, text, color and fingerprint evidence', () => {
  const textOnly = scoring.computeMatchScore(
    row({ codeValues: ['39496'], productName: 'Polera básica', color: 'Rojo' }),
    garment({ name: '39496', matchedColor: 'rojo' }),
    null,
  );
  assert.deepEqual(textOnly, {
    score: 72 + 18,
    strategy: 'text',
    evidence: ['codigo/modelo coincide: 39496', 'color compatible: Rojo'],
  });

  const imageMatch = scoring.computeMatchScore(
    row({ fingerprint: fingerprint({ garmentType: 'polera', primaryColor: 'rojo', hasHood: true, sleeveLength: 'corta' }) }),
    garment({ name: 'foto-1' }),
    fingerprint({ garmentType: 'polera', primaryColor: 'rojo', hasHood: true, sleeveLength: 'corta' }),
  );
  assert.equal(imageMatch.strategy, 'image');
  // fingerprint: 30 (garment type) + 24 (primary color), then +10 hood and +8 sleeve.
  // The row has no written color, so the text color score stays at 0.
  assert.equal(imageMatch.score, 30 + 24 + 10 + 8);
  assert.deepEqual(imageMatch.evidence, ['huella visual compatible', 'capucha coincide', 'largo de manga compatible']);

  const hoodMismatch = scoring.computeMatchScore(
    row({ fingerprint: fingerprint({ hasHood: false }) }),
    garment({}),
    fingerprint({ hasHood: true }),
  );
  assert.equal(hoodMismatch.score, -12);
  assert.equal(hoodMismatch.strategy, 'text');
});

test('resolveMatchedRowByGarment assigns greedily by score and respects the minimum threshold', () => {
  const rows = [
    row({ rowId: 'r1', codeValues: ['A1'] }),
    row({ rowId: 'r2', codeValues: ['B2'] }),
    row({ rowId: 'r3', codeValues: ['ZZ'] }),
  ];
  const garments = [garment({ id: 'g1', name: 'A1' }), garment({ id: 'g2', name: 'B2-extra' }), garment({ id: 'g3', name: 'nada' })];
  const matched = scoring.resolveMatchedRowByGarment(rows, garments, new Map());

  assert.deepEqual([...matched.keys()].sort(), ['g1', 'g2']);
  assert.equal(matched.get('g1')!.row.rowId, 'r1');
  assert.equal(matched.get('g1')!.score, 72);
  assert.equal(matched.get('g2')!.row.rowId, 'r2');
  assert.equal(matched.get('g2')!.score, 42);
  assert.equal(scoring.MIN_AUTO_MATCH_SCORE, 34);
});

test('workbook helpers resolve relative paths, mime types and header rows', () => {
  assert.equal(workbook.resolveRelativeXmlPath('xl/worksheets/sheet1.xml', '../drawings/drawing1.xml'), 'xl/drawings/drawing1.xml');
  assert.equal(workbook.resolveRelativeXmlPath('xl/worksheets/sheet1.xml', '/xl/media/a.png'), 'xl/media/a.png');
  assert.equal(workbook.mimeTypeFromPath('a/B.JPEG'), 'image/jpeg');
  assert.equal(workbook.mimeTypeFromPath('a/b.webp'), 'image/webp');
  assert.equal(workbook.mimeTypeFromPath('a/b.emf'), 'image/png');
  assert.equal(workbook.pickHeaderRowIndex([['Reporte'], ['', ''], ['Foto', 'SPU', 'Color'], ['x', 'y', 'z']]), 2);
});
