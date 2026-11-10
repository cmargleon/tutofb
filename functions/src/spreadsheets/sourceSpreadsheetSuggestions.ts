import { ProductDraftValueSuggestion, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { getProductDraftSpecificationAttributeName } from '../../../shared/src/utils/spreadsheetDraftColumns';
import { findBestCellValue, findMatchingCellValues, normalizeComparable, SOURCE_HEADER_ALIASES } from './sourceSpreadsheetColumns';
import { pickBestOption } from './sourceSpreadsheetScoring';
import { MatchedSourceSpreadsheetRow, ParsedSourceSpreadsheetRow } from './sourceSpreadsheetTypes';

export const getSourceValueAliases = (column: Pick<SpreadsheetTemplateCategory, 'label'>['label'], key: string): RegExp[] => {
  const normalizedLabel = normalizeComparable(column);
  const normalizedKey = normalizeComparable(key);

  if (normalizedKey.includes('spu') || normalizedKey.includes('sku') || normalizedLabel.includes('spu') || normalizedLabel.includes('sku')) {
    return SOURCE_HEADER_ALIASES.code;
  }
  if (normalizedLabel.includes('nombre de producto') || normalizedKey.includes('default product name')) {
    return SOURCE_HEADER_ALIASES.productName;
  }
  if (normalizedLabel.includes('descripcion del producto') || normalizedKey.includes('default product desc')) {
    return SOURCE_HEADER_ALIASES.description;
  }
  if (normalizedLabel.includes('color')) {
    return SOURCE_HEADER_ALIASES.color;
  }
  if (normalizedLabel.includes('talla') || normalizedKey.includes('size')) {
    return SOURCE_HEADER_ALIASES.size;
  }
  if (normalizedLabel.includes('stock')) {
    return SOURCE_HEADER_ALIASES.stock;
  }
  if (normalizedLabel.includes('precio') || normalizedLabel.includes('costo')) {
    return SOURCE_HEADER_ALIASES.price;
  }
  if (normalizedLabel.includes('peso')) {
    return SOURCE_HEADER_ALIASES.weight;
  }
  if (normalizedLabel.includes('largo') || normalizedLabel.includes('longitud')) {
    return SOURCE_HEADER_ALIASES.length;
  }
  if (normalizedLabel.includes('ancho') || normalizedKey.includes('width')) {
    return SOURCE_HEADER_ALIASES.width;
  }
  if (normalizedLabel.includes('alto') || normalizedKey.includes('height')) {
    return SOURCE_HEADER_ALIASES.height;
  }

  return [
    new RegExp(normalizedLabel.replace(/\s+/g, '\\s+')),
    new RegExp(normalizedKey.replace(/\s+/g, '\\s+')),
  ];
};

export const getSpecificSourceValueForColumn = (
  row: ParsedSourceSpreadsheetRow,
  category: SpreadsheetTemplateCategory,
  column: SpreadsheetTemplateCategory['columns'][number],
): string | null => {
  const normalizedKey = normalizeComparable(column.key).replace(/\s+/g, '_');
  const normalizedLabel = normalizeComparable(column.label);
  const specificationAttributeName = getProductDraftSpecificationAttributeName(category, column);
  const normalizedSpecificationName = specificationAttributeName ? normalizeComparable(specificationAttributeName) : '';
  const spuValues = findMatchingCellValues(row.cells, [...SOURCE_HEADER_ALIASES.code]);

  if (normalizedKey === 'supplier_code') {
    return spuValues[0] || null;
  }

  if (normalizedKey === 'supplier_sku') {
    return spuValues[1] || spuValues[0] || null;
  }

  if (normalizedKey === 'default_product_name_es' || normalizedKey === 'default_product_name') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.productName]);
  }

  if (normalizedKey === 'default_product_desc_es' || normalizedKey === 'default_product_desc') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.description]);
  }

  if (normalizedKey === 'brand_code' || normalizedLabel === 'marca') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.brand]);
  }

  if (normalizedKey === 'origin_code' || normalizedLabel === 'origen') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.origin]);
  }

  if (normalizedKey === 'ip_character' || normalizedLabel.includes('propiedad intelectual')) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.ipCharacter]);
  }

  if (normalizedKey.includes('stock') || normalizedLabel === 'stock') {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.stock]);
  }

  if (normalizedKey.includes('price') || normalizedKey.includes('precio') || normalizedLabel.includes('precio')) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.price]);
  }

  if (
    normalizedKey.includes('weight')
    || normalizedKey.includes('peso')
    || normalizedLabel.includes('peso')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.weight]);
  }

  if (
    normalizedKey.includes('length')
    || normalizedKey.includes('largo')
    || normalizedKey.includes('package_length')
    || normalizedLabel.includes('largo')
    || normalizedLabel.includes('longitud')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.length]);
  }

  if (
    normalizedKey.includes('width')
    || normalizedKey.includes('ancho')
    || normalizedKey.includes('package_width')
    || normalizedLabel.includes('ancho')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.width]);
  }

  if (
    normalizedKey.includes('height')
    || normalizedKey.includes('alto')
    || normalizedKey.includes('package_height')
    || normalizedLabel.includes('alto')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.height]);
  }

  if (
    normalizedKey === 'main_attribute_value'
    || normalizedLabel.includes('color')
    || normalizedSpecificationName.includes('color')
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.color]);
  }

  if (
    normalizedKey.endsWith('_value')
    && (
      normalizedLabel.includes('talla')
      || normalizedLabel.includes('size')
      || normalizedSpecificationName.includes('talla')
      || normalizedSpecificationName.includes('size')
      || normalizedSpecificationName.includes('tamano')
    )
  ) {
    return findBestCellValue(row.cells, [...SOURCE_HEADER_ALIASES.size]);
  }

  return null;
};

export const findSourceCellValueForColumn = (
  row: ParsedSourceSpreadsheetRow,
  category: SpreadsheetTemplateCategory,
  column: SpreadsheetTemplateCategory['columns'][number],
): string | null => {
  const explicitValue = getSpecificSourceValueForColumn(row, category, column);
  if (explicitValue) {
    return explicitValue;
  }

  const aliases = getSourceValueAliases(column.label, column.key);
  for (const alias of aliases) {
    const directMatch = row.cells.find((cell) => alias.test(cell.normalizedHeader) && cell.value.trim());
    if (directMatch) {
      return directMatch.value.trim();
    }
  }

  return null;
};

export const buildSourceSpreadsheetSuggestions = (
  category: SpreadsheetTemplateCategory,
  match: MatchedSourceSpreadsheetRow | null,
): Record<string, ProductDraftValueSuggestion> => {
  if (!match) {
    return {};
  }

  const { row } = match;
  return category.columns.reduce<Record<string, ProductDraftValueSuggestion>>((result, column) => {
    const value = findSourceCellValueForColumn(row, category, column);
    if (!value) {
      return result;
    }

    result[column.key] = {
      value,
      confidence: Math.min(0.98, Math.max(0.62, match.score / 100)),
      reasoning: [
        `Valor recuperado de la fila ${row.rowNumber} del spreadsheet fuente.`,
        `Match ${match.strategy} con score ${match.score}.`,
        match.evidence.length > 0 ? `Evidencia: ${match.evidence.slice(0, 3).join('; ')}.` : null,
      ].filter(Boolean).join(' '),
      source: 'spreadsheet_source',
    };
    return result;
  }, {});
};

export const resolveSourceSpreadsheetRowColor = (
  row: ParsedSourceSpreadsheetRow | null,
  category: SpreadsheetTemplateCategory,
): string | null => {
  if (!row) {
    return null;
  }

  const rawColor = findBestCellValue(row.cells, [/^color$/, /\bcolor\b/]);
  if (!rawColor) {
    return null;
  }

  const colorOptions = category.attributes.find((attribute) => /color/.test(normalizeComparable(attribute.name)))?.values || [];
  return pickBestOption(colorOptions, [rawColor]) || rawColor;
};
