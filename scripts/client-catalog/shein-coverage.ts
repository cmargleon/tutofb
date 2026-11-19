/**
 * Coverage of real SHEIN bulk templates against the universal client catalog.
 *
 *   node --import tsx scripts/client-catalog/shein-coverage.ts <template.xlsx>... [--out report.md] [--json report.json]
 *
 * Reads only local files. Uses the same parser as the template import in Tuto.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import type { SpreadsheetTemplateCategory } from '../../shared/src/types';

// shared/ is CommonJS (no "type" in its package.json): load it through require.
const require = createRequire(import.meta.url);
const { familiesOfRoute, routeMarketplaceCategory, templateCategoryCoverage } = require('../../shared/src/clientCatalog/index.ts') as typeof import('../../shared/src/clientCatalog');
// The parser module chain touches firebase-admin at load time: an offline demo app is enough (no calls are made).
const admin = require('../../functions/node_modules/firebase-admin') as typeof import('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-client-catalog', storageBucket: 'demo-client-catalog.appspot.com' });
const { parseSpreadsheetTemplateWorkbook } = require('../../functions/src/spreadsheets/templateWorkbook.ts') as typeof import('../../functions/src/spreadsheets/templateWorkbook');

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = flag('--out');
const jsonOut = flag('--json');
const files = args;
if (!files.length) throw new Error('Indica al menos una plantilla de SHEIN (.xlsx).');

const lines: string[] = ['# Cobertura de plantillas reales de SHEIN', '', 'Generado con `scripts/client-catalog/shein-coverage.ts`. Solo lectura de archivos locales.', ''];
const report: unknown[] = [];
const totals = { categories: 0, unmappedRequired: 0, valueColumns: 0, exact: 0, equivalent: 0, rule: 0, missing: 0 };

for (const file of files) {
  const { categories } = parseSpreadsheetTemplateWorkbook({ clientId: 'local', clientNameSnapshot: 'local', storagePath: '', originalFileName: basename(file), createdByUid: 'local', buffer: readFileSync(file) });
  lines.push(`## ${basename(file)}`, '');
  for (const category of categories as SpreadsheetTemplateCategory[]) {
    totals.categories++;
    const route = routeMarketplaceCategory('shein', category.sheetName);
    const coverage = templateCategoryCoverage('shein', category, route);
    report.push({ file: basename(file), route, coverage });
    const unmapped = coverage.columns.filter(c => !c.ruleId);
    totals.unmappedRequired += coverage.unmappedRequired.length;
    lines.push(`### ${category.sheetName}`, '',
      `- Ruta: ${route.confidence} → familias ${familiesOfRoute(route).join(', ') || '—'}; tipos ${route.typeIds.join(', ') || '—'}; público ${route.audience ?? 'Tuto lo infiere'}`,
      `- Columnas: ${coverage.columns.length}; con origen: ${coverage.columns.length - unmapped.length}; obligatorias sin origen: ${coverage.unmappedRequired.join(', ') || 'ninguna'}`,
      ...(unmapped.length ? [`- Sin regla (opcionales): ${unmapped.map(c => c.label).join(', ')}`] : []));
    for (const column of coverage.columns.filter(c => c.values)) {
      totals.valueColumns++;
      const count = (kind: string) => column.values!.filter(v => v.kind === kind).length;
      totals.exact += count('exacto'); totals.equivalent += count('equivalente'); totals.rule += count('regla'); totals.missing += count('sin_equivalente');
      const missing = column.values!.filter(v => v.kind === 'sin_equivalente').map(v => v.universal);
      const approx = column.values!.filter(v => v.kind !== 'exacto' && v.target).map(v => `${v.universal}→${v.target}`);
      lines.push(`- Valores «${column.label}» (${column.list}, ${column.allowedCount} opciones en la hoja): ${column.values!.length - missing.length}/${column.values!.length} con equivalente`
        + (approx.length ? `. Equivalencias: ${approx.join('; ')}` : '') + (missing.length ? `. **Sin equivalente:** ${missing.join(', ')}` : ''));
    }
    lines.push('');
  }
}
lines.splice(4, 0, `**Resumen:** ${totals.categories} categorías; ${totals.unmappedRequired} columnas obligatorias sin origen; ${totals.valueColumns} columnas con lista revisadas: `
  + `${totals.exact} valores exactos, ${totals.equivalent} por equivalencia, ${totals.rule} por regla y ${totals.missing} sin equivalente.`, '');
if (out) writeFileSync(out, lines.join('\n'));
else console.log(lines.join('\n'));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
console.error(JSON.stringify(totals));
