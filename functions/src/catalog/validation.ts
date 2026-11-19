import { HttpsError } from 'firebase-functions/v2/https';
export function catalogStringMap(value: unknown, allowed?: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) throw new HttpsError('invalid-argument', 'Campos inválidos.');
  const entries = Object.entries(value);
  for (const [key, item] of entries) if (!key || key.length > 100 || /[\x00-\x1f]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || (allowed && !allowed.includes(key)) || typeof item !== 'string' || item.length > 20000)
    throw new HttpsError('invalid-argument', `Campo inválido: ${key}.`);
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
}
export function catalogRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpsError('invalid-argument', 'Revisión inválida.');
  return value as number;
}
export function assertCatalogSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 700_000) throw new HttpsError('resource-exhausted', 'La ficha supera el tamaño permitido.');
}
