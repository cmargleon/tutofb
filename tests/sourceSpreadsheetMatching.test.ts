import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../functions/node_modules/xlsx');
const sourceSpreadsheetMatching = require('../functions/lib/functions/src/spreadsheets/sourceSpreadsheetMatching.js');

const {
  buildSourceSpreadsheetRows,
} = sourceSpreadsheetMatching as typeof import('../functions/src/spreadsheets/sourceSpreadsheetMatching');

test('buildSourceSpreadsheetRows detecta Excel fuente con MODELO, DESCRIPCIÓN y costo', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['', 'FOTO', 'MODELO', 'DESCRIPCIÓN', 'Costo iva incluido'],
    ['1', '', '39496', 'Conjunto short', '$399.00'],
    ['2', '', '2026314', 'Vestido', '$249.00'],
  ]);
  const workbook = {
    SheetNames: ['Hoja2'],
    Sheets: {
      Hoja2: worksheet,
    },
  };

  const parsed = buildSourceSpreadsheetRows(workbook);

  assert.equal(parsed.sheetName, 'Hoja2');
  assert.equal(parsed.headerRowNumber, 1);
  assert.equal(parsed.totalRows, 2);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.ignoredRows, 0);
  assert.equal(parsed.textOnlyRows, 2);
  assert.deepEqual(parsed.detectedColumns, ['foto', 'codigo/modelo', 'descripcion', 'precio/costo']);
  assert.deepEqual(parsed.rows[0].codeValues, ['39496']);
  assert.equal(parsed.rows[0].description, 'Conjunto short');
  assert.match(parsed.rows[0].searchableText, /399/);
});
