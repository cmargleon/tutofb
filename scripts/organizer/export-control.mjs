import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const [directory, runtimeModules] = process.argv.slice(2);
const runtime = createRequire(join(runtimeModules, 'organizer.cjs'));
const { SpreadsheetFile, Workbook } = await import(runtime.resolve('@oai/artifact-tool'));
const tables = JSON.parse(await readFile(join(directory, 'tablas.json'), 'utf8'));
const workbook = Workbook.create();
for (const [title, rows] of Object.entries(tables)) {
  const sheet = workbook.worksheets.add(title);
  const width = rows[0].length;
  const used = sheet.getRangeByIndexes(0, 0, rows.length, width);
  used.values = rows.map(row => row.map(value => typeof value === 'string' && value.startsWith('=') ? "'" + value : value));
  used.format.columnWidthPx = title === 'Resumen' ? 345 : 170;
  const header = sheet.getRangeByIndexes(0, 0, 1, width);
  header.format.fill = '#E6EBF0';
  header.format.font.bold = true;
  header.format.rowHeightPx = 35;
  header.format.wrapText = true;
  sheet.freezePanes.freezeRows(1);
  if (title === 'Resumen') sheet.getRange('B21:B23').setNumberFormat('0.000000');
  const inspectWidth = Math.min(6, width);
  const inspectHeight = Math.min(8, rows.length);
  if (sheet.getRangeByIndexes(0, 0, 1, width).values[0].filter(Boolean).length !== width) {
    throw new Error(`Faltan encabezados en ${title}`);
  }
  const image = await workbook.render({
    sheetName: title, range: `A1:${String.fromCharCode(64 + inspectWidth)}${inspectHeight}`, scale: 1,
  });
  await writeFile(join(directory, `preview-${title}.png`), new Uint8Array(await image.arrayBuffer()), { mode: 0o600 });
}
workbook.recalculate();
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(join(directory, 'control.xlsx'));
