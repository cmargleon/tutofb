import type { MarketplaceId } from '../marketplaces';
import type { SpreadsheetTemplateCategory, SpreadsheetTemplateCategoryColumn } from '../types/spreadsheet';
import { familyOfType } from './families';
import type { MarketplaceColumnRule } from './mappings';
import { MARKETPLACE_MAPPINGS } from './mappings';
import type { CategoryRoute } from './routing';
import type { ValueMatch } from './valueMaps';
import { mapUniversalValues } from './valueMaps';
import { CATALOG_LISTS, type CatalogListId, normalizeCatalogValue } from './vocabulary';

export interface ColumnCoverage {
  key: string;
  label: string;
  required: boolean;
  ruleId: string | null;
  list?: CatalogListId;
  allowedCount?: number;
  values?: ValueMatch[];
}
export interface CategoryCoverage {
  marketplaceId: MarketplaceId;
  category: string;
  columns: ColumnCoverage[];
  /** Required columns without a mapping rule: block activation until mapped. */
  unmappedRequired: string[];
  /** Columns with dropdown whose universal values lack an equivalent (exported empty; Gemini/operator fallback). */
  valueGaps: Array<{ column: string; missing: string[] }>;
}

const baseLabel = (label: string) => label.replace(/\(\d+\)\s*$/, '').trim();
const key = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function findRule(marketplaceId: MarketplaceId, column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label'>): MarketplaceColumnRule | null {
  const k = key(column.key);
  const name = normalizeCatalogValue(baseLabel(column.label));
  const rules = MARKETPLACE_MAPPINGS[marketplaceId].rules;
  return rules.find(rule => rule.match.keys?.some(candidate => key(candidate) === k))
    || rules.find(rule => rule.match.keyPattern && new RegExp(rule.match.keyPattern, 'i').test(k))
    || rules.find(rule => rule.match.attributeNames?.some(n => normalizeCatalogValue(n) === name))
    || null;
}

const allowedValues = (category: SpreadsheetTemplateCategory, column: SpreadsheetTemplateCategoryColumn, axis?: string): string[] => {
  if (column.dropdownOptions?.length) return column.dropdownOptions;
  const dependent = column.dropdownDependency?.optionsByValue;
  if (dependent) {
    const byAxis = axis ? Object.entries(dependent).find(([value]) => normalizeCatalogValue(value) === normalizeCatalogValue(axis))?.[1] : undefined;
    return byAxis || [...new Set(Object.values(dependent).flat())];
  }
  const attribute = category.attributes.find(a => normalizeCatalogValue(a.name) === normalizeCatalogValue(baseLabel(column.label)));
  return attribute?.values || [];
};

/**
 * Coverage of one real marketplace category against the universal catalog: which columns have a source, which
 * required ones do not, and which universal dropdown values have no equivalent in the category's lists.
 * `route` picks the size list (clothing vs footwear) of the secondary specification.
 */
export function templateCategoryCoverage(marketplaceId: MarketplaceId, category: SpreadsheetTemplateCategory, route?: CategoryRoute,
  valueOverrides: Record<string, Record<string, string>> = {}): CategoryCoverage {
  const families = new Set((route?.typeIds || []).map(id => familyOfType(id)?.id));
  // The list offered to the client depends on the family: compare the category against that list, not the universal superset.
  const sizeList: CatalogListId = families.has('calzado') ? 'talla_calzado' : families.has('ropa') ? 'talla_ropa' : 'tamano';
  const materialList: CatalogListId = families.has('calzado') ? 'material_calzado' : 'material';
  const resolveList = (list?: CatalogListId): CatalogListId | undefined =>
    list === 'talla_ropa' ? sizeList : list === 'material' ? materialList : list;
  const columns = category.columns.map((column): ColumnCoverage => {
    const rule = findRule(marketplaceId, column);
    const familyRule = rule?.byFamily && [...families].map(f => f && rule.byFamily![f]).find(Boolean);
    const list = familyRule ? (familyRule.list === null ? undefined : resolveList(familyRule.list ?? rule?.list)) : resolveList(rule?.list);
    const base: ColumnCoverage = { key: column.key, label: column.label, required: column.required, ruleId: rule?.id ?? null };
    if (!list) return base;
    const allowed = allowedValues(category, column, list.startsWith('talla') ? 'Talla' : undefined);
    if (!allowed.length) return { ...base, list, allowedCount: 0 };
    return { ...base, list, allowedCount: allowed.length,
      values: mapUniversalValues(marketplaceId, list, CATALOG_LISTS[list], allowed, valueOverrides[column.key]) };
  });
  return {
    marketplaceId, category: category.label, columns,
    unmappedRequired: columns.filter(c => c.required && !c.ruleId).map(c => c.label),
    valueGaps: columns.filter(c => c.values?.some(v => v.kind === 'sin_equivalente'))
      .map(c => ({ column: c.label, missing: c.values!.filter(v => v.kind === 'sin_equivalente').map(v => v.universal) })),
  };
}

/**
 * Universal values that can be offered to the client for a list: those with an equivalent in every active
 * category that uses the list. Values without equivalent stay selectable only if `keepUnmapped` (default):
 * hiding them silently would surprise clients; the coverage report makes the gap explicit instead.
 */
export function exportableValues(listId: CatalogListId, coverages: CategoryCoverage[]): string[] {
  const missing = new Set(coverages.flatMap(c => c.columns.filter(col => col.list === listId && col.values)
    .flatMap(col => col.values!.filter(v => v.kind === 'sin_equivalente').map(v => v.universal))));
  return CATALOG_LISTS[listId].filter(v => !missing.has(v));
}
