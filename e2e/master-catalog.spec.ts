import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('master catalog pages and searches on the server, creates without marketplace templates, and retains edits on conflict', async () => {
  const isolated = await openIsolatedBrowser(chromium); const { page, baseURL } = isolated;
  try {
    await page.addInitScript(() => { (window as any).__masterCatalogFixture = true; });
    await page.goto(`${baseURL}/catalogo/productos?clientId=local-client`);
    await expect(page.getByRole('heading', { name: 'Catálogo maestro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Camisa 00 Tuto' })).toBeVisible();
    await page.screenshot({ path: '/tmp/tuto-master-catalog-list.png', fullPage: true });
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Camisa 25 Tuto' })).toBeVisible();
    await expect(page.getByText('Página 2', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__localCalls.filter((c: any) => c.name === 'listCatalogProducts').at(-1).input.cursor)).toBe('master-24');
    await page.getByRole('textbox', { name: 'Buscar producto' }).fill('0002');
    await expect(page.getByRole('button', { name: 'Camisa 02 Tuto' })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
    const editor = page.getByRole('region', { name: 'Ficha maestra' });
    await editor.getByRole('textbox', { name: 'Título de venta', exact: false }).fill('Producto sin lote');
    await editor.getByRole('textbox', { name: 'SKU interno', exact: false }).first().fill('0000123');
    await editor.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    await expect(editor.getByRole('heading', { name: 'Producto sin lote' })).toBeVisible();
    await expect(editor.getByText('Ficha canónica · revisión 1')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__localCalls.some((c: any) => /Marketplace|GenerationBatch/.test(c.name)))).toBe(false);
    await page.evaluate(() => { (window as any).__catalogConflict = true; });
    await editor.getByRole('textbox', { name: 'Marca', exact: false }).fill('Corrección pendiente');
    await editor.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('La ficha cambió');
    await expect(editor.getByRole('textbox', { name: 'Marca', exact: false })).toHaveValue('Corrección pendiente');
    await page.screenshot({ path: '/tmp/tuto-master-catalog-form.png', fullPage: true });
  } finally { await isolated.close(); }
});
test('historical dry-run requires explicit product and variant association', async () => {
  const isolated = await openIsolatedBrowser(chromium); const { page, baseURL } = isolated;
  try {
    await page.addInitScript(() => { (window as any).__masterCatalogFixture = true; });
    await page.goto(`${baseURL}/catalogo/productos?clientId=local-client`);
    await expect(page.getByRole('button', { name: 'Camisa 00 Tuto' })).toBeVisible();
    await page.getByRole('button', { name: 'Incorporar histórico', exact: true }).click();
    const history = page.getByRole('region', { name: 'Incorporar histórico' });
    await expect(history.getByRole('combobox', { name: 'Lote', exact: true }).locator('option[value="legacy-batch"]')).toHaveCount(1);
    await history.getByRole('combobox', { name: 'Lote', exact: true }).selectOption('legacy-batch');
    await history.getByRole('button', { name: 'Previsualizar (dry-run)' }).click();
    await expect(history.getByText('Posibles duplicados por SKU:', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__localCalls.some((c: any) => c.name === 'applyCatalogImport'))).toBe(false);
    await history.getByLabel('Destino').selectOption('master-00');
    const apply = history.getByRole('button', { name: 'Confirmar asociación' }); await expect(apply).toBeDisabled();
    await history.getByLabel('Variante de origen 0000').selectOption('variant-0');
    await history.getByRole('checkbox').check(); await apply.click();
    await expect.poll(() => page.evaluate(() => (window as any).__localCalls.some((c: any) => c.name === 'applyCatalogImport'))).toBe(true);
    const call = await page.evaluate(() => (window as any).__localCalls.find((c: any) => c.name === 'applyCatalogImport'));
    expect(call.input.confirmAssociation).toBe(true); expect(call.input.variantMap).toEqual({ 'legacy-row': 'variant-0' }); expect(call.input.productId).toBe('master-00');
    await page.screenshot({ path: '/tmp/tuto-master-catalog-import.png', fullPage: true });
  } finally { await isolated.close(); }
});
