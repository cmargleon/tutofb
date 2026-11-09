import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.TUTO_REAL_TEMPLATE_DIR);
test('real client SHEIN templates preserve every ZIP part, all validations, named ranges, formulas and sheet metadata', { skip: !enabled }, async () => {
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-local-template-test', storageBucket: 'demo-local.appspot.com' });
  const XLSX = require('../functions/node_modules/xlsx'); const JSZip = require('../functions/node_modules/jszip');
  const { inspectWorkbookPackage, patchWorkbookCells, validationOptions } = require('../functions/lib/functions/src/spreadsheets/ooxmlWorkbook.js');
  const { parseSpreadsheetTemplateWorkbook } = require('../functions/lib/functions/src/spreadsheets/templateWorkbook.js');
  const { analyzeMarketplaceTemplate } = require('../functions/lib/functions/src/spreadsheets/marketplaceTemplates.js');
  const reports = [];
  for (const name of ['barbie', 'vans']) {
    const buffer = readFileSync(`${process.env.TUTO_REAL_TEMPLATE_DIR}/${name}.xlsx`);
    const parsed = parseSpreadsheetTemplateWorkbook({ buffer, clientId: 'local', clientNameSnapshot: 'QA', storagePath: 'local', originalFileName: `${name}.xlsx`, createdByUid: 'qa' });
    const analyzed = await analyzeMarketplaceTemplate(buffer, 'shein', parsed.template, parsed.categories);
    const inspection = await inspectWorkbookPackage(buffer);
    assert.ok(analyzed.categories.length >= 8); assert.equal(inspection.warnings.length, 0);
    const patches = analyzed.categories.map((c: any) => ({ sheetName: c.sheetName, cells: [{ address: `${c.columns.find((v: any) => v.key === 'supplier_code').letter}${c.rowStart}`, value: 'TUTO-STRUCTURE-QA' }] }));
    const afterBuffer = await patchWorkbookCells(buffer, patches);
    const before = await JSZip.loadAsync(buffer); const after = await JSZip.loadAsync(afterBuffer);
    assert.deepEqual(Object.keys(after.files), Object.keys(before.files));
    const touched = new Set(inspection.sheets.filter((s: any) => patches.some((p: any) => p.sheetName === s.name)).map((s: any) => s.path));
    for (const [path, entry] of Object.entries(before.files) as any) {
      if (entry.dir) continue;
      const original = await entry.async('nodebuffer'); const output = await after.file(path).async('nodebuffer');
      if (!touched.has(path)) assert.deepEqual(output, original, `${name}/${path}`);
      else {
        const xml = original.toString(); const newXml = output.toString();
        for (const pattern of [/<dataValidations\b[\s\S]*?<\/dataValidations>/g, /<f\b[^>]*>[\s\S]*?<\/f>/g, /<mergeCells\b[\s\S]*?<\/mergeCells>/g]) assert.deepEqual(newXml.match(pattern), xml.match(pattern), `${name}/${path}`);
      }
    }
    const wb = XLSX.read(afterBuffer, { type: 'buffer' });
    for (const p of patches) assert.equal(wb.Sheets[p.sheetName][p.cells[0].address].v, 'TUTO-STRUCTURE-QA');
    // Reproduce the old CE writer's loss using the real workbook, without using it in production.
    const rebuilt = await inspectWorkbookPackage(XLSX.write(XLSX.read(buffer, { type: 'buffer' }), { type: 'buffer', bookType: 'xlsx' }));
    const listCount = inspection.sheets.reduce((n: number, s: any) => n + s.validations.length, 0);
    const rebuiltListCount = rebuilt.sheets.reduce((n: number, s: any) => n + s.validations.length, 0);
    assert.ok(listCount > 0); assert.ok(rebuiltListCount < listCount);
    let dependenciesResolved = 0;
    for (const category of analyzed.categories) for (const column of category.columns) if (column.dropdownDependency) {
      const sheet = inspection.sheets.find((s: any) => s.name === category.sheetName);
      const validation = sheet.validations.find((v: any) => v.formula === column.dropdownFormula);
      const dependency = category.columns.find((c: any) => c.key === column.dropdownDependency.columnKey);
      for (const [value, allowed] of Object.entries(column.dropdownDependency.optionsByValue)) {
        assert.deepEqual(validationOptions(inspection, validation, `${column.letter}7`, { [dependency.letter]: value }), allowed);
        assert.deepEqual(validationOptions(inspection, validation, `${column.letter}8`, { [dependency.letter]: value }), allowed);
      }
      dependenciesResolved++;
    }
    assert.ok(dependenciesResolved > 0);
    reports.push({ name, categories: analyzed.categories.map((c: any) => c.label), sheetCount: inspection.sheets.length, originalValidations: listCount, rebuiltValidations: rebuiltListCount, dependentColumnsResolved: dependenciesResolved, unresolvedStaticLists: analyzed.categories.flatMap((c: any) => c.columns.filter((col: any) => col.validation?.startsWith('Lista sin resolver')).map((col: any) => ({ category: c.label, column: col.key, formula: col.dropdownFormula }))), preservation: 'all non-target ZIP parts identical; validations, formulas, merges identical in target sheets', publishingValidation: 'not performed' });
  }
  writeFileSync('/tmp/tuto-marketplace-real-verification.json', JSON.stringify(reports, null, 2));
});
