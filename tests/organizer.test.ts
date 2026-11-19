import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const xlsx: typeof import('../functions/node_modules/xlsx') = requireFunctions('xlsx');
import { associatePhotos, associationIndex, groupProductRows, parseTab, productVariant, readWorkbook } from '../functions/lib/functions/src/organizer/catalog.js';
import { digest, FOLDER, OrganizerDrive, SHEET } from '../functions/lib/functions/src/organizer/drive.js';
import type { DriveEntry, DriveFile } from '../functions/src/organizer/drive';
import { availableBudget, holdFor, parseVision, usageCost } from '../functions/lib/functions/src/organizer/vision.js';

const source = { id: 'book', name: 'Catálogo', mimeType: SHEET };
const model = 'gemini-3.1-flash-lite';
const media = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('lee Sheets con pestañas heterogéneas, cruza SKU y SKC inequívocos y mantiene las celdas de origen', async () => {
  const values: Record<string, string[][]> = {
    Portada: [['Catálogo de ejemplo']],
    'Ropa 2026': [[], ['Color', 'Código SKC', 'SKU', 'Talla', 'FOTO IA', 'UPLOAD'], ['Negro', 'A218-N-CH', 'A2181', 'CH', 'OK', 'OK']],
    "Control d'exportación": [['SKU', 'Observaciones', 'SUBIDA', 'PUBLICAR'], ['A2181', 'Cambiar foto', 'Pendiente', 'NO']],
    Vacía: [],
  };
  const reader = {
    tabs: async () => Object.keys(values).map((title, sheetId) => ({ title, sheetId, sheetType: 'GRID' })),
    tabValues: async (_: string, tab: string) => values[tab],
    tabOriginalValues: async (_: string, tab: string) => tab === 'Ropa 2026'
      ? [[], values[tab][1], ['Negro', 'A218-N-CH', 'A2181', 'CH', '=IF(TRUE,"OK","")', 'OK']] : values[tab],
    sourceWorkbook: async () => { throw new Error('No debe exportar el Google Sheet a XLSX'); },
  };
  const imported = [];
  for await (const item of readWorkbook(reader, source)) imported.push(item);
  assert.deepEqual(imported.map(item => [item.tab.name, item.tab.tabId, item.tab.imported]), [
    ['Portada', 0, 0], ['Ropa 2026', 1, 1], ["Control d'exportación", 2, 1], ['Vacía', 3, 0],
  ]);
  const rows = imported.flatMap(item => item.rows);
  assert.deepEqual(rows[0].cells[1], { column: 'B', header: 'Código SKC', value: 'A218-N-CH', originalValue: 'A218-N-CH', field: 'skc' });
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].cells.find(cell => cell.field === 'photo')?.originalValue, '=IF(TRUE,"OK","")');
  assert.equal(rows[1].skc, '');
  const { groups, anchors } = groupProductRows(rows);
  assert.equal(groups.size, 1);
  const [id, matches] = [...groups][0];
  const variant = productVariant(id, matches, undefined, anchors.get(id));
  assert.deepEqual(variant.skcs, ['A218-N-CH']);
  assert.deepEqual(variant.skus, ['A2181']);
  assert.equal(variant.status, 'review');
  assert.ok(variant.issues.some(issue => issue.includes('Cambiar foto')));
  assert.ok(variant.issues.some(issue => issue.includes('upload')));
});

test('Excel conserva offsets de fila y columna y procesa todas las pestañas', async () => {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.sheet_add_aoa({}, [['SKC', 'Color'], ['A218', 'Rojo']], { origin: 'C4' });
  sheet['!ref'] = 'C4:D5';
  xlsx.utils.book_append_sheet(workbook, sheet, 'Objetos');
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([['SKU'], ['B910']]), 'Otros');
  const reader = { tabs: async () => [], tabValues: async () => [], tabOriginalValues: async () => [], sourceWorkbook: async () => xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer };
  const imported = [];
  for await (const item of readWorkbook(reader, { ...source, mimeType: media })) imported.push(item);
  assert.deepEqual(imported.map(item => [item.tab.name, item.tab.headerRow]), [['Objetos', 4], ['Otros', 1]]);
  assert.equal(imported[0].rows[0].line, 5);
  assert.deepEqual(imported[0].rows[0].cells.map(cell => cell.column), ['C', 'D']);
});

test('respeta fotos hermanas, conflictos, duplicados y decisiones manuales', () => {
  const { rows } = parseTab(source, 'Productos', 0, [
    ['SKC', 'Color', 'Talla', 'Pack'], ['A218-N-CH', 'Negro', 'CH'], ['A218-N-G', 'Negro', 'G'],
    ['A218-A', 'Azul'], ['B220', 'Rojo', '', '4'], ['A218-R', 'Rojo'],
  ]);
  const { groups, anchors } = groupProductRows(rows);
  const variants = [...groups].map(([id, entries]) => productVariant(id, entries, undefined, anchors.get(id)));
  const index = associationIndex(variants);
  const image = (id: string, name: string, parent: string, hash?: string) => ({ id, name, path: ['Origen', parent, name], parents: [parent], sha256Checksum: hash });
  const result = associatePhotos([
    image('one', 'A218-N-CH.jpg', 'Lote A', 'h1'), image('two', '1.jpg', 'Lote A'), image('three', '1.jpg', 'Fotos', 'h1'),
    image('four', 'A218-A.jpg', 'Mezcla'), image('five', 'B220.jpg', 'Mezcla'), image('six', '1.jpg', 'Mezcla'),
    image('seven', '1.jpg', 'Cocina'), image('eight', 'A218-R.jpg', 'Ropa'), image('nine', '1.jpg', 'Ropa'),
  ], index, new Map([['seven', null]]));
  assert.equal(variants.length, 4);
  assert.equal(result.get('two')?.method, 'fotos_hermanas');
  assert.equal(result.get('three')?.variantId, null);
  assert.equal(result.get('three')?.duplicateOf, 'one');
  assert.equal(result.get('six')?.issue, 'Conflicto de identidad');
  assert.equal(result.get('seven')?.method, 'manual');
  assert.equal(result.get('seven')?.variantId, null);
  assert.equal(result.get('nine')?.variantId, null);
  assert.equal(result.get('nine')?.issue, 'Carpeta general con fotos sin identificador');
});

test('Drive solo lee originales y verifica versión, pertenencia y checksums sin métodos de escritura', async () => {
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('original');
  let media = bytes;
  const original: DriveEntry = { id: 'photo', name: 'A218.jpg', mimeType: 'image/jpeg', parents: ['origin'],
    sourceId: 'origin', path: ['Origen', 'A218.jpg'], version: '1',
    md5Checksum: createHash('md5').update(bytes).digest('hex'), sha256Checksum: createHash('sha256').update(bytes).digest('hex') };
  const files = new Map<string, DriveFile>([['origin', { id: 'origin', name: 'Origen', mimeType: FOLDER }], ['photo', original]]);
  const requests: string[] = [];
  const drive = new OrganizerDrive(async () => 'readonly-token', async (request, init) => {
    assert.equal(init?.method ?? 'GET', 'GET', 'Falla ante POST, PATCH o DELETE a Drive');
    const url = new URL(String(request)); requests.push(url.pathname);
    if (url.searchParams.get('alt') === 'media') return new Response(media);
    if (url.pathname.endsWith('/files')) return Response.json({ files: [original] });
    return Response.json(files.get(url.pathname.split('/').at(-1)!));
  });
  assert.deepEqual(await drive.originals(['origin']), [files.get('origin')]);
  assert.deepEqual((await drive.children(files.get('origin')!)).files, [original]);
  assert.deepEqual(await drive.sourceImage(original), bytes);
  for (const method of ['zone', 'root', 'managed', 'copy', 'verifyCopy', 'moveCopy', 'report']) assert.equal(method in drive, false);
  files.set('photo', { ...original, version: '2' });
  await assert.rejects(() => drive.sourceImage(original), /origen cambió/);
  files.set('photo', { ...original, parents: ['foreign'] });
  files.set('foreign', { id: 'foreign', name: 'Ajeno', mimeType: FOLDER });
  await assert.rejects(() => drive.sourceImage(original), /salió de su zona/);
  files.set('photo', { ...original, md5Checksum: 'changed' });
  await assert.rejects(() => drive.sourceImage(original), /origen cambió/);
  files.set('photo', original);
  await assert.rejects(() => drive.sourceImage({ ...original, md5Checksum: 'wrong' }), /origen cambió/);
  media = Buffer.from('changed during download');
  await assert.rejects(() => drive.sourceImage(original), /contenido del original no coincide/);
  assert.ok(requests.length > 5);
});

test('las tarifas incluyen razonamiento y solo el costo reconciliado reduce el presupuesto confirmado', () => {
  assert.ok(holdFor(model) > usageCost(model, 600, 200, 50));
  assert.equal(usageCost(model, 600, 200, 50), 525);
  assert.equal(availableBudget({ budgetUsd: 40, estimatedUsd: .003, reservedUsd: .05, uncertainUsd: .01 }), 39_937_000);
});

test('Drive verifica cada pertenencia cuando files.get omite padres y rechaza un ancestro inventado', async () => {
  const items: Record<string, DriveFile> = {
    origin: { id: 'origin', name: 'Origen', mimeType: FOLDER },
    group: { id: 'group', name: 'Producto', mimeType: FOLDER },
    photo: { id: 'photo', name: 'foto.jpg', mimeType: 'image/jpeg', version: '1' },
  };
  const drive = new OrganizerDrive(async () => 'fake', async request => {
    const url = new URL(String(request)); const resource = url.pathname.split('/').at(-1)!;
    if (resource === 'files') {
      const parent = url.searchParams.get('q')?.match(/^'([^']+)'/)?.[1];
      return Response.json({ files: parent === 'origin' ? [items.group] : parent === 'group' ? [items.photo] : [] });
    }
    return Response.json(items[resource] || { id: resource, name: resource, mimeType: FOLDER });
  });
  const file: DriveEntry = { ...items.photo, path: ['Origen', 'Producto', 'foto.jpg'], sourceId: 'origin', ancestorIds: ['origin', 'group'] };
  assert.equal((await drive.assertSource(file)).id, 'photo');
  await assert.rejects(() => drive.assertSource({ ...file, ancestorIds: ['origin', 'inventado'] }), /salió de su zona/);
  await assert.rejects(() => drive.assertSource({ ...file, version: '2' }), /salió de su zona/);
});

test('valida la clasificación visual y descarta SKC inventados e IDs que no se enviaron', () => {
  assert.throws(() => parseVision({ photos: [] }, ['photo'], []), /identificadores/);
  const result = parseVision({ kind: 'garment', photos: [
    { id: 'photo', view: 'back', confidence: .85, quality: .82, variantId: 'inventado' },
    { id: 'missing', view: 'front', confidence: 1, quality: 1, variantId: 'other' },
  ] }, ['photo'], ['other']);
  assert.deepEqual(result.photos, [{ id: 'photo', view: 'back', confidence: .85, quality: .82, variantId: null }]);
});
