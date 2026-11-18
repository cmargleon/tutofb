import * as XLSX from 'xlsx';
import { inspectWorkbookPackage, loadWorkbookPackage, xmlDecode } from './ooxmlWorkbook';
import { matchSpreadsheetCategory, normalizeCategoryLookupKey } from './templateWorkbook';

const catalogName = 'valor de atributo válido';
const originName = 'Lista de lugares de origen válidos';
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sheetRef = (name: string) => "'" + name.replace(/'/g, "''") + "'";

/** Restore references using only the official catalogue in this same workbook. */
export async function repairSheinWorkbook(buffer: Buffer): Promise<Buffer> {
  const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 1000 });
  const catalog = workbook.Sheets[catalogName];
  if (!catalog || catalog.A2?.v !== 'Clasificación final' || catalog.C2?.v !== 'Atributo') return buffer;
  const inspection = await inspectWorkbookPackage(buffer);
  if (inspection.warnings.length) return buffer;
  const names = new Set((workbook.Workbook?.Names || []).map(n => n.Name.toUpperCase()));
  const rows = XLSX.utils.sheet_to_json<string[]>(catalog, { header: 1, blankrows: true });
  const byCategory = new Map<string, Array<{ row: number; key: string; lastColumn: number }>>();
  rows.forEach((row, index) => {
    if (row[1] !== 'Especificación' || !row[0] || !row[2] || !row[5]) return;
    const category = normalizeCategoryLookupKey(row[0]);
    const entries = byCategory.get(category) || [];
    entries.push({ row: index + 1, key: normalizeCategoryLookupKey(row[2]), lastColumn: row.length - 1 });
    byCategory.set(category, entries);
  });
  const additions = new Map<string, string>();
  const origins = workbook.SheetNames.filter(name => originName.startsWith(name) &&
    workbook.Sheets[name].A1?.v === 'Nombre del lugar de origen' &&
    workbook.Sheets[name].B1?.v === 'Código del lugar de origen');
  const changes = new Map<string, string>();
  const orderedSheets = inspection.sheets.filter(sheet => !sheet.hidden && /\(\d+-\d+\)$/.test(sheet.name)).map(sheet => sheet.name);
  for (const sheet of inspection.sheets.filter(s => !s.hidden && !s.unsupportedReason)) {
    const code = sheet.name.match(/\(\d+-(\d+)\)$/)?.[1];
    if (!code) continue;
    const catalogue = matchSpreadsheetCategory(sheet.name, byCategory, orderedSheets) || [];
    const allowedNames = ['MAIN_SPEC_ATTR_CAT_', 'MAIN_ATTR_CAT_'].flatMap(prefix => inspection.namedRanges[prefix + code] || []);
    const prefix = 'MAIN_ATTR_VALUE_CAT_' + code + '_';
    if (sheet.validations.some(v => v.type === 'list' && v.formula.includes(prefix))) {
      for (const option of allowedNames) {
        const match = option.match(/^(.*?)\s*\((\d+)\)$/);
        if (!match) continue;
        const name = prefix + match[2];
        if (names.has(name)) continue;
        const matches = catalogue.filter(entry => entry.key === normalizeCategoryLookupKey(match[1]));
        if (matches.length !== 1) continue;
        const [{ row, lastColumn }] = matches;
        additions.set(name, sheetRef(catalogName) + '!' + '$F$' + row + ':$' + XLSX.utils.encode_col(lastColumn) + '$' + row);
      }
    }
    if (origins.length === 1 && origins[0] !== originName && !workbook.Sheets[originName]) {
      const xml = sheet.xml.replace(/(<(?:\w+:)?formula1>)([^<]*)(<\/(?:\w+:)?formula1>)/g, (original, open, value, close) => {
        const formula = xmlDecode(value);
        if (!formula.startsWith(sheetRef(originName) + '!')) return original;
        return open + escape(formula.replace(sheetRef(originName), sheetRef(origins[0]))) + close;
      });
      if (xml !== sheet.xml) changes.set(sheet.path, xml);
    }
  }
  if (!additions.size && !changes.size) return buffer;
  const zip = await loadWorkbookPackage(buffer);
  for (const [path, xml] of changes) zip.file(path, xml);
  if (additions.size) {
    const path = 'xl/workbook.xml';
    const xml = await zip.file(path)!.async('string');
    const body = [...additions].map(([name, range]) => '<definedName name="' + name + '">' + escape(range) + '</definedName>').join('');
    if (!xml.includes('</definedNames>')) throw new Error('No se pudieron restaurar las listas SHEIN.');
    zip.file(path, xml.replace('</definedNames>', () => body + '</definedNames>'));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
