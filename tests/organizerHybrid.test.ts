import assert from 'node:assert/strict';
import { test } from 'node:test';
import { associatePhotos, associationIndex, groupProductRows, parseTab, productVariant } from '../functions/lib/functions/src/organizer/catalog.js';
import { parseInterpretation, rankCandidates, visualAssociation } from '../functions/lib/functions/src/organizer/interpretation.js';
import { photoDecisionKey, planFile, stableDestination } from '../functions/lib/functions/src/organizer/planning.js';
import { assertInputLimit, pixelKey } from '../functions/lib/functions/src/organizer/vision.js';
import type { OrganizerPhoto, OrganizerVariant } from '../shared/src/types';
import type { DriveEntry } from '../functions/src/organizer/drive';

const file = { id: 'catalog', name: 'Productos.xlsx' };
const catalog = (grid: string[][]) => {
  const { rows } = parseTab(file, 'Productos', null, grid);
  const { groups, anchors } = groupProductRows(rows);
  return [...groups].map(([id, rows]) => productVariant(id, rows, undefined, anchors.get(id)));
};
const entry = (name: string, folder: string): DriveEntry => ({ id: name, name, mimeType: 'image/jpeg', path: ['Origen', folder, name], parents: [folder], sourceId: 'origin', version: '1', md5Checksum: name });
const photo = (name: string, folder: string, variants: OrganizerVariant[]): OrganizerPhoto => {
  const source = entry(name, folder);
  const result = associatePhotos([source], associationIndex(variants), new Map()).get(name)!;
  return { ...source, ...result, sourceUrl: '', copyUrl: null, reviewedBy: null, view: null };
};

test('conserva códigos alfabéticos y continuaciones sin rellenar separadores ni estados', () => {
  const { rows, tab } = parseTab(file, 'Navidad', null, [
    ['SKC', 'Nombre', 'Color', 'Talla', 'Upload'], ['CN-B', 'Gorro navideño', 'Blanco', 'CH', 'OK'],
    ['', '', 'Rojo', 'M', ''], ['', '', 'Verde', 'G', ''], [], ['', '', 'Azul', 'M', ''], ['CN-R', 'Otro gorro', 'Rojo'],
  ]);
  assert.equal(rows.length, 4); assert.equal(tab.skipped, 1);
  assert.equal(rows[1].skc, 'CN-B'); assert.equal(rows[1].upload, '');
  assert.deepEqual(rows[1].inferred?.find(item => item.field === 'skc'), { field: 'skc', fromLine: 2, reason: 'Continuación de variante contigua' });
  assert.equal(rows[1].cells.some(cell => cell.field === 'skc'), false);
});

test('lee combinadas únicamente dentro del rango y registra enlaces sin añadir fuentes', () => {
  const { rows, tab } = parseTab(file, 'Datos', null, [
    ['SKU', 'Nombre', 'Color'], ['CN-B', 'Gorro', 'Blanco'], ['', 'Gorro rojo', 'Rojo'], ['', 'Título suelto'],
    ['https://drive.google.com/drive/folders/extra-folder'],
  ], 0, 0, (r, c) => r === 2 && c === 0 ? '' : [['SKU', 'Nombre', 'Color'], ['CN-B', 'Gorro', 'Blanco'], ['', 'Gorro rojo', 'Rojo']][r]?.[c] || '',
  [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]);
  assert.equal(rows.length, 2); assert.equal(rows[1].sku, 'CN-B');
  assert.equal(rows[1].inferred?.[0].reason, 'Celda combinada');
  assert.equal(tab.links?.[0].sourceId, 'extra-folder');
});

test('secuencias, extensiones pegadas y marketplace no crean SKC ni bloquean rutas inequívocas', () => {
  const variants = catalog([['SKC', 'Nombre', 'Color'], ['A021', 'Dardos'], ['A091-PACK6', 'Vasos bambú'], ['A159-RO', 'Pesa rosa', 'Rosa']]);
  assert.equal(photo('A021-4.webp', 'A021 DARDOS', variants).variantId, variants.find(v => v.base === 'A021')!.id);
  assert.equal(photo('A091-2.jpg', 'COCINA', variants).variantId, variants.find(v => v.base === 'A091')!.id);
  assert.equal(photo('A159-ROpng', 'DEPORTE', variants).variantId, variants.find(v => v.base === 'A159')!.id);
  assert.equal(photo('B0MARKETPLACE88.jpg', 'A021 DARDOS', variants).variantId, variants.find(v => v.base === 'A021')!.id);
  assert.equal(variants.length, 3);
});

test('recupera candidatos por relevancia entre más de 32 y resuelve conflicto con evidencia visual', () => {
  const variants = catalog([['SKC', 'Nombre'], ['A137', 'Pieza decorativa'], ...Array.from({ length: 32 }, (_, i) => [`X${i}`, `Artículo ${i}`]), ['A174', 'Prensa Francesa 1L']]);
  const target = photo('A137 (40).png', 'A174 CAFETERA', variants);
  target.candidates = variants.map(v => v.id);
  assert.equal(target.variantId, null);
  const observation = { kind: 'product' as const, label: 'Prensa francesa de vidrio de 1L', color: '', pack: '', photos: [] };
  const match = visualAssociation(target, variants, observation);
  assert.equal(match.ranked[0].id, variants.find(v => v.base === 'A174')!.id);
  assert.equal(match.variantId, match.ranked[0].id);
  assert.equal(visualAssociation(target, variants, { ...observation, label: 'producto', photos: [] }).variantId, null);
  assert.equal(rankCandidates(target, variants).length, variants.length);
});

test('una foto compartida conserva varios vínculos y no se convierte en referencia por identidad', () => {
  const variants = catalog([['SKC', 'Nombre', 'Pack'], ['A216-PACK4', 'Vaso 400 ML', '4'], ['A217-PACK6', 'Vaso 380 ML', '6']]);
  const shared = photo('A216 Y A217.jpg', 'COCINA', variants);
  assert.equal(shared.variantId, null); assert.equal(shared.identityState, 'shared'); assert.equal(shared.variantIds?.length, 2);
  assert.deepEqual(stableDestination(shared, variants, 'Fuentes'), ['Fuentes']);
  assert.equal(variants.every(v => v.referenceState === 'pending'), true);
});

test('tallas comerciales, capacidades y packs permanecen separados de la aprobación', () => {
  const variants = catalog([['SKC', 'Nombre', 'Color', 'Talla', 'Pack', 'Capacidad'],
    ['CN-B-CH', 'Camiseta', 'Blanco', 'CH'], ['CN-B-G', 'Camiseta', 'Blanco', 'G'],
    ['BOT', 'Botella', '', '', '1', '500 ML'], ['BOT', 'Botella', '', '', '1', '1 L'], ['BOT-PACK2', 'Botella', '', '', '2', '1 L']]);
  assert.equal(variants.length, 4);
  assert.deepEqual(variants.find(v => v.base === 'CN')!.sizes, ['CH', 'G']);
  assert.equal(variants.filter(v => v.base === 'BOT').length, 3);
});

test('cache de píxeles ignora Excel, ruta e ID; decisiones y aprobaciones sí invalidan contexto relevante', () => {
  const source = entry('foto.jpg', 'Producto');
  const duplicate = { ...source, id: 'otro', path: ['otra ruta'], version: '99' };
  const variants = catalog([['SKC', 'Nombre'], ['ALFA', 'Prensa Francesa']]);
  const updated = { ...variants[0], catalogFingerprint: 'changed' };
  assert.equal(pixelKey(source, 'model'), pixelKey(duplicate, 'model'));
  assert.notEqual(pixelKey(source, 'model'), pixelKey({ ...source, md5Checksum: 'new-image' }, 'model'));
  assert.notEqual(photoDecisionKey(source, variants), photoDecisionKey(source, [updated]));
  const pending = photo('foto.jpg', 'ALFA', variants);
  const oldPath = stableDestination(pending, variants, 'Fuentes');
  variants[0].status = 'uploaded'; assert.deepEqual(stableDestination(pending, variants, 'Fuentes'), oldPath);
  assert.equal(planFile(source, pending, variants, 'Fuentes', { copiedId: 'old-copy' }).action, 'retain_legacy');
  assert.throws(() => assertInputLimit('x'.repeat(17000)), /Contexto demasiado grande/);
});

test('rechaza interpretaciones sin evidencia y mapeos que inventan campos o relaciones', () => {
  const parsed = parseTab(file, 'Datos', null, [['ref externa', 'texto'], ['ABC', 'Cosa']]);
  const result = parseInterpretation({ resolved: true, folders: [{ fileId: 'inventado', role: 'product', evidence: ['inventado'] }],
    columns: [{ tabId: parsed.tab.id, headerRow: 1, fields: ['sku', 'ejecuta_codigo'], evidence: [parsed.tab.id] }],
    relationships: [{ variantIds: ['inventado', 'otro'], kind: 'shared', evidence: [parsed.tab.id] }] }, [], [parsed.tab], []);
  assert.equal(result.resolved, false); assert.deepEqual(result.columns, []); assert.deepEqual(result.relationships, []);
});

test('benchmark supervisado mide aciertos, errores y pendientes sin premiar asignaciones falsas', () => {
  const variants = catalog([['SKU', 'Nombre'], ['ALFA', 'Prensa Francesa'], ['BETA', 'Termo Acero']]);
  const fixtures = [
    { name: 'ALFA.jpg', folder: 'Fotos', expected: 'ALFA' },
    { name: '1.jpg', folder: 'BETA', expected: 'BETA' },
    { name: 'foto.jpg', folder: 'COCINA', expected: 'ALFA' },
    { name: 'ALFA.jpg', folder: 'BETA', expected: 'BETA' },
  ];
  const metrics = { correct: 0, incorrect: 0, pending: 0, costUsd: 0 };
  for (const fixture of fixtures) {
    const actual = photo(fixture.name, fixture.folder, variants);
    if (!actual.variantId) metrics.pending++;
    else if (variants.find(v => v.id === actual.variantId)?.visual === fixture.expected) metrics.correct++;
    else metrics.incorrect++;
  }
  assert.deepEqual(metrics, { correct: 2, incorrect: 0, pending: 2, costUsd: 0 });
});
