/**
 * Google Sheets API requests that create or update a client catalog sheet from a layout.
 * Pure: no I/O. The caller creates the spreadsheet with `CATALOG_SPREADSHEET_PROPERTIES` (es_MX: formulas use
 * commas and English function names) and sends `requests` to spreadsheets.batchUpdate.
 *
 * Sheet anatomy of a family tab:
 *   row 1 (hidden)  machine keys of each column (importer reads by key, never by position)
 *   row 2           group bands
 *   row 3           headers with notes; the last header holds the Revisión ARRAYFORMULA
 *   row 4+          client data
 */
import { MARKETPLACES } from '../marketplaces';
import { catalogFamily, familyFields, marketplaceField } from './families';
import type { CatalogLayout, LayoutChange, LayoutColumn, LayoutTab } from './layout';
import { LIST_MAX_ROWS, LISTS_SHEET_ID, README_SHEET_ID, STATE_SHEET_ID, activeTabs } from './layout';

type Request = Record<string, unknown>;
export const CATALOG_SPREADSHEET_PROPERTIES = { locale: 'es_MX', timeZone: 'America/Mexico_City' } as const;
export const KEY_ROW = 0;
export const GROUP_ROW = 1;
export const HEADER_ROW = 2;
export const DATA_ROW = 3;
const INITIAL_DATA_ROWS = 1000;
export const REVIEW_KEY = '_revision';
const STATE_CHUNK = 40_000;

const channel = (hex: string, at: number) => Math.round(parseInt(hex.slice(at, at + 2), 16) / 255 * 1000) / 1000;
const color = (hex: string) => ({ rgbColor: { red: channel(hex, 0), green: channel(hex, 2), blue: channel(hex, 4) } });
const LEVEL: Record<LayoutColumn['level'], [string, string]> = { obligatorio: ['1F4E5F', 'FFFFFF'], recomendado: ['8FC1CC', '1E2A30'], opcional: ['E3ECEF', '1E2A30'] };
const SPU_FILL = 'FFF8E1';
export const columnLetter = (index: number): string => {
  let n = index + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const str = (value: string) => ({ userEnteredValue: { stringValue: value } });
const listRange = (layout: CatalogLayout, listId: string) => {
  const list = layout.lists.find(l => l.id === listId);
  if (!list) throw new Error(`Lista ${listId} inexistente`);
  const letter = columnLetter(list.column);
  return `=LISTAS!$${letter}$2:$${letter}$${LIST_MAX_ROWS + 1}`;
};

function validationRule(layout: CatalogLayout, column: LayoutColumn, cell: string) {
  if (column.listId) return { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: listRange(layout, column.listId) }] }, strict: true, showCustomUi: true,
    inputMessage: `${column.header}: elige una opción de la lista.` };
  const custom = (formula: string, message: string) => ({ condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, strict: true, inputMessage: message });
  switch (column.type) {
    case 'decimal': return { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, strict: true, inputMessage: `${column.header}: solo un número mayor que 0, sin unidades.` };
    case 'int': return { condition: { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: column.key === 'piezas' ? '1' : '0' }] }, strict: true, inputMessage: `${column.header}: número entero.` };
    case 'percent': return { condition: { type: 'NUMBER_BETWEEN', values: [{ userEnteredValue: '0.1' }, { userEnteredValue: '100' }] }, strict: true, inputMessage: `${column.header}: porcentaje entre 1 y 100, sin el signo %.` };
    case 'gtin': return custom(`=AND(ISNUMBER(VALUE(${cell})),OR(LEN(${cell})=8,LEN(${cell})=12,LEN(${cell})=13,LEN(${cell})=14))`, 'Código de barras de 8, 12, 13 o 14 dígitos.');
    case 'code': return custom(`=AND(LEN(${cell})<=60,ISERROR(FIND(" ",${cell})))`, `${column.header}: sin espacios (usa guiones), máximo 60 caracteres.`);
    default: return null;
  }
}

/** One ARRAYFORMULA in the Revisión header: checks every data row, extends automatically, client cannot break it row by row. */
export function reviewFormula(layout: CatalogLayout, tab: LayoutTab): string {
  const at = (key: string) => {
    const index = tab.columns.findIndex(c => c.key === key && c.status === 'active');
    return index < 0 ? null : `${columnLetter(index)}${DATA_ROW + 1}:${columnLetter(index)}`;
  };
  const col = (key: string) => at(key)!;
  const active = tab.columns.filter(c => c.status === 'active');
  const skuRequired = active.filter(c => c.level === 'obligatorio' && c.scope === 'sku').map(c => col(c.key));
  const spuRequired = active.filter(c => c.level === 'obligatorio' && c.scope === 'spu').map(c => col(c.key));
  const checks: Array<[string, string]> = [
    [`(${skuRequired.map(r => `(${r}="")`).join('+')})>0`, 'Falta un dato obligatorio en esta fila'],
    ...(spuRequired.length ? [[`(${spuRequired.map(r => `(COUNTIFS(${col('spu')},${col('spu')},${r},"<>")=0)`).join('+')})>0`, 'Falta un dato del producto en la primera fila del SPU'] as [string, string]] : []),
    [`COUNTIF(${col('sku')},${col('sku')})>1`, 'SKU repetido'],
    [`COUNTIFS(${col('skc')},${col('skc')},${col('spu')},"<>"&${col('spu')})>0`, 'El SKC aparece con otro SPU'],
  ];
  if (at('precio_oferta')) checks.push([`(${col('precio_oferta')}<>"")*(${col('precio_oferta')}>=${col('precio')})`, 'La oferta debe ser menor que el precio']);
  const retired = layout.lists.find(l => l.id === `${tab.familyId}.tipo_retirado`);
  if (retired?.values.length) {
    // The type lives on the first row of the SPU: look it up for every row of that SPU.
    const letter = columnLetter(retired.column);
    const spuIndex = tab.columns.findIndex(c => c.key === 'spu');
    const tipoIndex = tab.columns.findIndex(c => c.key === 'tipo');
    const table = `${columnLetter(spuIndex)}${DATA_ROW + 1}:${columnLetter(tipoIndex)}`;
    const spuType = `IFERROR(VLOOKUP(${col('spu')},FILTER(${table},${col('tipo')}<>""),${tipoIndex - spuIndex + 1},FALSE),"")`;
    // First: fixing other problems of a row that will not be published is pointless.
    checks.unshift([`COUNTIF(LISTAS!$${letter}$2:$${letter}$${LIST_MAX_ROWS + 1},${spuType})>0`, 'Tipo de producto retirado: no se publicará']);
  }
  if (at('pct1')) {
    const pcts = ['pct1', 'pct2', 'pct3'].map(at).filter(Boolean) as string[];
    checks.push([`((${pcts.map(p => `(${p}<>"")`).join('+')})>0)*((${pcts.join('+')})<>100)`, 'La composición no suma 100%']);
  }
  if (at('capacidad') && at('unidad_capacidad')) checks.push([`(${col('capacidad')}<>"")*(${col('unidad_capacidad')}="")`, 'Falta la unidad de capacidad']);
  let expr = '"OK"';
  for (const [condition, message] of [...checks].reverse()) expr = `IF(${condition},"${message}",${expr})`;
  return `={"Revisión";ARRAYFORMULA(IF(LEN(${col('spu')})+LEN(${col('skc')})+LEN(${col('sku')})=0,"",${expr}))}`;
}

export const FROZEN_COLUMNS = 3;
/** Contiguous group bands. A band never crosses the frozen-column boundary (Sheets cannot merge across it). */
const groupRuns = (columns: LayoutColumn[]) => {
  const runs: Array<{ group: string; start: number; end: number; continued?: boolean }> = [];
  columns.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.group === c.group && i !== FROZEN_COLUMNS) last.end = i;
    else runs.push({ group: c.group, start: i, end: i, continued: !!last && last.group === c.group });
  });
  return runs;
};

/** Rows 1–3 of a tab (keys, groups, headers + Revisión) and their merges. Safe to rewrite on every update. */
function headerRequests(layout: CatalogLayout, tab: LayoutTab, from = 0): Request[] {
  const n = tab.columns.length;
  const reviewIndex = n;
  const headerCell = (c: LayoutColumn) => {
    const [bg, fg] = LEVEL[c.level];
    const once = c.scope === 'spu' ? '\nSe llena solo en la primera fila de cada SPU.' : '';
    const example = c.example ? `\nEjemplo: ${c.example}` : '';
    return { ...str(c.header), note: `${c.level[0].toUpperCase()}${c.level.slice(1)}. ${c.help}${once}${example}`,
      userEnteredFormat: { backgroundColorStyle: color(bg), textFormat: { bold: true, foregroundColorStyle: color(fg) }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' } };
  };
  const runs = groupRuns(tab.columns);
  const row = (r: number) => ({ sheetId: tab.sheetId, startRowIndex: r, endRowIndex: r + 1 });
  return [
    // Group band: one format for the whole row, then plain values, then merges.
    { unmergeCells: { range: { ...row(GROUP_ROW), startColumnIndex: 0, endColumnIndex: n + 1 } } },
    { repeatCell: { range: { ...row(GROUP_ROW), startColumnIndex: 0, endColumnIndex: n + 1 }, fields: 'userEnteredFormat',
      cell: { userEnteredFormat: { backgroundColorStyle: color('33414A'), textFormat: { bold: true, foregroundColorStyle: color('FFFFFF') }, horizontalAlignment: 'CENTER' } } } },
    { updateCells: { start: { sheetId: tab.sheetId, rowIndex: GROUP_ROW, columnIndex: 0 }, fields: 'userEnteredValue',
      rows: [{ values: [...tab.columns.map((_, i) => { const run = runs.find(r => r.start === i); return str(run && !run.continued ? run.group : ''); }), str('Revisión')] }] } },
    ...runs.filter(r => r.end > r.start).map(r => ({ mergeCells: { mergeType: 'MERGE_ALL', range: { ...row(GROUP_ROW), startColumnIndex: r.start, endColumnIndex: r.end + 1 } } })),
    // Keys and headers only from `from` (new columns on updates); existing headers are left as they are.
    ...(from < n ? [
      { updateCells: { start: { sheetId: tab.sheetId, rowIndex: KEY_ROW, columnIndex: from }, fields: 'userEnteredValue', rows: [{ values: tab.columns.slice(from).map(c => str(c.key)) }] } },
      { updateCells: { start: { sheetId: tab.sheetId, rowIndex: HEADER_ROW, columnIndex: from }, fields: 'userEnteredValue,userEnteredFormat,note', rows: [{ values: tab.columns.slice(from).map(headerCell) }] } },
    ] : []),
    // Revisión is rewritten on every change: its ARRAYFORMULA references the current active columns.
    { updateCells: { start: { sheetId: tab.sheetId, rowIndex: KEY_ROW, columnIndex: reviewIndex }, fields: 'userEnteredValue', rows: [{ values: [str(REVIEW_KEY)] }] } },
    { updateCells: { start: { sheetId: tab.sheetId, rowIndex: HEADER_ROW, columnIndex: reviewIndex }, fields: 'userEnteredValue,userEnteredFormat,note', rows: [
      { values: [{ userEnteredValue: { formulaValue: reviewFormula(layout, tab) }, note: 'Automática. Muestra OK o el primer problema de cada fila.',
        userEnteredFormat: { backgroundColorStyle: color('5B6770'), textFormat: { bold: true, foregroundColorStyle: color('FFFFFF') }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }] },
    ] } },
    { repeatCell: { range: { sheetId: tab.sheetId, startRowIndex: DATA_ROW, startColumnIndex: reviewIndex, endColumnIndex: reviewIndex + 1 },
      cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColorStyle: color('5B6770') } } }, fields: 'userEnteredFormat.textFormat' } },
  ];
}

/** Data validation, number format, background and width of one column (rows 4+). */
function columnRequests(layout: CatalogLayout, tab: LayoutTab, index: number): Request[] {
  const column = tab.columns[index];
  const range = { sheetId: tab.sheetId, startRowIndex: DATA_ROW, startColumnIndex: index, endColumnIndex: index + 1 };
  const rule = validationRule(layout, column, `${columnLetter(index)}${DATA_ROW + 1}`);
  const numberFormat = ['code', 'gtin', 'text'].includes(column.type) ? { type: 'TEXT' } : column.key.startsWith('precio') ? { type: 'NUMBER', pattern: '0.00' } : { type: 'NUMBER', pattern: 'General' };
  return [
    { setDataValidation: { range, ...(rule ? { rule } : {}) } },
    { repeatCell: { range, fields: 'userEnteredFormat.numberFormat,userEnteredFormat.backgroundColorStyle',
      cell: { userEnteredFormat: { numberFormat, backgroundColorStyle: color(column.scope === 'spu' ? SPU_FILL : 'FFFFFF') } } } },
    { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
      properties: { pixelSize: column.key === 'notas' ? 260 : Math.max(96, Math.min(220, column.header.length * 8 + 24)), hiddenByUser: column.status === 'retired' }, fields: 'pixelSize,hiddenByUser' } },
  ];
}

function createTabRequests(layout: CatalogLayout, tab: LayoutTab, index: number): Request[] {
  const n = tab.columns.length;
  const review = n;
  return [
    { addSheet: { properties: { sheetId: tab.sheetId, title: tab.title, index, hidden: tab.status === 'retired', tabColorStyle: color('1F4E5F'),
      gridProperties: { rowCount: DATA_ROW + INITIAL_DATA_ROWS, columnCount: n + 1, frozenRowCount: DATA_ROW, frozenColumnCount: FROZEN_COLUMNS } } } },
    { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: KEY_ROW, endIndex: KEY_ROW + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } },
    { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: HEADER_ROW, endIndex: HEADER_ROW + 1 }, properties: { pixelSize: 52 }, fields: 'pixelSize' } },
    ...headerRequests(layout, tab),
    ...tab.columns.flatMap((_, i) => columnRequests(layout, tab, i)),
    { updateDimensionProperties: { range: { sheetId: tab.sheetId, dimension: 'COLUMNS', startIndex: review, endIndex: review + 1 }, properties: { pixelSize: 300 }, fields: 'pixelSize' } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: tab.sheetId, startRowIndex: DATA_ROW, startColumnIndex: review, endColumnIndex: review + 1 }],
      booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND(${columnLetter(review)}${DATA_ROW + 1}<>"",${columnLetter(review)}${DATA_ROW + 1}<>"OK")` }] },
        format: { backgroundColorStyle: color('FDE2E1'), textFormat: { bold: true, foregroundColorStyle: color('9B1C1C') } } } } } },
    { addConditionalFormatRule: { index: 1, rule: { ranges: [{ sheetId: tab.sheetId, startRowIndex: DATA_ROW, startColumnIndex: review, endColumnIndex: review + 1 }],
      booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OK' }] }, format: { textFormat: { bold: true, foregroundColorStyle: color('1E7B4F') } } } } } },
    { addProtectedRange: { protectedRange: { range: { sheetId: tab.sheetId, startRowIndex: KEY_ROW, endRowIndex: DATA_ROW }, warningOnly: true,
      description: 'Encabezados de Tuto: no modificar.' } } },
  ];
}

function listRequests(layout: CatalogLayout, listIds: string[]): Request[] {
  return listIds.flatMap(id => {
    const list = layout.lists.find(l => l.id === id)!;
    if (list.values.length > LIST_MAX_ROWS) throw new Error(`La lista ${id} supera ${LIST_MAX_ROWS} valores.`);
    return [
      // Clear the whole list column (updateCells without rows clears the range), then write the current values.
      { updateCells: { range: { sheetId: LISTS_SHEET_ID, startRowIndex: 0, endRowIndex: LIST_MAX_ROWS + 1, startColumnIndex: list.column, endColumnIndex: list.column + 1 }, fields: 'userEnteredValue' } },
      { updateCells: { start: { sheetId: LISTS_SHEET_ID, rowIndex: 0, columnIndex: list.column }, fields: 'userEnteredValue',
        rows: [id, ...list.values].map(value => ({ values: [str(value)] })) } },
    ];
  });
}

const README_ROWS = 40;
function readmeRequests(layout: CatalogLayout): Request[] {
  const marketplaces = layout.marketplaces.filter(m => m.status === 'active').map(m => MARKETPLACES.find(x => x.id === m.id)?.name || m.id);
  const tabs = activeTabs(layout);
  const lines: Array<[string, 'title' | 'h' | 'text' | 'mono']> = [
    [`Catálogo de productos — ${layout.clientName}`, 'title'],
    [`Con este archivo y la carpeta FOTOS, Tuto prepara las fotos de venta y las publicaciones en ${marketplaces.join(', ')}.`, 'text'],
    [marketplaces.length > 1 ? 'Todos los productos se publican en todos tus marketplaces. Para excluir uno, escribe No en la columna «Publicar en …» de la primera fila del SPU.'
      : `Todos los productos se publican en ${marketplaces[0] || 'tu marketplace'}.`, 'text'],
    ['', 'text'],
    ['Pestañas para llenar', 'h'],
    ...tabs.map(t => [`• ${t.title}: ${t.types.filter(x => x.status === 'active').map(x => x.label).join(', ')}.`, 'text'] as [string, 'text']),
    ['', 'text'],
    ['Cómo llenar', 'h'],
    ['• Una fila por SKU: cada combinación de color y talla, capacidad o pack.', 'text'],
    ['• SPU agrupa el producto. SKC agrupa un color o presentación. SKU es lo que se vende.', 'text'],
    ['• Las celdas color crema son datos del producto: basta con llenarlas en la primera fila de cada SPU.', 'text'],
    ['• Usa los menús desplegables. Precio en pesos mexicanos con IVA, solo el número. Medidas en cm, pesos en gramos.', 'text'],
    ['• La columna Revisión indica si a una fila le falta algo. Todas deben decir OK.', 'text'],
    ['• Nombre, descripción, público y fotos de venta los genera Tuto.', 'text'],
    ['', 'text'],
    ['Carpeta FOTOS', 'h'],
    ['FOTOS/<SPU>/                 si el SPU tiene un solo color o presentación: las fotos van aquí', 'mono'],
    ['FOTOS/<SPU>/<SKC>/           si tiene varios: una subcarpeta por SKC con su código exacto', 'mono'],
    ['Nombres de archivo libres. JPG, PNG o HEIC. Mínimo frente y espalda (objetos: frente y un detalle).', 'text'],
    ['', 'text'],
    ['Colores de los encabezados', 'h'],
    ['Obligatorio', 'text'], ['Recomendado: lo piden varios marketplaces', 'text'], ['Opcional', 'text'], ['Dato del producto: una vez por SPU', 'text'],
  ];
  const style = (kind: string, i: number) => {
    const legend = ['Obligatorio', 'Recomendado: lo piden varios marketplaces', 'Opcional', 'Dato del producto: una vez por SPU'].indexOf(lines[i][0]);
    if (legend >= 0) {
      const [bg, fg] = legend < 3 ? LEVEL[(['obligatorio', 'recomendado', 'opcional'] as const)[legend]] : [SPU_FILL, '1E2A30'];
      return { backgroundColorStyle: color(bg), textFormat: { bold: true, foregroundColorStyle: color(fg) } };
    }
    return kind === 'title' ? { textFormat: { bold: true, fontSize: 16 } } : kind === 'h' ? { textFormat: { bold: true, fontSize: 12, foregroundColorStyle: color('1F4E5F') } }
      : kind === 'mono' ? { textFormat: { fontFamily: 'Roboto Mono' } } : { wrapStrategy: 'WRAP' };
  };
  const rows = Array.from({ length: README_ROWS }, (_, i) => lines[i]
    ? { values: [{ ...str(lines[i][0]), userEnteredFormat: style(lines[i][1], i) }] }
    : { values: [{ ...str(''), userEnteredFormat: {} }] });
  return [{ updateCells: { start: { sheetId: README_SHEET_ID, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat', rows } }];
}

/**
 * Layout state stored in the hidden _TUTO sheet (chunked JSON in column A). Columns are stored by key and
 * rehydrated from the field catalogue, so the state stays small and labels follow the code.
 */
type CompactColumn = { key: string; status: LayoutColumn['status']; listId?: string; level: LayoutColumn['level']; header: string };
export const compactLayout = (layout: CatalogLayout) => ({ ...layout,
  tabs: layout.tabs.map(t => ({ ...t, columns: t.columns.map((c): CompactColumn => ({ key: c.key, status: c.status, level: c.level, header: c.header, ...(c.listId ? { listId: c.listId } : {}) })) })) });
export const expandLayout = (compact: ReturnType<typeof compactLayout>): CatalogLayout => ({ ...compact,
  tabs: compact.tabs.map(t => {
    const known = [...familyFields(catalogFamily(t.familyId)), ...MARKETPLACES.map(m => marketplaceField(m.id))];
    return { ...t, columns: t.columns.map((c): LayoutColumn => {
      const def = known.find(d => d.key === c.key);
      const { list: _list, ...base } = def ?? { key: c.key, header: c.header, group: 'Otros', level: c.level, scope: 'sku' as const, type: 'text' as const, canonical: `attribute.${c.key}`, help: '' };
      return { ...base, key: c.key, status: c.status, level: c.level, header: c.header, ...(c.listId ? { listId: c.listId } : {}) };
    }) };
  }) });
export const serializeLayoutState = (layout: CatalogLayout) => {
  const json = JSON.stringify(compactLayout(layout));
  return Array.from({ length: Math.ceil(json.length / STATE_CHUNK) }, (_, i) => json.slice(i * STATE_CHUNK, (i + 1) * STATE_CHUNK));
};
export const parseLayoutState = (chunks: readonly string[]): CatalogLayout | null => {
  const json = chunks.filter(Boolean).join('');
  return json ? expandLayout(JSON.parse(json)) : null;
};
function stateRequests(layout: CatalogLayout): Request[] {
  const chunks = serializeLayoutState(layout);
  return [
    { updateCells: { range: { sheetId: STATE_SHEET_ID, startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 1 }, fields: 'userEnteredValue' } },
    { updateCells: { start: { sheetId: STATE_SHEET_ID, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue', rows: chunks.map(c => ({ values: [str(c)] })) } },
  ];
}

/** Requests that build a brand-new catalog sheet (spreadsheet created with CATALOG_SPREADSHEET_PROPERTIES). */
export function buildCreateRequests(layout: CatalogLayout): Request[] {
  const tabs = layout.tabs.filter(t => t.status === 'active');
  return [
    { updateSheetProperties: { properties: { sheetId: README_SHEET_ID, title: 'LEEME', gridProperties: { columnCount: 1, rowCount: README_ROWS } }, fields: 'title,gridProperties.columnCount,gridProperties.rowCount' } },
    { updateDimensionProperties: { range: { sheetId: README_SHEET_ID, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 900 }, fields: 'pixelSize' } },
    { addSheet: { properties: { sheetId: LISTS_SHEET_ID, title: 'LISTAS', hidden: true, gridProperties: { rowCount: LIST_MAX_ROWS + 1, columnCount: Math.max(26, layout.lists.length + 10) } } } },
    { addSheet: { properties: { sheetId: STATE_SHEET_ID, title: '_TUTO', hidden: true, gridProperties: { rowCount: 100, columnCount: 1 } } } },
    { addProtectedRange: { protectedRange: { range: { sheetId: LISTS_SHEET_ID }, warningOnly: true, description: 'Listas de Tuto: no modificar.' } } },
    { addProtectedRange: { protectedRange: { range: { sheetId: STATE_SHEET_ID }, warningOnly: true, description: 'Estado de Tuto: no modificar.' } } },
    ...listRequests(layout, layout.lists.map(l => l.id)),
    ...tabs.flatMap((tab, i) => createTabRequests(layout, tab, i + 1)),
    ...readmeRequests(layout),
    ...stateRequests(layout),
  ];
}

/**
 * Requests that move an existing catalog sheet from `previous` to `next` (as planned with `planCatalogLayout`).
 * Never deletes sheets, columns or rows: retired tabs and columns are hidden and keep their data.
 */
export function buildUpdateRequests(previous: CatalogLayout, next: CatalogLayout, changes: LayoutChange[]): Request[] {
  const requests: Request[] = [];
  const grow = Math.max(0, next.lists.length + 10 - Math.max(26, previous.lists.length + 10));
  if (grow) requests.push({ appendDimension: { sheetId: LISTS_SHEET_ID, dimension: 'COLUMNS', length: grow } });
  const listIds = [...new Set(changes.filter((c): c is Extract<LayoutChange, { kind: 'set_list' }> => c.kind === 'set_list').map(c => c.listId))];
  requests.push(...listRequests(next, listIds));

  for (const [position, tab] of next.tabs.entries()) {
    const before = previous.tabs.find(t => t.familyId === tab.familyId);
    const tabChanges = changes.filter(c => 'familyId' in c && c.familyId === tab.familyId);
    if (!before) { requests.push(...createTabRequests(next, tab, position + 1)); continue; }
    if (tabChanges.some(c => c.kind === 'retire_tab')) { requests.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, hidden: true }, fields: 'hidden' } }); continue; }
    if (tab.status === 'retired') continue;
    if (tabChanges.some(c => c.kind === 'restore_tab')) requests.push({ updateSheetProperties: { properties: { sheetId: tab.sheetId, hidden: false }, fields: 'hidden' } });
    // New columns are inserted right before Revisión (append-only), so existing data never moves.
    for (let index = before.columns.length; index < tab.columns.length; index++) {
      requests.push({ insertDimension: { range: { sheetId: tab.sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, inheritFromBefore: false } });
    }
    // Headers are rewritten from the first new or relabelled column; validations only where something changed.
    const relabelled = tab.columns.findIndex((c, i) => !before.columns[i] || before.columns[i].level !== c.level || before.columns[i].header !== c.header);
    requests.push(...headerRequests(next, tab, relabelled < 0 ? tab.columns.length : relabelled));
    tab.columns.forEach((column, index) => {
      const old = before.columns[index];
      const changed = !old || old.status !== column.status || old.listId !== column.listId || old.level !== column.level;
      if (changed) requests.push(...columnRequests(next, tab, index));
    });
  }
  requests.push(...readmeRequests(next), ...stateRequests(next));
  return requests;
}
