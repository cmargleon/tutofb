/** Stable comparison for JSON configuration; ignores object key ordering. */
export const configSnapshot = (value: unknown): string => JSON.stringify(value, (_key, current) =>
  current && typeof current === 'object' && !Array.isArray(current)
    ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]])) : current);
