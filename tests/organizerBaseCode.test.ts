import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { associateByBaseCode, buildBaseCodeIndex, canonicalColors, colorsCompatible, contentVersionOf, longestCode, requiredViews, resolveBaseCode } from '../functions/lib/functions/src/organizer/baseCode.js';
import { decideVariant, identityModeOf, parseClosedSet } from '../functions/lib/functions/src/organizer/baseCodeVision.js';
import { photoDecisionKey } from '../functions/lib/functions/src/organizer/planning.js';
import { approvedReferenceIds } from '../functions/lib/functions/src/organizer/automation.js';
import { baseAliasId, chooseBindingTarget, mapVariantsByCode, organizerDraftProduct } from '../functions/lib/functions/src/catalog/organizerBinding.js';
import { evaluateGold, type Gold } from '../scripts/organizer/baseCodeGold';
import type { OrganizerVariant, StoredMasterProduct } from '../shared/src/types';
import type { PhotoState } from '../functions/src/organizer/worker';

const gold = JSON.parse(readFileSync(new URL('./fixtures/organizer-base-code-gold.json', import.meta.url), 'utf8')) as Gold;
const fixture = evaluateGold(gold);
const bySkc = (skc: string) => fixture.variants.find(variant => variant.skcs.includes(skc))!;

test('conjunto de referencia: ninguna foto se asigna a un producto o variante incorrectos', () => {
  const wrong = fixture.rows.filter(row => row.wrong);
  assert.deepEqual(wrong, []);
  assert.equal(fixture.correct, fixture.total);
});

test('prefijo más largo con frontera: CAM001 no captura CAM0010 ni nombres pegados', () => {
  const codes = ['CAM001', 'CAM0010', 'AB-120'];
  assert.equal(longestCode('CAM0010-01', codes), 'CAM0010');
  assert.equal(longestCode('CAM001-01', codes), 'CAM001');
  assert.equal(longestCode('CAM00101', codes), null);
  assert.equal(longestCode('AB-12001', codes), null);
  assert.equal(longestCode('AB-120_2', codes), 'AB-120');
  assert.equal(longestCode('CAM001', codes), 'CAM001');
});

test('sin columna de código base no se deduce la base cortando por el primer guion', () => {
  const sheet = [['SKC', 'Nombre', 'Color'], ['AB-120', 'Taza', 'Azul'], ['AB-121', 'Plato', 'Rojo']];
  const result = evaluateGold({ sheet, photos: [{ name: 'AB-01.jpg', expected: null }, { name: 'AB-120-01.jpg', expected: 'AB-120' }] });
  assert.equal(result.wrong, 0);
  assert.equal(result.index.declared.size, 0);
  assert.equal(resolveBaseCode('AB-01.jpg', result.index).method, 'sin_codigo');
});

test('código base duplicado con productos distintos queda como excepción (caso D)', () => {
  const identity = resolveBaseCode('DUP9-01.jpg', fixture.index);
  assert.equal(identity.method, 'codigo_base_conflicto');
  assert.equal(identity.variantId, null);
  assert.match(identity.issue!, /categorías distintas|productos distintos/);
  // Same base with different colors is the normal case, not a conflict.
  assert.equal(fixture.index.conflicts.has('CAM001'), false);
});

test('variantes del mismo color se marcan como indistinguibles (caso G)', () => {
  assert.ok(fixture.index.indistinct.has(bySkc('CAM002-LISO').id));
  assert.ok(fixture.index.indistinct.has(bySkc('CAM002-EST').id));
  assert.equal(fixture.index.indistinct.has(bySkc('CAM001-N').id), false);
});

test('asociación por nombre: sin inferencia por carpeta ni vecinas, fotos compartidas, duplicados y decisiones humanas', () => {
  const file = (id: string, name: string, extra = {}) => ({ id, name, path: ['root', 'CAM001-N', name], parents: ['folder'], ...extra });
  const results = associateByBaseCode([
    file('a', 'CAM001-N-01.jpg', { md5Checksum: 'x', size: '10' }),
    file('b', 'IMG_1.jpg'),
    file('c', 'CAM001-N Y AB-120.jpg'),
    file('d', 'copia.jpg', { md5Checksum: 'x', size: '10' }),
    file('e', 'CAM001-01.jpg'),
  ], fixture.index, new Map([['e', bySkc('CAM001-R').id]]));
  assert.equal(results.get('a')!.variantId, bySkc('CAM001-N').id);
  assert.equal(results.get('b')!.variantId, null, 'una carpeta con nombre de SKC no asigna fotos sin código');
  assert.equal(results.get('b')!.identityState, 'unresolved');
  assert.equal(results.get('c')!.identityState, 'shared');
  assert.deepEqual(new Set(results.get('c')!.variantIds), new Set([bySkc('CAM001-N').id, bySkc('AB-120-AZ').id]));
  assert.equal(results.get('d')!.duplicateOf, 'a');
  assert.equal(results.get('e')!.method, 'manual');
  assert.equal(results.get('e')!.variantId, bySkc('CAM001-R').id);
});

test('colores: sinónimos, abreviaturas y marino frente a azul', () => {
  assert.deepEqual(canonicalColors('Negro mate'), ['negro']);
  assert.deepEqual(canonicalColors('NEG'), ['negro']);
  assert.deepEqual(canonicalColors('Black'), ['negro']);
  assert.deepEqual(canonicalColors('Azul marino'), ['marino']);
  assert.equal(colorsCompatible('negro', 'NGO'), true);
  assert.equal(colorsCompatible('blanco', 'Negro'), false);
  assert.equal(colorsCompatible('azul marino', 'Azul'), false);
  assert.equal(colorsCompatible('', 'Negro'), null);
  assert.equal(colorsCompatible('turquesa raro', 'Pantone 123'), null);
});

const photo = (overrides: Partial<PhotoState>): PhotoState => ({ id: 'p', name: 'CAM001-01.jpg', path: ['root', 'CAM001-01.jpg'], sourceUrl: '', copyUrl: 'c', variantId: null,
  candidates: [], method: 'codigo_base', evidence: [], confidence: 0, issue: 'Variante pendiente de identificación visual.', duplicateOf: null, reviewedBy: null, view: 'front',
  hasConflict: true, version: '1', algorithm: '5', updatedAt: 0, identityState: 'base', visualColor: 'negro', ...overrides });
const cam001 = () => fixture.variants.filter(variant => variant.base === 'CAM001');
const answer = (overrides = {}) => ({ id: 'p1', matchesProduct: true, multiple: false, variant: 'v1', confidence: 0.9, reason: 'camisa negra', ...overrides });

test('IA de variante: acepta solo con umbral, color compatible y variante distinguible', () => {
  const black = bySkc('CAM001-N');
  const white = bySkc('CAM001-B');
  const accepted = decideVariant(photo({}), answer(), black, cam001(), 'CAM001', 0.75, 'k');
  assert.equal(accepted.variantId, black.id);
  assert.equal(accepted.method, 'gemini_variante');
  assert.equal(accepted.issue, null);
  assert.equal(decideVariant(photo({}), answer({ confidence: 0.6 }), black, cam001(), 'CAM001', 0.75, 'k').variantId, undefined);
  const contradicted = decideVariant(photo({ visualColor: 'blanco' }), answer(), black, cam001(), 'CAM001', 0.75, 'k');
  assert.equal(contradicted.variantId, undefined);
  assert.match(contradicted.issue!, /contradice/);
  assert.equal(decideVariant(photo({}), answer({ variant: null }), null, cam001(), 'CAM001', 0.75, 'k').variantId, undefined);
  const g = fixture.variants.filter(variant => variant.base === 'CAM002');
  const indistinct = decideVariant(photo({}), answer(), g[0], g, 'CAM002', 0.75, 'k');
  assert.equal(indistinct.variantId, undefined);
  assert.match(indistinct.issue!, /mismo color/);
  assert.ok(white);
});

test('concordancia: un código válido que muestra otro producto pierde la identidad (caso F)', () => {
  const black = bySkc('CAM001-N');
  const coded = photo({ identityState: 'variant', variantId: black.id, variantIds: [black.id], method: 'codigo_variante', issue: null });
  const mismatch = decideVariant(coded, answer({ matchesProduct: false, reason: 'es una taza' }), null, cam001(), 'CAM001', 0.75, 'k');
  assert.equal(mismatch.variantId, null);
  assert.deepEqual(mismatch.referenceEligibleFor, []);
  assert.equal(mismatch.identityState, 'needs_review');
  const colorClash = decideVariant({ ...coded, visualColor: 'blanco' }, answer({ variant: 'v2' }), bySkc('CAM001-B'), cam001(), 'CAM001', 0.75, 'k');
  assert.match(colorClash.issue!, /no coincide con la variante del nombre/);
  const confirmed = decideVariant(coded, answer({ variant: 'v1' }), black, cam001(), 'CAM001', 0.75, 'k');
  assert.deepEqual(confirmed.concordance, { matches: true, reason: 'camisa negra' });
  assert.equal(confirmed.issue, null);
  const multiple = decideVariant(photo({}), answer({ multiple: true }), black, cam001(), 'CAM001', 0.75, 'k');
  assert.equal(multiple.variantId, undefined);
  assert.match(multiple.issue!, /varios artículos/);
});

test('respuesta de elección cerrada: ignora IDs inventados', () => {
  const parsed = parseClosedSet({ photos: [answer(), { ...answer(), id: 'p9' }, { ...answer({ id: 'p2', variant: 'v7' }) }] }, ['p1', 'p2'], ['v1', 'v2']);
  assert.deepEqual(parsed.map(item => [item.id, item.variant]), [['p1', 'v1'], ['p2', null]]);
  assert.throws(() => parseClosedSet({ photos: [] }, ['p1'], ['v1']));
});

test('mover un archivo no caduca la decisión humana en modo código base (caso K)', () => {
  const entry = { id: 'f', name: 'CAM001-01.jpg', mimeType: 'image/jpeg', version: '3', md5Checksum: 'abc', size: '9', path: ['root', 'A', 'CAM001-01.jpg'], sourceId: 'root' };
  const moved = { ...entry, version: '4', path: ['root', 'B', 'CAM001-01.jpg'] };
  const variants = cam001();
  assert.equal(photoDecisionKey(entry, variants, true), photoDecisionKey(moved, variants, true));
  assert.notEqual(photoDecisionKey(entry, variants), photoDecisionKey(moved, variants));
  assert.notEqual(photoDecisionKey(entry, variants, true), photoDecisionKey({ ...entry, md5Checksum: 'edited' }, variants, true));
  assert.equal(contentVersionOf(moved), 'md5:abc:9');
});

test('perfiles de referencia por tipo de artículo', () => {
  assert.deepEqual(requiredViews('garment', 'Camisas'), ['front', 'back']);
  assert.deepEqual(requiredViews('garment', 'Gorras'), ['front']);
  assert.deepEqual(requiredViews('product', 'Cocina'), ['main']);
});

test('generación en modo código base: solo con referencias aprobadas', () => {
  const variant = { referenceState: 'approved', references: { front: ['f1'], back: ['b1', 'f1'], main: [] } } as Pick<OrganizerVariant, 'referenceState' | 'references'>;
  assert.deepEqual(approvedReferenceIds(variant), ['f1', 'b1']);
  assert.equal(approvedReferenceIds({ ...variant, referenceState: 'suggested' }), null);
  assert.deepEqual(approvedReferenceIds({ referenceState: 'approved', references: { front: [], back: [], main: ['m'], complementary: ['c1', 'c2'] } }), ['m', 'c1', 'c2']);
  assert.equal(identityModeOf({ identityMode: 'otra' as never }), 'legacy');
  assert.equal(identityModeOf(undefined), 'legacy');
});

const product = (id: string, data: Partial<StoredMasterProduct>) => ({ id, data: { clientId: 'c', values: {}, variants: [], marketplaces: {}, revision: 1, updatedAt: 0, updatedByUid: 'u', ...data } as StoredMasterProduct });
test('vínculo con el catálogo maestro: crea, vincula una única ficha o deja incidencia', () => {
  const black = bySkc('CAM001-N');
  assert.deepEqual(chooseBindingTarget('CAM001', black, []), { action: 'create' });
  const bySpu = product('p1', { variants: [{ id: 'v', values: { spu: 'CAM001', color: 'Negro' } }] });
  assert.deepEqual(chooseBindingTarget('CAM001', black, [bySpu]), { action: 'link', productId: 'p1' });
  const bySku = product('p2', { variants: [{ id: 'v', values: { sku: 'CAM001-N-S', color: 'Black' } }] });
  assert.deepEqual(chooseBindingTarget('cam001', black, [bySku]), { action: 'link', productId: 'p2' });
  const multiple = chooseBindingTarget('CAM001', black, [bySpu, bySku]);
  assert.equal(multiple.action, 'issue');
  const contradiction = chooseBindingTarget('CAM001', black, [product('p3', { variants: [{ id: 'v', values: { skc: 'CAM001-N', color: 'Blanco' } }] })]);
  assert.equal(contradiction.action, 'issue');
  // Name or prefix similarity alone never links.
  assert.deepEqual(chooseBindingTarget('CAM001', black, [product('p4', { values: { name: 'Camisa Oxford' }, variants: [{ id: 'v', values: { sku: 'CAM0010-N-U' } }] })]), { action: 'create' });
  assert.deepEqual(chooseBindingTarget('CAM001', black, [product('p5', { catalog: { redirectTo: 'p1' } as never, variants: [{ id: 'v', values: { spu: 'CAM001' } }] })]), { action: 'create' });
  assert.equal(baseAliasId('cam001'), baseAliasId('CAM001'));
  assert.match(baseAliasId('CAM001'), /^organizer-base-[0-9a-f]{40}$/);
});

test('ficha borrador desde el organizador conserva procedencia y el código como referencia externa', () => {
  const draft = organizerDraftProduct('c', 'CAM001', 'base', { variants: [{ id: 'x', values: { skc: 'CAM001-N', color: 'Negro' } }], origins: {}, values: { name: 'Camisa Oxford' }, issue: null });
  assert.equal(draft.catalog!.status, 'draft');
  assert.equal(draft.variants[0].values.spu, 'CAM001');
  assert.equal(draft.catalog!.evidence.name.source, 'drive');
  assert.equal(draft.catalog!.attributes.organizerBaseCode, 'CAM001');
  assert.equal(draft.updatedByUid, 'organizer-binding');
});

test('mapa de variantes por SKU/SKC exacto; lo demás se agrega sin fusionar', () => {
  const map = mapVariantsByCode([
    { id: 's1', values: { sku: 'cam001-n-s' } }, { id: 's2', values: { skc: 'CAM001-B' } }, { id: 's3', values: {} },
  ], [{ id: 't1', values: { sku: 'CAM001-N-S' } }, { id: 't2', values: { skc: 'CAM001-B' } }, { id: 't3', values: { skc: 'CAM001-B' } }]);
  assert.deepEqual(map, { s1: 't1' });
});
