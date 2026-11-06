import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog, copyPlan, type Entry, isWorkbook, PILOT, readWorkbook, requireFunctions } from '../scripts/organizer/catalog.ts';
import { Drive, FOLDER, scan, SHEET, verifyInventory, XLSX, type Metadata } from '../scripts/organizer/drive.ts';
import { newSpend, reserve } from '../scripts/organizer/references.ts';
import { report, sheetRequests, type Prepared } from '../scripts/organizer/report.ts';

const xlsx: typeof import('../functions/node_modules/xlsx') = requireFunctions('xlsx');
const workbook = (sheets: Record<string, string[][]>) => {
  const book = xlsx.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), name);
  return xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const excel: Entry = { id: 'excel', name: 'products.xlsx', path: ['origin', 'products.xlsx'], parentId: 'origin',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const image = (id: string, name: string, ...parents: string[]): Entry => ({
  id, name, mimeType: 'image/png', path: ['origin', ...parents, name], parentId: 'origin', version: '1',
});
const fixture = () => readWorkbook(excel, workbook({
  Ropa: [
    ['Exportación'], [], ['SKC', 'Nombre', 'COLOR', 'TALLA', 'FOTO IA', 'UPLOAD', 'PUBLICAR', 'Comentarios'],
    ['MD3295-N-CH', 'Suéter', 'Negro', 'CH', 'OK', 'OK'],
    ['MD3295-N-G', 'Suéter', 'Negro', 'G', 'OK', 'Pendiente'],
    ['MD3295-V-M', 'Suéter', 'Verde', 'M', 'OK', 'OK', '', 'Cambiar foto'],
    ['MD3295-R-M', 'Suéter', 'Rojo', 'M', 'OK', 'OK'],
    ['MD3295-B-M', 'Suéter', 'Blanco', 'M', 'OK'],
  ],
  Nuevo: [
    ['SKU', 'Nombr', 'Valores de las variantes'],
    ['A216', 'Vaso'], ['A217', 'Copa'], ['A219-A', 'Tienda', 'COLOR: AZUL'],
    ['A222-PACK 2', 'Vasos'], ['A222-PACK 4', 'Vasos'], ['A222-PACK 6', 'Vasos'],
  ],
}));
test('lee varias hojas, descubre encabezados y agrupa tallas verificadas conservando el estado por SKC', () => {
  const { rows, sources } = fixture();
  assert.equal(sources[0].headerLine, 3);
  assert.equal(rows[0].line, 4);
  assert.equal(sources[1].rowsImported, 6);
  const { variants } = catalog([
    image('1', 'MD3295-N-CH.png'), image('2', '1.png', 'MD3295-B-M'), image('3', 'MD3295-R.png'),
  ], rows);
  const get = (visual: string) => variants.find(variant => variant.visual === visual)!;
  assert.deepEqual(get('MD3295-N').skcs, ['MD3295-N-CH', 'MD3295-N-G']);
  assert.equal(get('MD3295-N').status, 'REVISAR');
  assert.equal(get('MD3295-V').status, 'REVISAR');
  assert.equal(get('MD3295-R').status, 'SUBIDOS');
  assert.equal(get('MD3295-R').publish, 'NO REGISTRADO');
  assert.equal(get('MD3295-B').status, 'PENDIENTES');
  assert.equal(get('MD3295-B').photo, 'OK');
  assert.equal(get('MD3295-B').upload, 'NO REGISTRADO');
  assert.equal(get('A219-A').color, 'AZUL');
  assert.deepEqual(variants.filter(variant => variant.base === 'A222').map(variant => variant.pack), ['PACK 2', 'PACK 4', 'PACK 6']);
});
test('importa todas las pestañas de un Google Sheet y conserva sus coordenadas y conflictos', async ({ mock }) => {
  const file: Entry = { ...excel, id: 'native', name: 'Catálogo', mimeType: SHEET };
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['Instrucciones']]), 'Portada');
  const ropa = xlsx.utils.sheet_add_aoa({}, [
    ['Código SKC', 'Upload'], ['A218', 'OK'], [], ['A219', 'OK'],
  ], { origin: 'C4' });
  ropa['!ref'] = 'C4:D7';
  xlsx.utils.book_append_sheet(book, ropa, 'Ropa');
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([
    ['Subida', 'SKU'], ['Pendiente', 'A218'], ['OK', 'A220'],
  ]), 'Control de carga');
  xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([]), 'Vacía');
  const bytes: Buffer = xlsx.write(book, { type: 'buffer', bookType: 'xlsx' });
  const fetch = mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/drive/v3/files/native/export');
    assert.equal(url.searchParams.get('mimeType'), XLSX);
    assert.equal(init?.method ?? 'GET', 'GET');
    return new Response(Uint8Array.from(bytes));
  });

  assert.equal(isWorkbook(file), true);
  const { rows, sources } = readWorkbook(file, await new Drive(async () => 'test-token').download(file));
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(sources.map(source => [source.sheet, source.headerLine, source.rowsImported]), [
    ['Portada', undefined, 0], ['Ropa', 4, 2], ['Control de carga', 1, 2], ['Vacía', undefined, 0],
  ]);
  assert.deepEqual(sources[1].columns, ['C: Código SKC → skc', 'D: Upload → upload']);
  assert.deepEqual(rows.map(row => [row.fileId, row.sheet, row.line, row.firstColumn, row.raw]), [
    ['native', 'Ropa', 5, 'C', ['A218', 'OK']],
    ['native', 'Ropa', 7, 'C', ['A219', 'OK']],
    ['native', 'Control de carga', 2, 'A', ['Pendiente', 'A218']],
    ['native', 'Control de carga', 3, 'A', ['OK', 'A220']],
  ]);
  const variant = catalog([], rows).variants.find(item => item.visual === 'A218');
  assert.equal(variant?.rows.length, 2);
  assert.equal(variant?.upload, 'REVISAR');
  assert.equal(variant?.status, 'REVISAR');
});
test('resuelve vistas por ruta, conserva duplicados, aísla códigos múltiples y protege nombres', () => {
  const files = [
    { ...image('01', '1.png', 'A216'), sha256Checksum: 'same' },
    { ...image('02', '2.png', 'A216'), sha256Checksum: 'same' },
    image('03', '1.png', 'A216'), image('04', 'A216 Y A217.png'), image('05', 'A217.png', 'A216'),
    image('06', 'imagen.png', 'A216 Y A217'), image('07', 'imagen.png'), image('08', 'A219-A.png'),
  ];
  const data = catalog(files, fixture().rows);
  const a = (id: string) => data.associations.find(photo => photo.fileId === id)!;
  assert.equal(a('01').method, 'Código inequívoco en carpeta');
  assert.equal(a('02').duplicateOf, '01');
  for (const id of ['04', '05', '06']) assert.equal(a(id).review, 'CONFLICTO DE SKC');
  assert.equal(a('07').review, 'SIN SKC');
  assert.equal(a('08').selectedCode, 'A219-A');
  const plans = copyPlan([...files, excel], data);
  assert.equal(plans.length, 9);
  assert.match(plans.find(operation => operation.fileId === '03')!.name, /\[03\]/);
  assert.deepEqual(copyPlan([...files, excel], data), plans);
});
test('escanea jerarquía, excluye el piloto y no sigue accesos directos ni padres ajenos', async () => {
  const source: Metadata = { id: PILOT.sourceId, name: 'origin', mimeType: FOLDER };
  const folder: Metadata = { id: 'sub', name: 'A216', mimeType: FOLDER, parents: [source.id] };
  const file: Metadata = { id: 'foto', name: '1.png', mimeType: 'image/png', parents: [folder.id], version: '1' };
  const drive = {
    metadata: async () => source,
    children: async (id: string) => id === source.id ? [folder,
      { ...folder, id: 'pilot', name: PILOT.name },
      { ...folder, id: 'shortcut', mimeType: 'application/vnd.google-apps.shortcut' },
      { ...folder, id: 'otro', parents: ['foreign'] }] : [file],
  };
  const { files } = await scan(drive);
  assert.deepEqual(files.map(entry => entry.id), ['foto', 'shortcut', 'sub']);
  assert.deepEqual(files[0].path, ['origin', 'A216', '1.png']);
  assert.deepEqual(verifyInventory(files, files), { added: [], changed: [] });
  assert.deepEqual(verifyInventory(files, files.slice(1)), { added: [], changed: ['foto'] });
});
test('no rebasa el presupuesto y genera reportes con trazabilidad de copias', () => {
  const spend = newSpend(2);
  for (let call = 0; call < 40; call++) assert.equal(reserve(spend), true);
  assert.equal(reserve(spend), false);
  assert.equal(spend.reservedUsd, 2);
  const files = [image('1', 'A216.png'), excel];
  const input = fixture();
  const result = catalog(files, input.rows);
  const prepared: Prepared = { files, catalog: result, sources: input.sources, copies: copyPlan(files, result), spend, errors: [] };
  const { tables, stats } = report(prepared, [{ sourceFileId: '1', id: 'copy', parentId: 'new', name: 'A216.png',
    url: 'https://drive.google.com/open?id=copy', verified: true }], { changed: [], added: [] });
  assert.equal(stats.copies, 1);
  assert.equal(tables.Fotografías.length, 3);
  assert.ok(sheetRequests(tables, [{ id: 10, title: 'Productos', exists: false }], true).some(request => 'setBasicFilter' in request));
});

test('un posible código en una subcarpeta impide heredar el producto exterior', () => {
  const files = [image('1', '1.png', 'A216', 'A217PACKS'), image('2', 'A216 Y B999.png')];
  const associations = catalog(files, fixture().rows).associations;
  assert.ok(associations.every(photo => photo.review === 'CONFLICTO DE SKC' && !photo.variantId));
});

test('el conector reconcilia una escritura de respuesta incierta y omite operaciones ya registradas', async () => {
  const { copyThroughConnector } = await import('../scripts/organizer/mcp-transport.mjs');
  const file = { ...image('1', 'A216.png'), size: '10' };
  const plan = { files: [file], copies: [{ fileId: '1', name: file.name, directories: ['01 - PENDIENTES'] }] };
  const children = new Map<string, { id: string; name: string; folder?: boolean; mimeType?: string; size?: string; url?: string }[]>();
  let writes = 0;
  const add = (parent: string, value: (typeof children extends Map<string, infer U> ? U : never)[number]) =>
    children.set(parent, [...(children.get(parent) || []), value]);
  const transport = {
    list: async (id: string) => children.get(id) || [],
    createFolder: async (parent: string, name: string) => {
      const id = 'folder-' + ++writes;
      add(parent, { id, name, folder: true });
      return { id };
    },
    copy: async (parent: string, name: string) => {
      writes++;
      add(parent, { id: 'copy', name, size: file.size, mimeType: file.mimeType, url: 'https://drive.google.com/open?id=copy' });
      throw Error('connection closed after commit');
    },
    checkpoint: async () => {},
  };
  const journal = await copyThroughConnector(plan, 'pilot', transport, {});
  assert.equal(journal.receipts.length, 1);
  assert.equal(journal.receipts[0].verified, true);
  await copyThroughConnector(plan, 'pilot', transport, journal);
  assert.equal(writes, 3);
});
