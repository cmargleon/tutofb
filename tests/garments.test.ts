import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCompositeLayout, groupGarmentFiles } from '../src/features/generate/garments';

const makeFile = (overrides: Partial<{ name: string; type: string; size: number; lastModified: number; webkitRelativePath: string }> = {}) => ({
  name: overrides.name || 'image.jpg',
  type: overrides.type || 'image/jpeg',
  size: overrides.size || 100,
  lastModified: overrides.lastModified || 1,
  webkitRelativePath: overrides.webkitRelativePath || '',
});

test('groupGarmentFiles trata archivos individuales como prendas individuales', () => {
  const groups = groupGarmentFiles([
    makeFile({ name: 'uno.jpg' }),
    makeFile({ name: 'dos.jpg', lastModified: 2 }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].sourceType, 'single');
  assert.equal(groups[1].sourceType, 'single');
});

test('groupGarmentFiles trata una carpeta raiz con imagenes sueltas como una sola prenda multiangulo', () => {
  const groups = groupGarmentFiles([
    makeFile({ name: 'front.jpg', webkitRelativePath: 'Vestido/front.jpg' }),
    makeFile({ name: 'back.jpg', webkitRelativePath: 'Vestido/back.jpg', lastModified: 2 }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'Vestido');
  assert.equal(groups[0].sourceType, 'folder-root');
  assert.equal(groups[0].files.length, 2);
});

test('groupGarmentFiles separa subcarpetas y convierte raiz en prendas individuales cuando existen ambas', () => {
  const groups = groupGarmentFiles([
    makeFile({ name: 'root.jpg', webkitRelativePath: 'Lote/root.jpg' }),
    makeFile({ name: 'front.jpg', webkitRelativePath: 'Lote/Camisa/front.jpg', lastModified: 2 }),
    makeFile({ name: 'back.jpg', webkitRelativePath: 'Lote/Camisa/back.jpg', lastModified: 3 }),
    makeFile({ name: 'look.jpg', webkitRelativePath: 'Lote/Pantalon/look.jpg', lastModified: 4 }),
  ]);

  assert.equal(groups.length, 3);
  assert.equal(groups.find((group) => group.name === 'root')?.files.length, 1);
  assert.equal(groups.find((group) => group.name === 'Camisa')?.files.length, 2);
  assert.equal(groups.find((group) => group.name === 'Pantalon')?.files.length, 1);
});

test('groupGarmentFiles deduplica archivos repetidos y resuelve colisiones de nombre', () => {
  const groups = groupGarmentFiles(
    [
      makeFile({ name: 'producto.jpg' }),
      makeFile({ name: 'producto.jpg' }),
      makeFile({ name: 'producto.jpg', lastModified: 2 }),
    ],
    ['producto'],
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'producto (2)');
  assert.equal(groups[1].name, 'producto (3)');
});

test('calculateCompositeLayout mantiene alto 1024 y gap 8', () => {
  const layout = calculateCompositeLayout([
    { width: 1000, height: 2000 },
    { width: 500, height: 1000 },
  ]);

  assert.equal(layout.targetHeight, 1024);
  assert.equal(layout.gap, 8);
  assert.deepEqual(layout.scaledWidths, [512, 512]);
  assert.equal(layout.totalWidth, 1032);
});
