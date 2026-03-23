/**
 * Converts any Firestore Timestamp-like value, Date, string, or number to Date | null.
 * Works with both Firebase Client SDK and Firebase Admin SDK timestamps.
 */
export const toDate = (value: unknown): Date | null => {
  if (!value) return null;

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as any).toMillis === 'function') {
    return new Date((value as any).toMillis());
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Converts a timestamp-like value to milliseconds since epoch, or null. */
export const toMillis = (value: unknown): number | null => {
  const date = toDate(value);
  return date ? date.getTime() : null;
};

/** Converts a timestamp-like value to milliseconds since epoch, returning 0 on null. */
export const toMillisOrZero = (value: unknown): number => toMillis(value) ?? 0;

/**
 * Short date+time format (es-MX): day, month abbr, hour, minute.
 * Example: "22 mar, 04:04 a.m."
 * Returns "sin fecha" if value is falsy or unparseable.
 */
export const formatDateTime = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return 'sin fecha';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * Long date+time format (es-MX): year, month abbr, day, hour, minute.
 * Example: "22 mar 2026, 04:04 a.m."
 * Returns "sin fecha" if value is falsy or unparseable.
 */
export const formatDateTimeLong = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return 'sin fecha';
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/**
 * Full date+time format (es-MX) using dateStyle/timeStyle presets.
 * Example: "22 mar 2026, 04:04 a.m."
 * Returns "sin fecha" if value is falsy or unparseable.
 */
export const formatDateTimeFull = (value: unknown): string => {
  const millis = toMillis(value);
  if (millis === null) return 'sin fecha';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(millis);
};

/**
 * Formats a timestamp as a YYYY-MM-DD string in the America/Mexico_City timezone.
 * Used by analytics aggregations. Defaults to current date if value is falsy.
 */
export const formatMexicoCityDate = (value: unknown): string => {
  const date = toDate(value) ?? new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(date);
};
