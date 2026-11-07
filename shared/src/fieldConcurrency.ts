/** Compare exactly the edited fields, using the same normalized values as the form. */
export function changedFields<T extends Record<string, unknown>>(base: T, value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([key, next]) => next !== base[key])) as Partial<T>;
}
export function conflictingFields(current: Record<string, unknown>, patch: Record<string, unknown>, expected: Record<string, unknown> | undefined) {
  return Object.keys(patch).filter(key => !expected || !Object.hasOwn(expected, key) || current[key] !== expected[key]);
}
