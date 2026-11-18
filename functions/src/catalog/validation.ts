import { HttpsError } from 'firebase-functions/v2/https';
import { PRODUCT_FIELDS, VARIANT_FIELDS, type MasterVariant } from '../../../shared/src/types';
import { validId } from '../manglar/access';
export function catalogStringMap(value: unknown, allowed?: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) throw new HttpsError('invalid-argument', 'Campos inválidos.');
  const entries = Object.entries(value);
  for (const [key, item] of entries) if (!key || key.length > 100 || /[\x00-\x1f]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || (allowed && !allowed.includes(key)) || typeof item !== 'string' || item.length > 20000)
    throw new HttpsError('invalid-argument', `Campo inválido: ${key}.`);
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
}
export const catalogValues = (value: unknown) => catalogStringMap(value, PRODUCT_FIELDS);
export function catalogVariants(value: unknown): MasterVariant[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new HttpsError('invalid-argument', 'Configura entre 1 y 200 variantes.');
  const variants = value.map(v => ({ id: validId(v?.id), values: catalogStringMap(v?.values, VARIANT_FIELDS), attributes: catalogStringMap(v?.attributes || {}) }));
  if (new Set(variants.map(v => v.id)).size !== variants.length) throw new HttpsError('invalid-argument', 'Las variantes deben tener IDs únicos.');
  return variants;
}
export function catalogRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpsError('invalid-argument', 'Revisión inválida.');
  return value as number;
}
export function catalogPageSize(value?: number) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new HttpsError('invalid-argument', 'Página inválida (1–50).');
  return value;
}
export function assertCatalogSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 700_000) throw new HttpsError('resource-exhausted', 'La ficha supera el tamaño permitido.');
}
