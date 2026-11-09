import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import type { MarketplaceTemplateConfig, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { MARKETPLACE_ADAPTERS, normalizeMarketplaceColumnKey } from '../../../shared/src/marketplaceExport/adapters';
import { inspectWorkbookPackage, rangeContains, validationOptions } from './ooxmlWorkbook';

export const categoryId = (sheet: string) => sheet.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
export async function analyzeMarketplaceTemplate(buffer: Buffer, marketplaceId: MarketplaceId, base: Omit<SpreadsheetTemplate, 'createdAt' | 'updatedAt'>, legacyCategories: SpreadsheetTemplateCategory[] = [], layouts: Record<string, { rowStart: number }> = {}) {
  const inspection = await inspectWorkbookPackage(buffer);
  const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: 100 });
  const categories: SpreadsheetTemplateCategory[] = [];
  const aliases = MARKETPLACE_ADAPTERS[marketplaceId].aliases;
  for (const sheet of inspection.sheets.filter(s => !s.hidden)) {
    const ws = wb.Sheets[sheet.name];
    const existing = marketplaceId === 'shein' ? legacyCategories.find(c => c.sheetName === sheet.name) : null;
    if (existing) { categories.push(existing); continue; }
    // Recognize headers per adapter; unknown layouts remain explicitly incompatible.
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = 0; r < Math.min(range.e.r + 1, 20); r++) {
      const keys = Array.from({ length: Math.min(range.e.c + 1, 300) }, (_, c) => String(ws[XLSX.utils.encode_cell({ r, c })]?.v || '').trim());
      const recognized = keys.filter(k => aliases[normalizeMarketplaceColumnKey(k)]);
      const sku = keys.some(k => aliases[normalizeMarketplaceColumnKey(k)] === 'variant.sku');
      if (!sku || recognized.length < 2 || new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length) continue;
      categories.push({ id: categoryId(sheet.name), templateId: '', clientId: base.clientId, sheetName: sheet.name, label: sheet.name, rowStart: r + 2, columns: keys.flatMap((key, index) => !key ? [] : [{ key, index, letter: XLSX.utils.encode_col(index), label: key, required: /\*$/.test(key), requirementLabel: null, guidance: null, validation: null }]), attributes: [], createdAt: null, updatedAt: null });
      break;
    }
  }
  for (const category of categories) {
    category.id = categoryId(category.sheetName);
    category.validationMode = 'template';
    const requestedRow = layouts[category.id]?.rowStart;
    if (requestedRow != null) {
      if (!Number.isInteger(requestedRow) || requestedRow < category.rowStart || requestedRow > 1000) throw new Error(`Fila de inicio inválida para ${category.label}; debe ser entre ${category.rowStart} y 1000.`);
      category.rowStart = requestedRow;
    }
    const sheet = inspection.sheets.find(s => s.name === category.sheetName)!;
    category.columns = category.columns.map(column => {
      const validations = sheet.validations.filter(v => v.ranges.some(range => rangeContains(range, `${column.letter}${category.rowStart}`)));
      const list = validations.find(v => v.type === 'list');
      return { ...column, ...(list ? { dropdownFormula: list.formula, dropdownOptions: list.options } : {}), ...(validations.some(v => v.type !== 'list') ? { validation: 'Validación avanzada: requiere adaptador específico' } : {}) };
    });
  }
  const warnings = [...inspection.warnings];
  for (const category of categories) {
    const sheet = inspection.sheets.find(s => s.name === category.sheetName)!;
    if (sheet.unsupportedReason) warnings.push(sheet.unsupportedReason);
    for (const column of category.columns) {
      const validation = sheet.validations.find(v => v.type === 'list' && v.ranges.some(r => rangeContains(r, `${column.letter}${category.rowStart}`)));
      if (!validation || validation.options.length) continue;
      const dependencies = [...new Set([...validation.formula.matchAll(/\$([A-Z]+)\$?\d+/g)].map(m => m[1]))];
      if (dependencies.length === 1) {
        const dependency = category.columns.find(c => c.letter === dependencies[0]);
        if (dependency?.dropdownOptions?.length) {
          const optionsByValue = Object.fromEntries(dependency.dropdownOptions.map(value => [value, validationOptions(inspection, validation, `${column.letter}${category.rowStart}`, { [dependency.letter]: value })]));
          if (Object.values(optionsByValue).some(values => values.length)) column.dropdownDependency = { columnKey: dependency.key, optionsByValue };
        }
      }
      // Missing static references cannot be repaired by inventing catalogue values.
      if (!column.dropdownDependency && !/INDIRECT/i.test(validation.formula)) {
        column.validation = `Lista sin resolver: ${validation.formula}`;
      }
    }
  }
  if (!categories.length) warnings.push('No se reconoce una estructura de captura compatible con este marketplace.');
  if (new Set(categories.map(c => c.id)).size !== categories.length) warnings.push('Hay nombres de categorías ambiguos.');
  const mappings: MarketplaceTemplateConfig['mappings'] = Object.fromEntries(categories.map(c => [c.id!, Object.fromEntries(c.columns.map(column => [column.key, { source: aliases[normalizeMarketplaceColumnKey(column.key)] || '', required: column.required, dataType: 'text' as const }]))]));
  const config: MarketplaceTemplateConfig = { marketplaceId, version: 1, operation: 'listing', validationStatus: warnings.length ? 'incompatible' : 'needs_configuration', validationMessages: warnings.length ? warnings : ['Revisa la fila inicial, categorías, campos obligatorios y asociaciones antes de activar. Compatibilidad final pendiente de una carga de prueba en el marketplace.'], mappings };
  return {
    template: { ...base, templateFingerprint: createHash('sha256').update(buffer).digest('hex'), exportConfig: config, categoryIds: categories.map(c => c.id!), categories: categories.map(c => ({ id: c.id!, sheetName: c.sheetName, label: c.label, columnCount: c.columns.length, attributeCount: c.attributes.length, rowStart: c.rowStart })), defaultCategoryId: categories[0]?.id || null, defaultCategoryLabel: categories[0]?.label || null }, categories,
  };
}

export function assertTemplateDocumentLimits(template: unknown, categories: unknown[]) {
  if (categories.length > 100 || [template, ...categories].some(doc => Buffer.byteLength(JSON.stringify(doc)) > 850 * 1024)) throw new Error('La estructura de la plantilla supera los límites de almacenamiento; divide las categorías en archivos más pequeños.');
}
