/** Lossless ZIP-part editing: SheetJS is used for reading values only, never serialization. */
import JSZip from 'jszip';
import { evaluateValidationFormula } from './validationFormula';
import * as XLSX from 'xlsx';
import { posix } from 'node:path';

export const xmlDecode = (v: string) => v.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  return named[entity] ?? String.fromCodePoint(entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10));
});
const escapeXml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const xmlAttrs = (v: string): Record<string, string> => Object.fromEntries([...v.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1], xmlDecode(m[3])]));
export interface PackageValidation { ranges: string[]; type: string; formula: string; formula2: string; operator: string; options: string[] }
export interface PackageSheet { name: string; path: string; hidden: boolean; validations: PackageValidation[]; xml: string; unsupportedReason?: string }
export interface WorkbookInspection { sheets: PackageSheet[]; warnings: string[]; namedRanges: Record<string, string[]> }

export async function loadWorkbookPackage(buffer: Buffer) {
  if (buffer.length > 20 * 1024 * 1024) throw new Error('La plantilla supera 20 MB.');
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  if (files.length > 3000 || files.reduce((n, file) => n + ((file as unknown as { _data?: { uncompressedSize: number } })._data?.uncompressedSize || 0), 0) > 100 * 1024 * 1024) throw new Error('El libro expandido supera los límites de seguridad.');
  if (!zip.file('xl/workbook.xml') || !zip.file('xl/_rels/workbook.xml.rels')) throw new Error('Se requiere un XLSX OOXML sin cifrar.');
  return zip;
}
export async function inspectWorkbookPackage(buffer: Buffer): Promise<WorkbookInspection> {
  const zip = await loadWorkbookPackage(buffer);
  const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const paths = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)) {
    const a = xmlAttrs(match[1]);
    if (a.Type?.endsWith('/worksheet') && a.TargetMode !== 'External') paths.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : posix.normalize(`xl/${a.Target}`));
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, sheetRows: 5000 });
  const resolve = (formula: string, depth = 0): string[] => {
    if (depth > 3) return [];
    const f = xmlDecode(formula).replace(/^=/, '').trim();
    if (/^".*"$/.test(f)) return f.slice(1, -1).split(',');
    const names = (wb.Workbook?.Names || []).filter(n => n.Name.toLowerCase() === f.toLowerCase());
    if (names.length > 1) return []; // Ambiguous sheet-local names must never select an arbitrary catalogue.
    if (names.length === 1) return resolve(names[0].Ref, depth + 1);
    const m = f.match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
    if (!m) return [];
    const sheet = wb.Sheets[(m[1] || m[2]).replace(/''/g, "'")];
    if (!sheet) return [];
    const start = XLSX.utils.decode_cell(`${m[3]}${m[4]}`); const end = XLSX.utils.decode_cell(`${m[5] || m[3]}${m[6] || m[4]}`);
    if ((end.r - start.r + 1) * (end.c - start.c + 1) > 5000) return [];
    const values: string[] = [];
    for (let r = start.r; r <= end.r; r++) for (let c = start.c; c <= end.c; c++) {
      const value = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      if (value != null && String(value).trim()) values.push(String(value));
    }
    return [...new Set(values)];
  };
  const sheets: PackageSheet[] = [];
  const warnings: string[] = [];
  if (Object.keys(zip.files).some(p => /vbaProject|_xmlsignatures|xl\/externalLinks\//i.test(p))) warnings.push('Macros, firmas o vínculos externos no compatibles.');
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?\s*>/g)) {
    const a = xmlAttrs(match[1]); const path = paths.get(a['r:id']);
    if (!path || !zip.file(path)) throw new Error('Relación de hoja inválida.');
    const xml = await zip.file(path)!.async('string');
    if (/<!DOCTYPE|<!ENTITY/.test(xml) || !/<sheetData(?:\s[^>]*)?(?:>|\/>)/.test(xml)) throw new Error('Estructura XML de hoja no compatible.');
    const validations: PackageValidation[] = [];
    for (const v of xml.matchAll(/<(?:\w+:)?dataValidation\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?dataValidation>/g)) {
      const attrs = xmlAttrs(v[1]);
      const formula = xmlDecode(v[2].match(/<(?:\w+:)?formula1>([\s\S]*?)<\/(?:\w+:)?formula1>/)?.[1] || v[2].match(/<(?:\w+:)?f>([\s\S]*?)<\/(?:\w+:)?f>/)?.[1] || '');
      const ranges = (attrs.sqref || xmlDecode(v[2].match(/<(?:\w+:)?sqref>([\s\S]*?)<\/(?:\w+:)?sqref>/)?.[1] || '')).split(/\s+/).filter(Boolean);
      validations.push({ ranges, type: attrs.type || '', formula, formula2: xmlDecode(v[2].match(/<(?:\w+:)?formula2>([\s\S]*?)<\/(?:\w+:)?formula2>/)?.[1] || ''), operator: attrs.operator || 'between', options: attrs.type === 'list' ? resolve(formula) : [] });
    }
    const unsupportedReason = /sheetProtection|tableParts/.test(xml) ? `${a.name}: la hoja de captura tiene protección o tabla estructurada; requiere un adaptador específico.` : undefined;
    sheets.push({ name: a.name, path, hidden: a.state === 'hidden' || a.state === 'veryHidden', validations, xml, ...(unsupportedReason ? { unsupportedReason } : {}) });
  }
  const namedRanges = Object.fromEntries((wb.Workbook?.Names || []).filter(n => (wb.Workbook?.Names || []).filter(other => other.Name.toLowerCase() === n.Name.toLowerCase()).length === 1).map(n => [n.Name, resolve(n.Ref)]));
  return { sheets, warnings, namedRanges };
}
export interface CellPatch { address: string; value: string; type?: 'text' | 'number' }
export interface SheetPatch { sheetName: string; cells: CellPatch[]; styleRow?: number }
export function rangeContains(range: string, address: string) {
  try {
    if (!/^\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/.test(range)) return false;
    const r = XLSX.utils.decode_range(range.replace(/\$/g, '')); const c = XLSX.utils.decode_cell(address);
    return c.r >= r.s.r && c.r <= r.e.r && c.c >= r.s.c && c.c <= r.e.c;
  } catch { return false; }
}
/** Read-only coordinate checks shared by preview and serialization. */
export function assertPatchableCells(inspection: WorkbookInspection, patches: SheetPatch[]) {
  if (inspection.warnings.length) throw new Error(inspection.warnings.join(' '));
  const sheetNames = new Set<string>();
  for (const patch of patches) {
    if (sheetNames.has(patch.sheetName)) throw new Error('Hoja duplicada.'); sheetNames.add(patch.sheetName);
    const sheet = inspection.sheets.find(s => s.name === patch.sheetName);
    if (!sheet || sheet.hidden || sheet.unsupportedReason) throw new Error(sheet?.unsupportedReason || `Hoja no exportable: ${patch.sheetName}.`);
    const merged = [...sheet.xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)].map(m => m[1]);
    const originals = new Map([...sheet.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m => [xmlAttrs(m[0].match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r, m[0]]));
    const seen = new Set<string>();
    for (const cell of patch.cells) {
      if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell.address) || seen.has(cell.address)) throw new Error('Coordenada inválida o duplicada.');
      seen.add(cell.address); const coord = XLSX.utils.decode_cell(cell.address);
      if (coord.c > 16383 || coord.r > 1048575 || typeof cell.value !== 'string' || cell.value.length > 32767 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(cell.value)) throw new Error('Valor fuera de los límites de Excel.');
      if (merged.some(range => rangeContains(range, cell.address))) throw new Error(`Celda combinada: ${cell.address}.`);
      const original = originals.get(cell.address);
      if (original && (/<(?:\w+:)?f(?:\s|>)/.test(original) || /\s(?:cm|vm)=/.test(original))) throw new Error(`Fórmula o metadatos de celda no editables: ${cell.address}.`);
      if (cell.type === 'number' && cell.value && !/^-?\d+(?:\.\d+)?$/.test(cell.value)) throw new Error(`Número inválido: ${cell.address}.`);
    }
  }
}
export async function patchWorkbookCells(buffer: Buffer, patches: SheetPatch[]): Promise<Buffer> {
  const inspection = await inspectWorkbookPackage(buffer);
  assertPatchableCells(inspection, patches);
  const zip = await loadWorkbookPackage(buffer);
  if (inspection.warnings.length) throw new Error(inspection.warnings.join(' '));
  const seenSheets = new Set<string>();
  for (const patch of patches) {
    if (seenSheets.has(patch.sheetName)) throw new Error('Hoja duplicada.'); seenSheets.add(patch.sheetName);
    const sheet = inspection.sheets.find(s => s.name === patch.sheetName);
    if (sheet?.unsupportedReason) throw new Error(sheet.unsupportedReason);
    if (!sheet || sheet.hidden) throw new Error(`Hoja no exportable: ${patch.sheetName}.`);
    const styleByColumn = new Map<string, string>();
    if (patch.styleRow) for (const match of sheet.xml.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const attrs = xmlAttrs(match[0].match(/^<c\b([^>]*?)(?:\/?>)/)![1]);
      const at = attrs.r?.match(/^([A-Z]+)([1-9]\d*)$/);
      if (at && Number(at[2]) === patch.styleRow && attrs.s) styleByColumn.set(at[1], attrs.s);
    }
    let xml = sheet.xml; const seen = new Set<string>();
    const merged = [...xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)].map(m => m[1]);
    const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>|<sheetData\s*\/>/);
    if (!data) throw new Error('sheetData no compatible.');
    const rows = new Map<number, string>();
    for (const row of (data[1] || '').matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
      const index = Number(xmlAttrs(row[0].match(/^<row\b([^>]*?)(?:\/?>)/)![1]).r);
      if (!index || rows.has(index)) throw new Error('Índice de fila no compatible.'); rows.set(index, row[0]);
    }
    for (const cell of patch.cells) {
      if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(cell.address) || seen.has(cell.address)) throw new Error('Coordenada inválida o duplicada.');
      const coord = XLSX.utils.decode_cell(cell.address);
      if (coord.c > 16383 || coord.r > 1048575 || cell.value.length > 32767 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(cell.value)) throw new Error('Valor fuera de los límites de Excel.');
      seen.add(cell.address);
      if (merged.some(range => rangeContains(range, cell.address))) throw new Error(`Celda combinada: ${cell.address}.`);
      const index = coord.r + 1; let row = rows.get(index) || `<row r="${index}"></row>`;
      row = row.replace(/<row\b([^>]*?)\/>/, '<row$1></row>');
      const cells = [...row.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m => m[0]);
      const previous = cells.find(c => xmlAttrs(c.match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r === cell.address);
      if (previous && /<(?:\w+:)?f(?:\s|>)/.test(previous)) throw new Error(`No se sobrescriben fórmulas: ${cell.address}.`);
      const attrs = previous ? xmlAttrs(previous.match(/^<c\b([^>]*?)(?:\/?>)/)![1]) : {};
      const styleId = attrs.s || styleByColumn.get(cell.address.replace(/\d/g, ''));
      const style = styleId ? ` s="${escapeXml(styleId)}"` : '';
      if (cell.type === 'number' && cell.value && !/^-?\d+(?:\.\d+)?$/.test(cell.value)) throw new Error(`Número inválido: ${cell.address}.`);
      const rendered = cell.type === 'number' && cell.value
        ? `<c r="${cell.address}"${style}><v>${cell.value}</v></c>`
        : `<c r="${cell.address}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
      if (previous) row = row.replace(previous, rendered);
      else {
        const next = cells.find(c => XLSX.utils.decode_cell(xmlAttrs(c.match(/^<c\b([^>]*?)(?:\/?>)/)![1]).r).c > coord.c);
        row = next ? row.replace(next, rendered + next) : row.replace('</row>', rendered + '</row>');
      }
      rows.set(index, row);
    }
    const dataOpening = data[0].match(/^<sheetData\b[^>]*>/)![0].replace(/\/>$/, '>');
    xml = xml.replace(data[0], `${dataOpening}${[...rows.entries()].sort((a,b) => a[0]-b[0]).map(r => r[1]).join('')}</sheetData>`);
    const dimension = xml.match(/<dimension\b[^>]*ref="([^"]+)"[^>]*\/>/);
    if (dimension && patch.cells.length) {
      const range = XLSX.utils.decode_range(dimension[1]);
      for (const c of patch.cells) { const at = XLSX.utils.decode_cell(c.address); range.e.r = Math.max(range.e.r, at.r); range.e.c = Math.max(range.e.c, at.c); }
      xml = xml.replace(dimension[0], dimension[0].replace(dimension[1], XLSX.utils.encode_range(range)));
    }
    zip.file(sheet.path, xml, { createFolders: false, date: zip.file(sheet.path)!.date });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Resolve relative row references against the validation's first cell (Excel semantics). */
export function validationOptions(inspection: WorkbookInspection, validation: PackageValidation, address: string, rowValuesByLetter: Record<string, string>) {
  if (validation.options.length) return validation.options;
  const first = validation.ranges[0]?.split(':')[0]?.replace(/\$/g, '');
  const firstRow = first ? XLSX.utils.decode_cell(first).r : 0;
  const targetRow = XLSX.utils.decode_cell(address).r;
  return evaluateValidationFormula(validation.formula, ref => {
    const m = ref.match(/^\$?([A-Z]+)(\$?)([1-9]\d*)$/);
    if (!m) return '';
    const referencedRow = Number(m[3]) - 1 + (m[2] ? 0 : targetRow - firstRow);
    return referencedRow === targetRow ? rowValuesByLetter[m[1]] || '' : '';
  }, name => inspection.namedRanges[Object.keys(inspection.namedRanges).find(n => n.toLowerCase() === name.toLowerCase()) || ''] || []);
}
export function validationAccepts(inspection: WorkbookInspection, validation: PackageValidation, address: string, value: string, rowValuesByLetter: Record<string, string>) {
  if (!value) return true;
  if (validation.type === 'list') return validationOptions(inspection, validation, address, rowValuesByLetter).includes(value);
  if (!['decimal', 'whole', 'textLength'].includes(validation.type)) return false;
  const number = validation.type === 'textLength' ? value.length : Number(value);
  if (!Number.isFinite(number) || (validation.type === 'whole' && !Number.isInteger(number))) return false;
  if (!/^-?\d+(?:\.\d+)?$/.test(validation.formula)) return false;
  const a = Number(validation.formula); const b = Number(validation.formula2);
  switch (validation.operator) {
    case 'greaterThan': return number > a;
    case 'greaterThanOrEqual': return number >= a;
    case 'lessThan': return number < a;
    case 'lessThanOrEqual': return number <= a;
    case 'equal': return number === a;
    case 'notEqual': return number !== a;
    case 'between': return validation.formula2 !== '' && number >= a && number <= b;
    case 'notBetween': return validation.formula2 !== '' && (number < a || number > b);
    default: return false;
  }
}
