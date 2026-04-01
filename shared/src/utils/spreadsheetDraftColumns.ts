import type { SpreadsheetTemplateCategory, SpreadsheetTemplateCategoryAttribute, SpreadsheetTemplateCategoryColumn } from '../types';

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stripAttributeCode = (value: string): string =>
  value.replace(/\s*\(\d+(?:-\d+)?\)\s*$/, '').trim();

const extractAttributeCode = (value: string): string | null => {
  const match = value.match(/\((\d+(?:-\d+)?)\)/);
  return match?.[1] || null;
};

const normalizeAttributeKey = (value: string): string =>
  normalizeComparable(stripAttributeCode(value));

const SPECIFICATION_FALLBACKS: Array<{ codes: string[]; names: string[] }> = [
  { codes: ['27'], names: ['color'] },
  { codes: ['87'], names: ['talla', 'tamano', 'size'] },
];

const isSpecificationAttribute = (attribute: SpreadsheetTemplateCategoryAttribute): boolean =>
  normalizeComparable(attribute.attributeType || '').includes('especific');

const findAttributeByName = (
  category: SpreadsheetTemplateCategory,
  attributeName: string | null | undefined,
): SpreadsheetTemplateCategoryAttribute | null => {
  if (!attributeName) {
    return null;
  }

  const normalizedTarget = normalizeAttributeKey(attributeName);
  const targetCode = extractAttributeCode(attributeName);

  return category.attributes.find((attribute) => {
    const normalizedName = normalizeAttributeKey(attribute.name);
    const attributeCode = extractAttributeCode(attribute.name);

    return (
      normalizedName === normalizedTarget
      || (Boolean(targetCode) && attributeCode === targetCode)
    );
  }) || null;
};

const getSpecificationAttributes = (category: SpreadsheetTemplateCategory): SpreadsheetTemplateCategoryAttribute[] =>
  category.attributes.filter(isSpecificationAttribute);

const getSpecificationNameByIndex = (category: SpreadsheetTemplateCategory, specIndex: number): string | null => {
  const fallback = SPECIFICATION_FALLBACKS[specIndex];
  if (fallback) {
    const preferredAttribute = category.attributes.find((attribute) => {
      const attributeCode = extractAttributeCode(attribute.name);
      const normalizedName = normalizeAttributeKey(attribute.name);
      return (
        fallback.codes.includes(attributeCode || '')
        || fallback.names.some((name) => normalizedName === name || normalizedName.includes(name))
      );
    });

    if (preferredAttribute?.name) {
      return preferredAttribute.name;
    }
  }

  return getSpecificationAttributes(category)[specIndex]?.name || null;
};

const getSpecificationKeyMetadata = (columnKey: string): { type: 'name' | 'value'; specIndex: number } | null => {
  const normalizedKey = normalizeComparable(columnKey).replace(/\s+/g, '_');

  if (normalizedKey === 'main_attribute') {
    return { type: 'name', specIndex: 0 };
  }

  if (normalizedKey === 'main_attribute_value') {
    return { type: 'value', specIndex: 0 };
  }

  const secondaryMatch = normalizedKey.match(/^secondary_attribute_(\d+)$/);
  if (secondaryMatch) {
    return {
      type: 'name',
      specIndex: Number(secondaryMatch[1]),
    };
  }

  const secondaryValueMatch = normalizedKey.match(/^secondary_attribute_(\d+)_value$/);
  if (secondaryValueMatch) {
    return {
      type: 'value',
      specIndex: Number(secondaryValueMatch[1]),
    };
  }

  return null;
};

const getColumnDropdownOptions = (
  column: Pick<SpreadsheetTemplateCategoryColumn, 'dropdownOptions'>,
): string[] =>
  Array.isArray(column.dropdownOptions)
    ? column.dropdownOptions.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];

const getForcedMainAttributeValueOptions = (category: SpreadsheetTemplateCategory): string[] =>
  findAttributeByName(category, getSpecificationNameByIndex(category, 0))?.values || [];

export const getProductDraftColumnDefaultValue = (
  category: SpreadsheetTemplateCategory,
  column: Pick<SpreadsheetTemplateCategoryColumn, 'key'>,
): string | null => {
  const specMetadata = getSpecificationKeyMetadata(column.key);
  if (!specMetadata || specMetadata.type !== 'name') {
    return null;
  }

  return getSpecificationNameByIndex(category, specMetadata.specIndex);
};

export const getProductDraftSpecificationAttributeName = (
  category: SpreadsheetTemplateCategory,
  column: Pick<SpreadsheetTemplateCategoryColumn, 'key'>,
): string | null => {
  const specMetadata = getSpecificationKeyMetadata(column.key);
  if (!specMetadata || specMetadata.type !== 'value') {
    return null;
  }

  return getSpecificationNameByIndex(category, specMetadata.specIndex);
};

export const getProductDraftColumnAllowedValues = (
  category: SpreadsheetTemplateCategory,
  column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label' | 'validation' | 'guidance' | 'dropdownOptions'>,
  rowValues: Record<string, string> = {},
): string[] => {
  const specMetadata = getSpecificationKeyMetadata(column.key);
  if (specMetadata?.type === 'name') {
    const attributeName = getSpecificationNameByIndex(category, specMetadata.specIndex);
    return attributeName ? [attributeName] : [];
  }

  if (specMetadata?.type === 'value') {
    const dropdownOptions = getColumnDropdownOptions(column);
    if (dropdownOptions.length > 0) {
      return dropdownOptions;
    }

    if (specMetadata.specIndex === 0) {
      return getForcedMainAttributeValueOptions(category);
    }

    return [];
  }

  return getColumnDropdownOptions(column);
};

export const coerceToAllowedValue = (
  options: string[],
  candidates: Array<string | null | undefined>,
): string | null => {
  const normalizedOptions = options.map((option) => ({
    raw: option,
    normalized: normalizeComparable(option),
  }));

  for (const candidate of candidates) {
    if (!candidate?.trim()) {
      continue;
    }

    const normalizedCandidate = normalizeComparable(candidate);
    const exact = normalizedOptions.find((option) => option.normalized === normalizedCandidate);
    if (exact) {
      return exact.raw;
    }

    const partial = normalizedOptions.find(
      (option) => option.normalized.includes(normalizedCandidate) || normalizedCandidate.includes(option.normalized),
    );
    if (partial) {
      return partial.raw;
    }
  }

  return null;
};

export const resolveProductDraftColumnValue = ({
  category,
  column,
  rowValues = {},
  candidates,
}: {
  category: SpreadsheetTemplateCategory;
  column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label' | 'validation' | 'guidance' | 'dropdownOptions'>;
  rowValues?: Record<string, string>;
  candidates: Array<string | null | undefined>;
}): string => {
  const fallbackValue = getProductDraftColumnDefaultValue(category, column);
  const allowedValues = getProductDraftColumnAllowedValues(category, column, rowValues);

  if (allowedValues.length > 0) {
    return coerceToAllowedValue(allowedValues, [...candidates, fallbackValue]) || (allowedValues.length === 1 ? allowedValues[0]! : '');
  }

  const firstCandidate = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return firstCandidate?.trim() || fallbackValue || '';
};

export const isProductDraftDropdownColumn = (
  category: SpreadsheetTemplateCategory,
  column: Pick<SpreadsheetTemplateCategoryColumn, 'key' | 'label' | 'validation' | 'guidance' | 'dropdownOptions'>,
  rowValues: Record<string, string> = {},
): boolean => {
  return getProductDraftColumnAllowedValues(category, column, rowValues).length > 0;
};

export default {
  coerceToAllowedValue,
  getProductDraftColumnAllowedValues,
  getProductDraftColumnDefaultValue,
  getProductDraftSpecificationAttributeName,
  isProductDraftDropdownColumn,
  resolveProductDraftColumnValue,
};
