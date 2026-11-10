import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SpreadsheetTemplateCategory } from '../shared/src/types';

const require = createRequire(import.meta.url);
const XLSX = require('../functions/node_modules/xlsx');
const sourceSpreadsheetMatching = require('../functions/lib/functions/src/spreadsheets/sourceSpreadsheetMatching.js');

const {
  buildSourceSpreadsheetRows,
  buildSourceSpreadsheetSuggestions,
  resolveSourceSpreadsheetRowColor,
} = sourceSpreadsheetMatching as typeof import('../functions/src/spreadsheets/sourceSpreadsheetMatching');

const column = (key: string, label: string) => ({ key, label }) as SpreadsheetTemplateCategory['columns'][number];

const category = {
  label: 'Poleras',
  columns: [
    column('supplier_code', 'SPU'),
    column('supplier_sku', 'SKU'),
    column('default_product_name_es', 'Nombre de producto'),
    column('default_product_desc_es', 'Descripción del producto'),
    column('brand_code', 'Marca'),
    column('origin_code', 'Origen'),
    column('ip_character', 'Propiedad intelectual'),
    column('stock', 'Stock'),
    column('price', 'Precio'),
    column('package_weight', 'Peso'),
    column('package_length', 'Largo'),
    column('package_width', 'Ancho'),
    column('package_height', 'Alto'),
    column('main_attribute_value', 'Color'),
    column('main_img', 'Imagen principal'),
    column('material', 'Material'),
    column('extra_size', 'Talla extra'),
  ],
  attributes: [{ name: 'Color', values: ['Rojo intenso', 'Azul'] }],
} as unknown as SpreadsheetTemplateCategory;

const buildTextWorkbook = () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['SPU', 'SKU', 'Nombre del producto', 'Descripción', 'Color', 'Talla', 'Stock', 'Precio', 'Peso', 'Largo', 'Ancho', 'Alto', 'Marca', 'Origen', 'Personaje'],
    ['A100', 'A100-RJ', 'Polera básica', 'Polera de algodón', 'Rojo', 'M', '12', '9990', '200', '30', '20', '5', 'Tuto', 'Chile', 'Mickey'],
    ['B200', '', 'Pantalón', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  return { SheetNames: ['Hoja1'], Sheets: { Hoja1: worksheet } };
};

test('buildSourceSpreadsheetSuggestions maps every known template column from the matched source row', () => {
  const parsed = buildSourceSpreadsheetRows(buildTextWorkbook());
  const row = parsed.rows[0];
  const suggestions = buildSourceSpreadsheetSuggestions(category, {
    row,
    score: 80,
    strategy: 'text',
    evidence: ['uno', 'dos', 'tres', 'cuatro'],
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(suggestions).map(([key, suggestion]) => [key, suggestion.value])),
    {
      supplier_code: 'A100',
      supplier_sku: 'A100-RJ',
      default_product_name_es: 'Polera básica',
      default_product_desc_es: 'Polera de algodón',
      brand_code: 'Tuto',
      origin_code: 'Chile',
      ip_character: 'Mickey',
      stock: '12',
      price: '9990',
      package_weight: '200',
      package_length: '30',
      package_width: '20',
      package_height: '5',
      main_attribute_value: 'Rojo',
      extra_size: 'M',
    },
  );
  assert.deepEqual(suggestions.supplier_code, {
    value: 'A100',
    confidence: 0.8,
    reasoning: 'Valor recuperado de la fila 2 del spreadsheet fuente. Match text con score 80. Evidencia: uno; dos; tres.',
    source: 'spreadsheet_source',
  });
});

test('buildSourceSpreadsheetSuggestions clamps confidence, omits empty evidence and handles a missing match', () => {
  const parsed = buildSourceSpreadsheetRows(buildTextWorkbook());
  assert.deepEqual(buildSourceSpreadsheetSuggestions(category, null), {});

  const low = buildSourceSpreadsheetSuggestions(category, { row: parsed.rows[1], score: 10, strategy: 'mixed', evidence: [] });
  assert.deepEqual(Object.keys(low), ['supplier_code', 'supplier_sku', 'default_product_name_es']);
  assert.equal(low.supplier_sku.value, 'B200');
  assert.equal(low.supplier_code.confidence, 0.62);
  assert.equal(low.supplier_code.reasoning, 'Valor recuperado de la fila 3 del spreadsheet fuente. Match mixed con score 10.');

  const high = buildSourceSpreadsheetSuggestions(category, { row: parsed.rows[0], score: 140, strategy: 'image', evidence: [] });
  assert.equal(high.supplier_code.confidence, 0.98);
});

test('resolveSourceSpreadsheetRowColor snaps the row color to the category color options', () => {
  const parsed = buildSourceSpreadsheetRows(buildTextWorkbook());
  assert.equal(resolveSourceSpreadsheetRowColor(null, category), null);
  assert.equal(resolveSourceSpreadsheetRowColor(parsed.rows[0], category), 'Rojo intenso');
  assert.equal(resolveSourceSpreadsheetRowColor(parsed.rows[0], { ...category, attributes: [] }), 'Rojo');
  assert.equal(resolveSourceSpreadsheetRowColor(parsed.rows[1], category), null);
});

test('buildSourceSpreadsheetRows reads embedded drawings, reuses SPU photos and ignores rows without useful text', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Foto', 'SPU', 'Color', 'Notas'],
    ['', 'X1', 'Rojo', ''],
    ['', 'X1', 'Azul', ''],
    ['', 'Z9', '', ''],
    ['', '', '', 'x'],
  ]);
  const imageBytes = Buffer.from('fake-image-bytes');
  const workbook = {
    SheetNames: ['Hoja1'],
    Sheets: { Hoja1: worksheet },
    files: {
      'xl/workbook.xml': { content: '<workbook><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      'xl/_rels/workbook.xml.rels': {
        content: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas/officeDocument/2006/relationships/worksheet"/></Relationships>',
      },
      'xl/worksheets/_rels/sheet1.xml.rels': {
        content: '<Relationships><Relationship Id="rId1" Type="http://schemas/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      },
      'xl/drawings/drawing1.xml': {
        content: '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><a:blip r:embed="rId7"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
      },
      'xl/drawings/_rels/drawing1.xml.rels': {
        content: '<Relationships><Relationship Id="rId7" Target="../media/image1.jpeg"/></Relationships>',
      },
      'xl/media/image1.jpeg': { content: imageBytes },
    },
  };

  const parsed = buildSourceSpreadsheetRows(workbook);

  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.directRowsWithPhotos, 1);
  assert.equal(parsed.reusedSpuPhotoRows, 1);
  assert.equal(parsed.ignoredRows, 1);
  assert.equal(parsed.textOnlyRows, 1);
  assert.deepEqual(parsed.detectedColumns, ['foto', 'codigo/modelo', 'color']);
  assert.deepEqual(parsed.rows.map((row) => row.rowId), ['row-2', 'row-3', 'row-4']);
  assert.deepEqual(parsed.rows[0].image, { rowNumber: 2, columnIndex: 0, mimeType: 'image/jpeg', base64: imageBytes.toString('base64') });
  assert.equal(parsed.rows[1].image, parsed.rows[0].image);
  assert.equal(parsed.rows[1].color, 'Azul');
  assert.equal(parsed.rows[2].image, null);
  assert.ok(parsed.rows.every((row) => row.fingerprint === null));
});
