import type { MarketplaceId } from '../marketplaces';
import { MARKETPLACES } from '../marketplaces';
import type { CatalogFieldDef } from './families';
import { CATALOG_FAMILIES, catalogFamily, familyFields, marketplaceField } from './families';
import type { CategoryRoute } from './routing';
import { routeMarketplaceCategory } from './routing';
import { CATALOG_LISTS, type CatalogListId, WILDCARD_VALUES } from './vocabulary';

export const CATALOG_LAYOUT_SCHEMA = 1;
export const CATALOG_TEMPLATE_VERSION = '2.0';

/** An active category of an approved marketplace template of the client (input from Tuto). */
export interface ClientCatalogCategoryInput {
  marketplaceId: MarketplaceId;
  templateId: string;
  categoryId: string;
  /** Sheet name / label of the category in the marketplace template, e.g. "Vaso(1083-3218)". */
  label: string;
  /** Operator-confirmed route; otherwise the confirmed table or a keyword suggestion is used. */
  route?: CategoryRoute;
}

export interface ClientCatalogConfig {
  clientId: string;
  clientName: string;
  /** Marketplaces approved for the client in Tuto. */
  marketplaces: MarketplaceId[];
  categories: ClientCatalogCategoryInput[];
  /**
   * Values a family may offer per list (from `exportableValues` over the real templates of its active categories).
   * Missing entry = full universal list. Wildcards (Otro, No aplica…) are always kept.
   */
  valueRestrictions?: Record<string, Partial<Record<CatalogListId, readonly string[]>>>;
  /**
   * Values already used in the sheet per list id (e.g. "cocina.material2"), read before updating. They stay
   * selectable even if a restriction drops them, so existing rows never turn invalid.
   */
  valuesInUse?: Record<string, readonly string[]>;
}

export type CatalogStatus = 'active' | 'retired';
export interface LayoutColumn extends Omit<CatalogFieldDef, 'list'> { listId?: string; status: CatalogStatus }
export interface LayoutType { id: string; label: string; status: CatalogStatus }
export interface LayoutTab {
  familyId: string;
  title: string;
  sheetId: number;
  status: CatalogStatus;
  /** Physical order in the sheet. Columns are only appended, never moved or deleted. */
  columns: LayoutColumn[];
  types: LayoutType[];
  /** "<marketplace>:<categoryId>" of the active categories that enable this tab. */
  categories: string[];
}
export interface LayoutList {
  id: string;
  values: string[];
  /** Physical column in LISTAS. Lists are only appended. */
  column: number;
}
export interface CatalogLayout {
  schema: number;
  templateVersion: string;
  revision: number;
  clientId: string;
  clientName: string;
  marketplaces: Array<{ id: MarketplaceId; status: CatalogStatus }>;
  tabs: LayoutTab[];
  lists: LayoutList[];
}
export type LayoutChange =
  | { kind: 'add_tab' | 'retire_tab' | 'restore_tab'; familyId: string }
  | { kind: 'add_column' | 'retire_column' | 'restore_column'; familyId: string; key: string }
  | { kind: 'set_list'; listId: string }
  | { kind: 'add_marketplace' | 'retire_marketplace' | 'restore_marketplace'; marketplaceId: MarketplaceId };
export interface PendingCategory { marketplaceId: MarketplaceId; categoryId: string; label: string; route: CategoryRoute }
export interface LayoutPlan { layout: CatalogLayout; changes: LayoutChange[]; pending: PendingCategory[] }

/** Stable positive 31-bit sheet id per family (Google Sheets accepts any non-negative int32). */
export const familySheetId = (familyId: string) => {
  let hash = 2166136261;
  for (const char of `tuto-catalog:${familyId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 1) % 2_000_000_000) + 1000;
};
export const LISTS_SHEET_ID = 900_000_001;
export const STATE_SHEET_ID = 900_000_002;
export const README_SHEET_ID = 0;
export const LIST_MAX_ROWS = 400;

const keepWildcards = (universal: readonly string[], allowed?: readonly string[]) =>
  allowed ? universal.filter(v => WILDCARD_VALUES.has(v) || allowed.includes(v)) : [...universal];

/**
 * Desired client catalog for a configuration, merged with the previous layout so that nothing is ever
 * deleted: tabs, columns, product types and marketplaces that disappear become `retired` (hidden in the sheet,
 * data kept as history), and re-appear as `active` in place when enabled again.
 */
export function planCatalogLayout(config: ClientCatalogConfig, previous?: CatalogLayout | null): LayoutPlan {
  const changes: LayoutChange[] = [];
  const pending: PendingCategory[] = [];

  // 1. Active product types per family from the routed categories of approved marketplaces.
  const approved = new Set(config.marketplaces);
  const activeTypes = new Map<string, Set<string>>();
  const categoriesByFamily = new Map<string, Set<string>>();
  for (const category of config.categories) {
    if (!approved.has(category.marketplaceId)) continue;
    const route = category.route ?? routeMarketplaceCategory(category.marketplaceId, category.label);
    if (route.confidence !== 'known' || !route.typeIds.length) { pending.push({ marketplaceId: category.marketplaceId, categoryId: category.categoryId, label: category.label, route }); continue; }
    for (const typeId of route.typeIds) {
      const family = CATALOG_FAMILIES.find(f => f.productTypes.some(t => t.id === typeId))!;
      if (!activeTypes.has(family.id)) activeTypes.set(family.id, new Set());
      activeTypes.get(family.id)!.add(typeId);
      if (!categoriesByFamily.has(family.id)) categoriesByFamily.set(family.id, new Set());
      categoriesByFamily.get(family.id)!.add(`${category.marketplaceId}:${category.categoryId}`);
    }
  }

  // 2. Marketplaces: approved ones active; previously known and no longer approved retire.
  const marketplaces: CatalogLayout['marketplaces'] = [];
  for (const m of previous?.marketplaces ?? []) {
    const status: CatalogStatus = approved.has(m.id) ? 'active' : 'retired';
    if (m.status !== status) changes.push({ kind: status === 'active' ? 'restore_marketplace' : 'retire_marketplace', marketplaceId: m.id });
    marketplaces.push({ id: m.id, status });
  }
  for (const m of MARKETPLACES) if (approved.has(m.id) && !marketplaces.some(x => x.id === m.id)) {
    marketplaces.push({ id: m.id, status: 'active' });
    if (previous) changes.push({ kind: 'add_marketplace', marketplaceId: m.id });
  }
  const activeMarketplaces = marketplaces.filter(m => m.status === 'active').map(m => m.id);
  // With a single marketplace every product goes there: no "Publicar en" column.
  const marketplaceColumns = activeMarketplaces.length > 1 ? activeMarketplaces : [];

  // 3. Lists (append-only physical columns in LISTAS).
  const lists: LayoutList[] = (previous?.lists ?? []).map(l => ({ ...l }));
  const setList = (id: string, values: string[]) => {
    const existing = lists.find(l => l.id === id);
    if (!existing) { lists.push({ id, values, column: lists.length }); changes.push({ kind: 'set_list', listId: id }); return id; }
    if (existing.values.join('\u0000') !== values.join('\u0000')) { existing.values = values; changes.push({ kind: 'set_list', listId: id }); }
    return id;
  };

  // 4. Tabs.
  const tabs: LayoutTab[] = [];
  const familyIds = [...new Set([...(previous?.tabs ?? []).map(t => t.familyId), ...CATALOG_FAMILIES.map(f => f.id).filter(id => activeTypes.has(id))])];
  for (const familyId of familyIds) {
    const family = catalogFamily(familyId);
    const prevTab = previous?.tabs.find(t => t.familyId === familyId);
    const active = activeTypes.has(familyId);
    const status: CatalogStatus = active ? 'active' : 'retired';
    if (!prevTab && active && previous) changes.push({ kind: 'add_tab', familyId });
    if (prevTab && prevTab.status !== status) changes.push({ kind: status === 'active' ? 'restore_tab' : 'retire_tab', familyId });

    // Product types: active ones offered; previously active and now off stay listed as retired (history).
    const types: LayoutType[] = family.productTypes
      .filter(t => activeTypes.get(familyId)?.has(t.id) || prevTab?.types.some(p => p.id === t.id))
      .map(t => ({ ...t, status: activeTypes.get(familyId)?.has(t.id) ? 'active' : 'retired' }));

    const desired: CatalogFieldDef[] = [...familyFields(family), ...marketplaceColumns.map(marketplaceField)];
    const columns: LayoutColumn[] = [];
    const toColumn = (def: CatalogFieldDef, colStatus: CatalogStatus): LayoutColumn => {
      const { list, ...rest } = def;
      let listId: string | undefined;
      if (def.key === 'tipo') {
        // Retired types stay valid in the dropdown so historical rows do not light up; Revisión marks them.
        listId = setList(`${familyId}.tipo`, types.map(t => t.label));
        setList(`${familyId}.tipo_retirado`, types.filter(t => t.status === 'retired').map(t => t.label));
      } else if (list) {
        const universal = CATALOG_LISTS[list as CatalogListId];
        const id = `${familyId}.${def.key}`;
        const offered = keepWildcards(universal, config.valueRestrictions?.[familyId]?.[list as CatalogListId]);
        const inUse = config.valuesInUse?.[id] ?? [];
        listId = setList(id, universal.filter(v => offered.includes(v) || inUse.includes(v)));
      }
      return { ...rest, ...(listId ? { listId } : {}), status: colStatus };
    };
    if (!active && prevTab) {
      // A retired tab is frozen as it was: hidden history, no list or column changes.
      tabs.push({ ...prevTab, status, columns: prevTab.columns.map(c => ({ ...c })), types: prevTab.types.map(t => ({ ...t })), categories: [] });
      continue;
    }
    for (const prevColumn of prevTab?.columns ?? []) {
      const def = desired.find(d => d.key === prevColumn.key);
      const colStatus: CatalogStatus = def ? 'active' : 'retired';
      if (prevColumn.status !== colStatus) changes.push({ kind: def ? 'restore_column' : 'retire_column', familyId, key: prevColumn.key });
      columns.push(def ? toColumn(def, 'active') : { ...prevColumn, status: 'retired' });
    }
    for (const def of desired) if (!columns.some(c => c.key === def.key)) {
      columns.push(toColumn(def, 'active'));
      if (prevTab) changes.push({ kind: 'add_column', familyId, key: def.key });
    }
    tabs.push({ familyId, title: family.tab, sheetId: familySheetId(familyId), status, columns, types,
      categories: [...(categoriesByFamily.get(familyId) ?? [])].sort() });
  }
  // Keep the tab order of the family catalogue (stable for the client).
  tabs.sort((a, b) => CATALOG_FAMILIES.findIndex(f => f.id === a.familyId) - CATALOG_FAMILIES.findIndex(f => f.id === b.familyId));

  const layout: CatalogLayout = {
    schema: CATALOG_LAYOUT_SCHEMA, templateVersion: CATALOG_TEMPLATE_VERSION, revision: (previous?.revision ?? 0) + 1,
    clientId: config.clientId, clientName: config.clientName, marketplaces, tabs, lists,
  };
  return { layout, changes: previous ? changes : [], pending };
}

export const activeTabs = (layout: CatalogLayout) => layout.tabs.filter(t => t.status === 'active');
