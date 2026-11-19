/**
 * Plan a client catalog sheet from real marketplace templates (offline; no Google calls).
 *
 *   node --import tsx scripts/client-catalog/plan.ts --client "Nombre" --marketplaces shein[,amazon...] \
 *     --shein plantilla1.xlsx[,plantilla2.xlsx] [--only "Vaso,Tazas"] [--previous layout.json] --out plan.json
 *
 * Output: { layout, changes, pending, coverage, requests }. `requests` go to spreadsheets.batchUpdate on a
 * spreadsheet created with CATALOG_SPREADSHEET_PROPERTIES (create) or holding `--previous` (update).
 * This mirrors what the future "Crear/actualizar carpeta del cliente" action will do server side.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import type { ClientCatalogConfig, CatalogLayout, CategoryCoverage, CatalogListId } from '../../shared/src/clientCatalog';
import type { MarketplaceId } from '../../shared/src/marketplaces';
import type { SpreadsheetTemplateCategory } from '../../shared/src/types';

const require = createRequire(import.meta.url);
const cc = require('../../shared/src/clientCatalog/index.ts') as typeof import('../../shared/src/clientCatalog');
const admin = require('../../functions/node_modules/firebase-admin') as typeof import('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-client-catalog', storageBucket: 'demo-client-catalog.appspot.com' });
const { parseSpreadsheetTemplateWorkbook } = require('../../functions/src/spreadsheets/templateWorkbook.ts') as typeof import('../../functions/src/spreadsheets/templateWorkbook');

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const marketplaces = (opt('--marketplaces') || 'shein').split(',') as MarketplaceId[];
const only = opt('--only')?.split(',').map(s => s.trim().toLowerCase());
// --previous: layout JSON; --previous-state: the text of _TUTO!A:A (one chunk per line), as read from the sheet.
const previous = opt('--previous') ? JSON.parse(readFileSync(opt('--previous')!, 'utf8')) as CatalogLayout
  : opt('--previous-state') ? cc.parseLayoutState(readFileSync(opt('--previous-state')!, 'utf8').split('\n')) : null;

const categories: Array<{ input: ClientCatalogConfig['categories'][number]; category: SpreadsheetTemplateCategory }> = [];
for (const file of (opt('--shein') || '').split(',').filter(Boolean)) {
  const parsed = parseSpreadsheetTemplateWorkbook({ clientId: 'local', clientNameSnapshot: 'local', storagePath: '', originalFileName: basename(file), createdByUid: 'local', buffer: readFileSync(file) });
  for (const category of parsed.categories as SpreadsheetTemplateCategory[]) {
    if (only && !only.some(o => category.sheetName.toLowerCase().startsWith(o))) continue;
    if (categories.some(c => c.category.sheetName === category.sheetName)) continue;
    categories.push({ category, input: { marketplaceId: 'shein', templateId: basename(file), categoryId: cc.sheinCategoryKey(category.sheetName) || category.sheetName, label: category.sheetName } });
  }
}

// Value restrictions: per family and list, only universal values with an equivalent in every active real category.
const coverage: CategoryCoverage[] = categories.map(c => cc.templateCategoryCoverage('shein', c.category, cc.routeMarketplaceCategory('shein', c.input.label)));
const valueRestrictions: NonNullable<ClientCatalogConfig['valueRestrictions']> = {};
categories.forEach((c, i) => {
  for (const family of cc.familiesOfRoute(cc.routeMarketplaceCategory('shein', c.input.label))) {
    for (const col of coverage[i].columns.filter(x => x.values?.length)) {
      const listId = col.list as CatalogListId;
      const ok = col.values!.filter(v => v.kind !== 'sin_equivalente').map(v => v.universal);
      const current = valueRestrictions[family]?.[listId];
      (valueRestrictions[family] ??= {})[listId] = current ? current.filter(v => ok.includes(v)) : ok;
    }
  }
});

// --in-use: JSON { "<familia>.<campo>": ["valor", …] } with values already present in the client's sheet.
const valuesInUse = opt('--in-use') ? JSON.parse(readFileSync(opt('--in-use')!, 'utf8')) as Record<string, string[]> : undefined;
// --all-known-shein: also enable every confirmed SHEIN route without a local template (no value restrictions for them).
const extra = args.includes('--all-known-shein') ? Object.entries(cc.SHEIN_CATEGORY_ROUTES)
  .filter(([key]) => !categories.some(c => c.input.categoryId === key))
  .map(([key, route]) => ({ marketplaceId: 'shein' as const, templateId: 'sin-plantilla-local', categoryId: key, label: `${route.reason}(${key})` })) : [];
const config: ClientCatalogConfig = { clientId: 'demo', clientName: opt('--client') || 'Cliente', marketplaces, categories: [...categories.map(c => c.input), ...extra],
  valueRestrictions, ...(valuesInUse ? { valuesInUse } : {}) };
const plan = cc.planCatalogLayout(config, previous);
const requests = previous ? cc.buildUpdateRequests(previous, plan.layout, plan.changes) : cc.buildCreateRequests(plan.layout);
const out = opt('--out') || 'plan.json';
const reviewFormulas = Object.fromEntries(plan.layout.tabs.map(t => [t.familyId, cc.reviewFormula(plan.layout, t)]));
writeFileSync(out, JSON.stringify({ config, ...plan, reviewFormulas, coverage: coverage.map(c => ({ category: c.category, unmappedRequired: c.unmappedRequired, valueGaps: c.valueGaps })), requests }, null, 2));
console.log(JSON.stringify({
  tabs: plan.layout.tabs.map(t => `${t.title} (${t.status}): ${t.types.map(x => x.label + (x.status === 'retired' ? '†' : '')).join(', ')} — ${t.columns.filter(c => c.status === 'active').length} columnas`),
  pending: plan.pending.map(p => `${p.label}: ${p.route.reason}`), changes: plan.changes.length, requests: requests.length, bytes: JSON.stringify(requests).length,
}, null, 2));
