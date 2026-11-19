import { groupProductRows, parseTab, productVariant } from '../../functions/lib/functions/src/organizer/catalog.js';
import { buildBaseCodeIndex, resolveBaseCode } from '../../functions/lib/functions/src/organizer/baseCode.js';

export type Gold = { sheet: string[][]; photos: { name: string; expected: string | null; case?: string }[] };

/** Runs the real parsing, grouping and resolver code over a gold set. */
export function evaluateGold(gold: Gold) {
  const { rows } = parseTab({ id: 'gold', name: 'gold.xlsx' }, 'Catálogo', 0, gold.sheet);
  const { groups, anchors } = groupProductRows(rows);
  const variants = [...groups].map(([id, entries]) => productVariant(id, entries, undefined, anchors.get(id)));
  const index = buildBaseCodeIndex(variants, rows);
  const results = gold.photos.map(photo => {
    const identity = resolveBaseCode(photo.name, index);
    const variant = variants.find(item => item.id === identity.variantId);
    const got = variant ? variant.skcs[0] || variant.visual : identity.method === 'codigo_base' ? `base:${identity.baseCode}` : null;
    const ok = got === photo.expected;
    // Wrong = a concrete identity that differs from the label. An exception where one was expected is a miss.
    const wrong = !ok && got !== null;
    return { ...photo, got, ok, wrong, method: identity.method };
  });
  const correct = results.filter(row => row.ok).length;
  const wrong = results.filter(row => row.wrong).length;
  const automatic = results.filter(row => row.ok && row.expected !== null).length;
  const expectedAutomatic = results.filter(row => row.expected !== null).length;
  return { rows: results, total: results.length, correct, wrong, missed: results.length - correct - wrong,
    coverage: expectedAutomatic ? automatic / expectedAutomatic : 1, variants, index };
}
