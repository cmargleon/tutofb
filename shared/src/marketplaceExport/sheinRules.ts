import type { SpreadsheetTemplateCategoryColumn } from '../types';

export const sheinMultiValue = (column: Pick<SpreadsheetTemplateCategoryColumn, 'guidance'>) =>
  /sep[áa]relos con \*/i.test(column.guidance || '');

export function sheinValueIssue(column: SpreadsheetTemplateCategoryColumn, value: string): string | null {
  const rule = column.validation || '';
  const textLength = rule.match(/l[ií]mite de longitud de caracteres:\s*(\d+)-(\d+)/i)
    || rule.match(/^1\.(\d+)-(\d+) caracteres/i);
  if (textLength && (value.length < Number(textLength[1]) || value.length > Number(textLength[2]))) {
    return `Admite entre ${textLength[1]} y ${textLength[2]} caracteres.`;
  }
  if (/^stock\[/.test(column.key) && /enteros positivos/.test(rule) && !/^[1-9]\d{0,5}$/.test(value)) {
    return 'Las existencias deben ser un entero positivo de hasta 6 dígitos.';
  }
  if (/^original_price\[/.test(column.key) && /hasta 2 decimales/.test(rule)
      && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0 || value.length > 10)) {
    return 'El precio debe ser positivo, con hasta 2 decimales y 10 caracteres.';
  }
  return null;
}

export function sheinDimensionsIssue(dimensions: SpreadsheetTemplateCategoryColumn[], values: Record<string, string>) {
  if (dimensions.length !== 3 || !dimensions.some(column => /dos lados.*mayores a 1 cm/.test(column.validation || ''))) return null;
  const lengths = dimensions.map(column => Number(values[column.key]));
  if (!dimensions.some(column => values[column.key])) return null;
  if (lengths.filter(length => length > 1).length < 2 || Number(values.length) > 6000) {
    return 'Al menos dos dimensiones del paquete deben superar 1 cm y el largo no puede superar 6000 cm.';
  }
  return null;
}
