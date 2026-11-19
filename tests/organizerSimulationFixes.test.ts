import assert from 'node:assert/strict';
import { test } from 'node:test';
import { associatePhotos, associationIndex, candidatesIn, groupProductRows, parseTab, productVariant } from '../functions/lib/functions/src/organizer/catalog.js';
import { groupGenerationSources, type GenerationSource } from '../functions/lib/functions/src/organizer/automation.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isFirestoreContentionError, withContentionRetry } = require('../functions/lib/functions/src/automation/budget.js') as {
  isFirestoreContentionError: (error: unknown) => boolean;
  withContentionRetry: <T>(run: () => Promise<T>, options?: { attempts?: number; baseMs?: number; maxMs?: number; wait?: (ms: number) => Promise<unknown>; random?: () => number }) => Promise<T>;
};
const { buildJobFailureInfo } = require('../functions/lib/functions/src/errors/jobFailure.js') as {
  buildJobFailureInfo: (error: unknown) => { reasonCode: string; retryable: boolean };
};

// Regressions from the "SIMULACION ROPA 2026-11-19" organizer run (client automation-e2e-test).
const sheet = { id: 'catalog', name: 'CATALOGO-ROPA-SIMULACION.xlsx' };
const { rows } = parseTab(sheet, 'ROPA ADULTO', 0, [
  ['SKC', 'SKU', 'SPU', 'COLOR', 'TALLA'],
  ['SR-02-AZR', 'SR-02-AZR-M', 'SR-02', 'Azul royal', 'M'],
  ['SR-06-CAF', 'SR-06-CAF-M', 'SR-06', 'Café', 'M'],
  ['SR-06-ROJ', 'SR-06-ROJ-M', 'SR-06', 'Rojo', 'M'],
  ['SR-09-AZU', 'SR-09-AZU-S', 'SR-09', 'Azul', 'S'],
  ['SR-09-AZU', 'SR-09-AZU-M', 'SR-09', 'Azul', 'M'],
  ['SR-10-NEG', 'SR-10-NEG-M', 'SR-10', 'Negro', 'M'],
  ['A021', 'A021', 'A021', 'Blanco', ''],
  ['A159-RO', 'A159-RO', 'A159', 'Rosa', ''],
  ['AT-R01-TER', 'AT-R01-TER-M', 'AT-R01', 'Terracota', 'M'],
]);
const { groups, anchors } = groupProductRows(rows);
const variants = [...groups].map(([id, entries]) => productVariant(id, entries, undefined, anchors.get(id)));
const index = associationIndex(variants);
const idOf = (skc: string) => variants.find(variant => variant.skcs.includes(skc))!.id;

test('códigos explícitos: prefijo más largo, palabras de vista, "sr 06" y desempate por color', () => {
  assert.deepEqual(candidatesIn('SR-02-AZR-FRENTE.jpg', index), [idOf('SR-02-AZR')]);
  assert.deepEqual(candidatesIn('SR-02-AZR-DETRAS.jpg', index), [idOf('SR-02-AZR')]);
  assert.deepEqual(candidatesIn('SR-09-AZU-M-DETRAS.jpg', index), [idOf('SR-09-AZU')]);
  assert.deepEqual(candidatesIn('SR-09-AZU-M-FRENTE.jpg', index), [idOf('SR-09-AZU')]);
  assert.deepEqual(candidatesIn('sr 06 cafe frente.png', index), [idOf('SR-06-CAF')]);
  assert.deepEqual(candidatesIn('sr 06 cafe espalda.png', index), [idOf('SR-06-CAF')]);
  assert.deepEqual(candidatesIn('sr 06 rojo.png', index), [idOf('SR-06-ROJ')]);
  assert.equal(candidatesIn('sr 06.png', index).length, 2, 'Sin color sigue siendo conflicto del SPU');
  assert.deepEqual(candidatesIn('SR-10-NEG.webp', index), [idOf('SR-10-NEG')]);
  assert.deepEqual(candidatesIn('A021-4.jpg', index), [idOf('A021')]);
  assert.deepEqual(candidatesIn('A159-ROpng.jpg', index), [idOf('A159-RO')]);
  assert.deepEqual(candidatesIn('AT-R01-TER-DETRAS.png', index), [idOf('AT-R01-TER')]);
  assert.deepEqual(candidatesIn('IMG_5102.jpg', index), []);
});

test('associatePhotos asigna variante a fotos sueltas en la raíz con vista en el nombre', () => {
  const photo = (id: string, name: string) => ({ id, name, path: ['Origen', 'SIMULACION ROPA 2026-11-19', name], parents: ['sim'] });
  const result = associatePhotos([
    photo('a', 'SR-02-AZR-FRENTE.jpg'), photo('b', 'SR-02-AZR-DETRAS.jpg'), photo('c', 'SR-09-AZU-M-FRENTE.jpg'), photo('d', 'SR-09-AZU-M-DETRAS.jpg'),
    photo('e', 'sr 06 cafe frente.png'), photo('f', 'sr 06 cafe espalda.png'), photo('g', 'SR-10-NEG.webp'), photo('h', 'IMG_5102.jpg'),
  ], index, new Map());
  assert.equal(result.get('a')?.variantId, idOf('SR-02-AZR'));
  assert.equal(result.get('b')?.variantId, idOf('SR-02-AZR'));
  assert.equal(result.get('c')?.variantId, idOf('SR-09-AZU'));
  assert.equal(result.get('d')?.variantId, idOf('SR-09-AZU'));
  assert.equal(result.get('e')?.variantId, idOf('SR-06-CAF'));
  assert.equal(result.get('f')?.variantId, idOf('SR-06-CAF'));
  assert.equal(result.get('a')?.method, 'codigo_archivo');
  assert.equal(result.get('g')?.variantId, idOf('SR-10-NEG'));
  assert.equal(result.get('h')?.variantId, null);
});

const source = (name: string, options: Partial<GenerationSource['photo']> = {}, parent = 'sim'): GenerationSource => ({
  entry: { id: name, name, mimeType: 'image/jpeg', parents: [parent], path: ['Origen', 'Sim', name], sourceId: 'origin', version: '1', md5Checksum: name },
  photo: { id: name, name, path: ['Origen', 'Sim', name], sourceUrl: '', copyUrl: null, variantId: null, candidates: [], method: 'pendiente', evidence: [],
    confidence: 0, issue: 'Sin identificación', duplicateOf: null, reviewedBy: null, view: 'front', kind: 'garment', quality: 0.9, visualConfidence: 0.95,
    visualHint: { groupId: `visual-${name}`, label: name, color: 'Marrón', pack: '', kind: 'garment' }, ...options },
});
const names = (result: ReturnType<typeof groupGenerationSources>) => result.map(group => group.photos.map(({ entry }) => entry.name).sort()).sort();

test('agrupado sin variante: el par frente/espalda queda en un solo artículo aunque Gemini lo separe', () => {
  const result = groupGenerationSources([
    source('X-77-FRENTE.jpg'), source('X-77-DETRAS.jpg', { view: 'back' }),
    source('remera lisa frente.png', { visualHint: { groupId: 'g1', label: 'remera', color: 'Azul', pack: '', kind: 'garment' } }),
    source('remera lisa espalda.png', { view: 'back', visualHint: { groupId: 'g2', label: 'remera', color: 'Azul', pack: '', kind: 'garment' } }),
    source('X-77-FRENTE.jpg', {}, 'other-folder'),
  ]);
  assert.deepEqual(names(result), [['X-77-DETRAS.jpg', 'X-77-FRENTE.jpg'], ['X-77-FRENTE.jpg'], ['remera lisa espalda.png', 'remera lisa frente.png']]);
});

test('agrupado sin variante: fotos de cámara consecutivas y espalda huérfana con el único frente compatible', () => {
  const tieDye = { color: 'Multicolor', pack: '', kind: 'garment', label: 'sudadera tie-dye' };
  const consecutive = groupGenerationSources([
    source('IMG_5102.jpg', { visualHint: { groupId: 'a', ...tieDye } }),
    source('IMG_5103.jpg', { view: 'back', visualHint: { groupId: 'b', ...tieDye } }),
    source('IMG_5104.jpg', { visualHint: { groupId: 'c', ...tieDye, color: 'Negro' } }),
    source('IMG_5200.jpg', { view: 'back', visualHint: { groupId: 'd', ...tieDye } }),
  ]);
  assert.deepEqual(names(consecutive), [['IMG_5102.jpg', 'IMG_5103.jpg'], ['IMG_5104.jpg'], ['IMG_5200.jpg']]);

  const orphan = groupGenerationSources([
    source('polo.jpg', { visualHint: { groupId: 'p1', label: 'polo', color: 'Verde', pack: '', kind: 'garment' } }),
    source('otro.jpg', { view: 'back', visualHint: { groupId: 'p2', label: 'polo verde', color: 'verde', pack: '', kind: 'garment' } }),
  ]);
  assert.deepEqual(names(orphan), [['otro.jpg', 'polo.jpg']]);
  const ambiguous = groupGenerationSources([
    source('a.jpg', { visualHint: { groupId: 'p1', label: 'polo', color: 'Verde', pack: '', kind: 'garment' } }),
    source('b.jpg', { visualHint: { groupId: 'p3', label: 'remera', color: 'Verde', pack: '', kind: 'garment' } }),
    source('c.jpg', { view: 'back', visualHint: { groupId: 'p2', label: 'polo', color: 'Verde', pack: '', kind: 'garment' } }),
  ]);
  assert.equal(ambiguous.length, 3, 'Con dos frentes posibles no adivina');
  const coded = groupGenerationSources([source('a.jpg', { variantId: 'v1' }), source('b.jpg', { view: 'back' })]);
  assert.equal(coded.length, 2, 'Nunca mezcla una foto sin variante con una variante del Excel');
});

test('contención de Firestore: se reintenta con backoff y no se clasifica como timeout', async () => {
  const aborted = Object.assign(new Error('10 ABORTED: Aborted due to cross-transaction contention. This occurs when multiple transactions attempt to access the same data.'), { code: 10 });
  assert.equal(isFirestoreContentionError(aborted), true);
  assert.equal(isFirestoreContentionError(new Error('Presupuesto insuficiente')), false);
  const info = buildJobFailureInfo(aborted);
  assert.equal(info.reasonCode, 'firestore_contention');
  assert.equal(info.retryable, true);
  assert.equal(buildJobFailureInfo(Object.assign(new Error('aborted'), { name: 'AbortError' })).reasonCode, 'job_timeout');

  let calls = 0;
  const waits: number[] = [];
  assert.equal(await withContentionRetry(async () => { calls++; if (calls < 4) throw aborted; return 'ok'; }, { wait: async (ms) => { waits.push(ms); }, random: () => 1 }), 'ok');
  assert.deepEqual(waits, [400, 800, 1600]);
  await assert.rejects(withContentionRetry(async () => { throw new Error('otro error'); }, { wait: async () => { throw new Error('no espera'); } }), /otro error/);
  await assert.rejects(withContentionRetry(async () => { throw aborted; }, { attempts: 2, wait: async () => undefined }), /ABORTED/);
});

test('reserva concurrente simulada: N reservas con conflictos optimistas nunca superan el límite', async () => {
  // In-memory ledger with optimistic concurrency: a commit on a stale version aborts with gRPC 10, like Firestore.
  const ledger = { version: 0, limitUsd: 1, reservedUsd: 0 };
  const reserve = async (hold: number) => {
    const seen = ledger.version;
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3));
    if (ledger.version !== seen) throw Object.assign(new Error('10 ABORTED: Aborted due to cross-transaction contention'), { code: 10 });
    if (ledger.limitUsd - ledger.reservedUsd + 1e-7 < hold) return false;
    ledger.reservedUsd = Math.round((ledger.reservedUsd + hold) * 1e6) / 1e6;
    ledger.version++;
    return true;
  };
  const results = await Promise.all(Array.from({ length: 40 }, () =>
    withContentionRetry(() => reserve(0.04), { attempts: 200, baseMs: 1, maxMs: 20 })));
  assert.equal(results.filter(Boolean).length, 25);
  assert.equal(ledger.reservedUsd, 1);
});
