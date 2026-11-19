import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SpreadsheetTemplateCategory } from '../shared/src/types';
import type { ClientCatalogConfig } from '../shared/src/clientCatalog';

// shared/ is CommonJS: load through require so every export is available.
const require = createRequire(import.meta.url);
const cc = require('../shared/src/clientCatalog/index.ts') as typeof import('../shared/src/clientCatalog');

const category = (label: string, marketplaceId: ClientCatalogConfig['marketplaces'][number] = 'shein') =>
  ({ marketplaceId, templateId: 't1', categoryId: label.replace(/\W+/g, '-'), label });
const sheinOnly = (labels: string[]): ClientCatalogConfig => ({ clientId: 'c1', clientName: 'Cliente', marketplaces: ['shein'], categories: labels.map(l => category(l)) });
const tab = (layout: import('../shared/src/clientCatalog').CatalogLayout, id: string) => layout.tabs.find(t => t.familyId === id)!;
const list = (layout: import('../shared/src/clientCatalog').CatalogLayout, id: string) => layout.lists.find(l => l.id === id)?.values;

test('routing: confirmed SHEIN routes, keyword suggestions and unresolved categories', () => {
  assert.deepEqual(cc.routeMarketplaceCategory('shein', 'Vaso(1083-3218)').typeIds, ['vaso']);
  const kids = cc.routeMarketplaceCategory('shein', 'Blusas Niñas (8-12)(7401-2002)');
  assert.equal(kids.audience, 'nina'); assert.equal(kids.confidence, 'known');
  const guess = cc.routeMarketplaceCategory('shein', 'Sandalias de Mujer(999-99999)');
  assert.equal(guess.confidence, 'suggested'); assert.deepEqual(guess.typeIds, ['sandalias']); assert.equal(guess.audience, 'mujer');
  assert.equal(cc.routeMarketplaceCategory('shein', 'Cosa rara(1-2)').confidence, 'unresolved');
});

test('layout: only the families, types and fields of the enabled categories; single marketplace has no "Publicar en" column', () => {
  const { layout, pending } = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)', 'Tazas(204-1948)', 'Blusas Niñas (8-12)(7401-2002)', 'Cosa rara(1-2)']));
  assert.deepEqual(layout.tabs.map(t => t.title), ['ROPA', 'COCINA Y MESA']);
  assert.equal(pending.length, 1, 'unresolved categories wait for confirmation instead of enabling a tab');
  const kitchen = tab(layout, 'cocina');
  assert.deepEqual(list(layout, 'cocina.tipo'), ['Vaso', 'Taza']);
  assert.ok(!kitchen.columns.some(c => c.key === 'funcionamiento'), 'vasos/tazas do not ask for a power source');
  assert.ok(kitchen.columns.some(c => c.key === 'material_alimentos'));
  assert.ok(!layout.tabs.some(t => t.columns.some(c => c.key.startsWith('publicar_'))));
  assert.deepEqual(list(layout, 'ropa.tipo'), ['Blusa', 'Top']);
});

test('layout update: adding a marketplace appends columns; removing a category hides its tab and keeps history; re-adding restores it', () => {
  const first = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)', 'Blusas Niñas (8-12)(7401-2002)'])).layout;
  const kitchenColumns = tab(first, 'cocina').columns.map(c => c.key);

  const second = cc.planCatalogLayout({ ...sheinOnly(['Vaso(1083-3218)']), marketplaces: ['shein', 'mercado-libre'] }, first);
  assert.deepEqual(tab(second.layout, 'cocina').columns.map(c => c.key), [...kitchenColumns, 'publicar_shein', 'publicar_mercado-libre'], 'existing columns never move');
  assert.equal(tab(second.layout, 'ropa').status, 'retired');
  assert.deepEqual(tab(second.layout, 'ropa').columns.map(c => c.key), tab(first, 'ropa').columns.map(c => c.key), 'a retired tab is frozen');
  assert.ok(second.changes.some(c => c.kind === 'retire_tab' && c.familyId === 'ropa'));
  assert.ok(second.changes.some(c => c.kind === 'add_column' && c.familyId === 'cocina' && c.key === 'publicar_shein'));

  const third = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)', 'Blusas Niñas (8-12)(7401-2002)']), second.layout);
  assert.equal(tab(third.layout, 'ropa').status, 'active');
  assert.ok(third.changes.some(c => c.kind === 'restore_tab' && c.familyId === 'ropa'));
  const kitchen = tab(third.layout, 'cocina');
  assert.deepEqual(kitchen.columns.filter(c => c.status === 'retired').map(c => c.key), ['publicar_shein', 'publicar_mercado-libre'], 'back to one marketplace: columns hidden, not deleted');
});

test('layout update: a removed category retires its product types but keeps them valid for historical rows', () => {
  const first = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)', 'Tazas(204-1948)'])).layout;
  const next = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)']), first).layout;
  assert.deepEqual(tab(next, 'cocina').types.map(t => [t.label, t.status]), [['Vaso', 'active'], ['Taza', 'retired']]);
  assert.deepEqual(list(next, 'cocina.tipo'), ['Vaso', 'Taza']);
  assert.deepEqual(list(next, 'cocina.tipo_retirado'), ['Taza']);
  assert.match(cc.reviewFormula(next, tab(next, 'cocina')), /Tipo de producto retirado/);
});

test('value restrictions narrow a dropdown to mappable values and always keep wildcards', () => {
  const config = { ...sheinOnly(['Vaso(1083-3218)']), valueRestrictions: { cocina: { material_alimentos: ['Vidrio', 'Tritán'] } } };
  assert.deepEqual(list(cc.planCatalogLayout(config).layout, 'cocina.material_alimentos'), ['No aplica', 'Vidrio', 'Tritán', 'Otro']);
});

test('values already used in the sheet stay selectable when a restriction would drop them', () => {
  const config = { ...sheinOnly(['Vaso(1083-3218)']), valueRestrictions: { cocina: { material: ['Vidrio'] } }, valuesInUse: { 'cocina.material2': ['Bambú'] } };
  const layout = cc.planCatalogLayout(config).layout;
  assert.deepEqual(list(layout, 'cocina.material2'), ['Vidrio', 'Bambú', 'Otro']);
  assert.deepEqual(list(layout, 'cocina.material1'), ['Vidrio', 'Otro']);
});

test('value mapping: exact, equivalent, size rules, wildcards and gaps never invent values', () => {
  const allowed = ['Negro', 'Beis', 'azul real', '8Y', '0-3M', 'EUR39'];
  const pick = (list: Parameters<typeof cc.mapUniversalValues>[1], value: string) => cc.mapUniversalValues('shein', list, [value], allowed)[0];
  assert.deepEqual(pick('color', 'negro'), { universal: 'negro', target: 'Negro', kind: 'exacto' });
  assert.equal(pick('color', 'Beige').target, 'Beis');
  assert.equal(pick('color', 'Azul rey').target, 'azul real');
  assert.equal(pick('talla_ropa', '8 años').target, '8Y');
  assert.equal(pick('talla_ropa', '0-3 meses').target, '0-3M');
  assert.equal(pick('talla_calzado', '25').target, 'EUR39');
  assert.equal(pick('color', 'Otro').kind, 'comodin');
  assert.deepEqual(pick('color', 'Camel'), { universal: 'Camel', target: null, kind: 'sin_equivalente' });
  assert.equal(cc.sheinComposition([{ fiber: 'Algodón', pct: 95 }, { fiber: 'Elastano', pct: 5 }]), 'Algodón*Elastano=95*5');
  assert.equal(cc.textComposition([{ fiber: 'Algodón', pct: 95 }, { fiber: 'Elastano', pct: 5 }]), '95% Algodón, 5% Elastano');
});

test('coverage of a SHEIN category: required columns without source and family-specific rules', () => {
  const col = (key: string, label: string, required = false, dropdownOptions?: string[]) =>
    ({ key, label, required, index: 0, letter: 'A', requirementLabel: null, guidance: null, validation: null, ...(dropdownOptions ? { dropdownOptions } : {}) });
  const shirt: SpreadsheetTemplateCategory = { templateId: 't', clientId: 'c', sheetName: 'Blusas Niñas (8-12)(7401-2002)', label: 'Blusas Niñas (8-12)(7401-2002)', rowStart: 7,
    attributes: [], createdAt: null, updatedAt: null, columns: [
      col('supplier_code', 'Número del artículo', true), col('main_attribute_value', 'Especificación 1 Contenido', true, ['Negro', 'Beis']),
      col('attr_160', 'Material(160)', false, ['Chifón', 'Mezclilla']), col('attr_999', 'Cosa nueva(999)', true)] };
  const coverage = cc.templateCategoryCoverage('shein', shirt, cc.routeMarketplaceCategory('shein', shirt.sheetName));
  assert.deepEqual(coverage.unmappedRequired, ['Cosa nueva(999)']);
  assert.equal(coverage.columns.find(c => c.key === 'attr_160')?.list, undefined, 'clothing «Material» is the fabric type (Tuto), not checked against fibers');
  assert.ok(coverage.valueGaps.find(g => g.column === 'Especificación 1 Contenido')?.missing.includes('Camel'));
  const restricted = cc.exportableValues('color', [coverage]);
  assert.ok(restricted.includes('Negro') && restricted.includes('Beige') && !restricted.includes('Camel'));
});

test('sheet requests: create builds tabs, lists and validations; updates never delete anything', () => {
  const first = cc.planCatalogLayout(sheinOnly(['Vaso(1083-3218)'])).layout;
  const create = cc.buildCreateRequests(first);
  const kitchen = tab(first, 'cocina');
  assert.ok(create.some(r => (r as any).addSheet?.properties.sheetId === kitchen.sheetId && (r as any).addSheet.properties.title === 'COCINA Y MESA'));
  const colorIndex = kitchen.columns.findIndex(c => c.key === 'color');
  const colorList = first.lists.find(l => l.id === 'cocina.color')!;
  const dv = create.find(r => (r as any).setDataValidation?.range.sheetId === kitchen.sheetId && (r as any).setDataValidation.range.startColumnIndex === colorIndex) as any;
  assert.equal(dv.setDataValidation.rule.condition.values[0].userEnteredValue, `=LISTAS!$${cc.columnLetter(colorList.column)}$2:$${cc.columnLetter(colorList.column)}$401`);
  const formula = cc.reviewFormula(first, kitchen);
  assert.match(formula, /^=\{"Revisión";ARRAYFORMULA\(/);
  assert.match(formula, /COUNTIF\(C4:C,C4:C\)>1,"SKU repetido"/);

  const plan = cc.planCatalogLayout({ ...sheinOnly(['Vaso(1083-3218)']), marketplaces: ['shein', 'amazon'] }, first);
  const update = cc.buildUpdateRequests(first, plan.layout, plan.changes);
  const inserts = update.filter(r => (r as any).insertDimension).map(r => (r as any).insertDimension.range.startIndex);
  assert.deepEqual(inserts, [kitchen.columns.length, kitchen.columns.length + 1]);
  assert.ok(!update.some(r => Object.keys(r).some(k => k.startsWith('delete'))), 'updates never delete sheets, rows or columns');
  assert.deepEqual(cc.parseLayoutState(cc.serializeLayoutState(plan.layout)), plan.layout);
});

test('photo folders: SPU folder for one SKC, SKC (or unique color) subfolders for several, explicit issues otherwise', () => {
  const variants = [{ spu: 'P1', skc: 'P1-BEIGE', color: 'Beige' }, { spu: 'P2', skc: 'P2-NEGRO', color: 'Negro' }, { spu: 'P2', skc: 'P2-BLANCO', color: 'Blanco' },
    { spu: 'P3', skc: 'P3-NEGRO-LISO', color: 'Negro' }, { spu: 'P3', skc: 'P3-NEGRO-RAYAS', color: 'Negro' }];
  const r = cc.resolvePhotoFolders(variants, [
    { path: ['P1', 'frente.png'] }, { path: ['P2', 'P2-NEGRO', 'frente.png'] }, { path: ['P2', 'blanco', 'espalda.png'] },
    { path: ['P2', 'frente.png'] }, { path: ['P3', 'Negro', 'x.png'] }, { path: ['P9', 'x.png'] }, { path: ['P1-BEIGE', 'legacy.png'] },
  ]);
  assert.deepEqual(r.map(x => x.skc ?? x.issue?.code), ['P1-BEIGE', 'P2-NEGRO', 'P2-BLANCO', 'skc_ambiguo', 'skc_ambiguo', 'spu_desconocido', 'P1-BEIGE']);
  assert.deepEqual(cc.expectedPhotoFolders(variants), [['P1'], ['P2'], ['P2', 'P2-NEGRO'], ['P2', 'P2-BLANCO'], ['P3'], ['P3', 'P3-NEGRO-LISO'], ['P3', 'P3-NEGRO-RAYAS']]);
});
