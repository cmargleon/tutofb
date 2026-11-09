import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const JSZip = require('../functions/node_modules/jszip');
const { patchWorkbookCells, inspectWorkbookPackage, xmlAttrs, assertPatchableCells } = require('../functions/lib/functions/src/spreadsheets/ooxmlWorkbook.js');

// Structural fixture only. This is not an official marketplace template or certification.
export const fixture = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/><sheet name="Listas" state="hidden" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="Colors">Listas!$A$1:$A$2</definedName></definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Id="rId1"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><dimension ref="A1:C9"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SKU</t></is></c></row><row r="7" ht="20"><c r="A7" s="2"/><c r="C7" s="3"><f>1+1</f><v>2</v></c></row></sheetData><mergeCells><mergeCell ref="A2:B2"/></mergeCells><dataValidations count="1"><dataValidation sqref="B7:B9" type="list"><formula1>Colors</formula1></dataValidation></dataValidations></worksheet>');
  zip.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Rojo</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Azul</t></is></c></row></sheetData></worksheet>');
  zip.file('xl/styles.xml', '<styleSheet/>');
  return zip.generateAsync({ type: 'nodebuffer' });
};
test('patches only target cells and preserves hidden sheets, names, validations, merges, styles, formulas and ZIP parts', async () => {
  const before = await fixture();
  const after = await patchWorkbookCells(before, [{ sheetName: 'Productos', cells: [{ address: 'A7', value: '00123' }, { address: 'B7', value: 'Rojo' }, { address: 'A8', value: '=not-a-formula' }] }]);
  const original = await JSZip.loadAsync(before); const output = await JSZip.loadAsync(after);
  assert.deepEqual(Object.keys(output.files), Object.keys(original.files));
  for (const path of Object.keys(original.files).filter(p => p !== 'xl/worksheets/sheet1.xml' && !original.files[p].dir)) assert.equal(await output.file(path).async('string'), await original.file(path).async('string'), path);
  const xml = await output.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /r="A7" s="2" t="inlineStr"/); assert.match(xml, /<t xml:space="preserve">00123<\/t>/);
  assert.match(xml, /<f>1\+1<\/f>/); assert.match(xml, /<dataValidations[\s\S]*Colors/); assert.match(xml, /<mergeCells>/);
  assert.match(xml, /<t xml:space="preserve">=not-a-formula<\/t>/);
  const inspection = await inspectWorkbookPackage(before);
  assert.deepEqual(inspection.sheets.map((s: any) => s.name), ['Productos', 'Listas']);
  assert.deepEqual(inspection.sheets[0].validations[0].options, ['Rojo', 'Azul']);
});
test('refuses formula overwrite, merged cells, unknown sheets, invalid coordinates and duplicate writes', async () => {
  for (const cells of [[{ address: 'C7', value: 'x' }], [{ address: 'B2', value: 'x' }], [{ address: 'A0', value: 'x' }], [{ address: 'A7', value: 'x' }, { address: 'A7', value: 'y' }]]) {
    await assert.rejects(() => fixture().then((b: Buffer) => patchWorkbookCells(b, [{ sheetName: 'Productos', cells }])));
  }
  await assert.rejects(() => fixture().then((b: Buffer) => patchWorkbookCells(b, [{ sheetName: 'Missing', cells: [] }])));
});

test('XML attributes preserve apostrophes and read-only prevalidation detects forbidden coordinates', async () => {
  assert.deepEqual(xmlAttrs(`name="Women's wear" r:id="rId1"`), { name: "Women's wear", 'r:id': 'rId1' });
  const inspection = await inspectWorkbookPackage(await fixture());
  assert.throws(() => assertPatchableCells(inspection, [{ sheetName: 'Productos', cells: [{ address: 'B2', value: 'invalid' }] }]));
  assert.throws(() => assertPatchableCells(inspection, [{ sheetName: 'Productos', cells: [{ address: 'C7', value: 'formula overwrite' }] }]));
});
