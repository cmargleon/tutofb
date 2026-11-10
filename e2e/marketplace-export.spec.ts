import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('publication requires consent, keeps unsaved fields and fills stable URLs before saving the product', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await drawer.getByRole('button', { name: 'Completar datos', exact: true }).click();
    await drawer.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Producto sin perder cambios');
    await drawer.getByText('SHEIN · plantilla y datos de salida', { exact: true }).click();
    const shein = drawer.locator('details').filter({ has: page.getByText('SHEIN · plantilla y datos de salida', { exact: true }) });
    const prepare = shein.getByRole('button', { name: 'Preparar URL para SHEIN', exact: true });
    await expect(prepare).toBeDisabled();
    expect(await page.evaluate(() => ((window as any).__localCalls || []).some((call: any) => call.name === 'publishMarketplaceImages'))).toBe(false);
    await shein.getByRole('checkbox', { name: 'Autorizo publicar copias', exact: false }).check();
    await prepare.click();
    const imageUrl = shein.getByRole('textbox', { name: 'URL pública · foto aprobada 1', exact: true });
    await expect(imageUrl).toHaveValue(/^https:\/\/storage\.googleapis\.com\/.*\.jpg$/);
    const url = await imageUrl.inputValue();
    await expect(shein.getByRole('link', { name: 'Abrir imagen publicada' })).toHaveAttribute('href', url);
    await expect(shein.getByRole('button', { name: 'Copiar URL' })).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: 'Nombre', exact: true })).toHaveValue('Producto sin perder cambios');
    const calls = await page.evaluate(() => (window as any).__localCalls.filter((call: any) => call.name === 'publishMarketplaceImages'));
    expect(calls).toHaveLength(1); expect(calls[0].input.authorizePublicImages).toBe(true); expect(calls[0].input.marketplaceId).toBe('shein');
    await shein.screenshot({ path: '/tmp/tuto-marketplace-images-editor.png' });
    await drawer.getByRole('button', { name: 'Guardar y volver a validar', exact: true }).click();
    const save = await page.evaluate(() => (window as any).__localCalls.find((call: any) => call.name === 'saveMasterProduct'));
    expect(save.input.marketplaces.shein.imageUrls['local-output']).toBe(url);
    expect(save.input.values.name).toBe('Producto sin perder cambios');
    await page.screenshot({ path: '/tmp/tuto-marketplace-images-publication.png' });
  } finally { await isolated.close(); }
});

test('catalog opens one export drawer, validates without creating files, selects all and downloads only on click', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1280, height: 900 } });
  const { page, baseURL } = isolated;
  try {
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.evaluate(() => (window as any).__setMarketplaceFixture('ready'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await expect(drawer).toBeVisible(); await expect(drawer.getByText('Listo para exportar')).toHaveCount(4);
    await page.screenshot({ path: '/tmp/tuto-marketplace-drawer.png' });
    const exportsBefore = await page.evaluate(() => (window as any).__localCalls.filter((c: any) => c.name === 'downloadMarketplaceExports').length); expect(exportsBefore).toBe(0);
    await drawer.getByRole('button', { name: 'Seleccionar todos', exact: true }).click();
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await drawer.getByRole('button', { name: 'Deseleccionar todos' }).click(); await expect(drawer.getByRole('button', { name: 'Descargar', exact: true })).toBeDisabled();
    await drawer.getByRole('checkbox').first().check();
    await drawer.getByRole('button', { name: 'Descargar', exact: true }).click();
    await expect(drawer.getByText('Descarga preparada:')).toBeVisible();
    const calls = await page.evaluate(() => (window as any).__localCalls.filter((c: any) => c.name === 'downloadMarketplaceExports'));
    expect(calls).toHaveLength(1); expect(calls[0].input.batchIds).toEqual(['local-batch']); expect(calls[0].input.marketplaceIds).toHaveLength(1);
    await drawer.getByRole('button', { name: 'Cerrar exportación' }).click(); await expect(drawer).not.toBeVisible();
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    await expect(drawer.getByRole('checkbox', { checked: true })).toHaveCount(0);
  } finally { await isolated.close(); }
});
test('only enabled destinations appear, missing templates disable selection, validation errors remain visible on narrow screens', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 390, height: 844 } });
  const { page, baseURL } = isolated;
  try {
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.evaluate(() => (window as any).__setMarketplaceFixture('missing'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await expect(drawer.getByRole('checkbox')).toHaveCount(2); await expect(drawer.getByRole('checkbox').first()).toBeDisabled();
    await drawer.getByRole('checkbox').last().check(); await expect(drawer.getByRole('button', { name: 'Descargar', exact: true })).toBeDisabled();
    await drawer.getByText('TikTok Shop · resumen de validación (1)', { exact: true }).click();
    await expect(drawer.getByText('Falta SKU de la variante.')).toBeVisible();
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => ((window as any).__localCalls || []).some((c: any) => c.name === 'downloadMarketplaceExports'))).toBe(false);
  } finally { await isolated.close(); }
});
test('client marketplace cards retain switches and show template administration only for enabled channels', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  const { page, baseURL } = isolated;
  try {
    await page.goto(`${baseURL}/clients/local-client?tab=marketplaces`);
    await expect(page.getByRole('switch')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Subir XLSX', exact: true })).toHaveCount(0);
  } finally { await isolated.close(); }
});

test('a client without enabled marketplaces has a configuration link and cannot download', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.evaluate(() => (window as any).__setMarketplaceFixture('none'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await expect(drawer.getByRole('link', { name: 'Configurar marketplaces', exact: true })).toHaveAttribute('href', '/clients/local-client?tab=marketplaces');
    await expect(drawer.getByRole('button', { name: 'Descargar', exact: true })).toBeDisabled();
    await expect(drawer.getByRole('checkbox')).toHaveCount(0);
  } finally { await isolated.close(); }
});

test('catalog edits the shared product and variants without creating an export', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await drawer.getByRole('button', { name: 'Completar datos', exact: true }).click();
    await drawer.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Nombre corregido');
    await drawer.getByText('Variantes · 1', { exact: true }).click();
    await drawer.getByRole('button', { name: 'Agregar fila', exact: true }).click();
    await expect(drawer.getByRole('textbox', { name: 'SKU interno', exact: true })).toHaveCount(3);
    await drawer.getByRole('textbox', { name: 'SKU interno', exact: true }).last().fill('SKU-NUEVO');
    await drawer.getByRole('button', { name: 'Guardar y volver a validar', exact: true }).click();
    await expect(drawer.getByText('Nombre corregido', { exact: true })).toBeVisible();
    const calls = await page.evaluate(() => (window as any).__localCalls);
    const save = calls.find((c: any) => c.name === 'saveMasterProduct');
    expect(save.input.values.name).toBe('Nombre corregido'); expect(save.input.variants).toHaveLength(2);
    expect(calls.some((c: any) => c.name === 'downloadMarketplaceExports')).toBe(false);
  } finally { await isolated.close(); }
});

test('enabled client channels display multiple template versions, categories and an attribute review dialog', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.addInitScript(() => { (window as any).__marketplaceClientEnabled = true; });
    await page.goto(`${baseURL}/clients/local-client?tab=marketplaces`);
    await expect(page.getByRole('button', { name: 'Subir XLSX', exact: true })).toHaveCount(4);
    const tiktok = page.locator('article').filter({ has: page.getByRole('heading', { name: 'TikTok Shop', exact: true }) });
    await expect(tiktok.getByText('Calzado TikTok · v1', { exact: false })).toBeVisible();
    await tiktok.getByText('Plantilla tiktok-shop · v1', { exact: false }).click();
    await tiktok.getByRole('button', { name: 'Revisar atributos', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Configurar atributos de plantilla' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Productos · datos desde fila 2 · 2 campos', { exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Asociación Productos sku', exact: true })).toHaveValue('variant.sku');
    await expect(dialog.getByRole('button', { name: 'Activar nueva versión', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => ((window as any).__localCalls || []).some((call: any) => call.name === 'downloadMarketplaceExports'))).toBe(false);
  } finally { await isolated.close(); }
});

test('editing master fields sends enabled channels and retains disabled Amazon data when re-enabled', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.evaluate(() => (window as any).__setMarketplaceFixture('amazon-disabled'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await drawer.getByRole('button', { name: 'Completar datos', exact: true }).click();
    await drawer.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Nombre con Amazon deshabilitado');
    await drawer.getByRole('textbox', { name: 'Marca', exact: true }).fill('Otra marca');
    await drawer.getByRole('button', { name: 'Guardar y volver a validar', exact: true }).click();
    await expect(drawer.getByText('Nombre con Amazon deshabilitado', { exact: true })).toBeVisible();
    const save = await page.evaluate(() => (window as any).__localCalls.find((c: any) => c.name === 'saveMasterProduct'));
    expect(Object.keys(save.input.marketplaces)).toEqual(['shein']);
    expect(save.input.expectedRevision).toBe(0);
    await drawer.getByRole('button', { name: 'Cerrar exportación', exact: true }).click();
    await page.evaluate(() => (window as any).__setMarketplaceFixture('ready'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    await drawer.getByRole('button', { name: 'Completar datos', exact: true }).click();
    await drawer.getByText('Amazon · plantilla y datos de salida', { exact: true }).click();
    const amazon = drawer.locator('details').filter({ has: page.getByText('Amazon · plantilla y datos de salida', { exact: true }) });
    await expect(amazon.getByRole('combobox', { name: 'Plantilla', exact: true })).toHaveValue('export-amazon');
    expect(await page.evaluate(() => (window as any).__localCalls.some((c: any) => c.name === 'downloadMarketplaceExports'))).toBe(false);
  } finally { await isolated.close(); }
});

test('a linked historical template remains selected alongside the current version', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, baseURL } = isolated;
    await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
    await page.evaluate(() => (window as any).__setMarketplaceFixture('historical'));
    await page.getByRole('button', { name: 'Exportar a marketplaces', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await drawer.getByRole('button', { name: 'Completar datos', exact: true }).click();
    await drawer.getByText('SHEIN · plantilla y datos de salida', { exact: true }).click();
    const shein = drawer.locator('details').filter({ has: page.getByText('SHEIN · plantilla y datos de salida', { exact: true }) });
    const template = shein.getByRole('combobox', { name: 'Plantilla', exact: true });
    await expect(template).toHaveValue('export-shein');
    await expect(template.locator('option:checked')).toHaveText('Plantilla shein · v1 · Histórica vinculada');
    await expect(template.locator('option[value="export-shein-next"]')).toHaveText('Plantilla shein · v2');
    await drawer.getByRole('button', { name: 'Guardar y volver a validar', exact: true }).click();
    const save = await page.evaluate(() => (window as any).__localCalls.find((c: any) => c.name === 'saveMasterProduct'));
    expect(save.input.marketplaces.shein.templateId).toBe('export-shein');
  } finally { await isolated.close(); }
});
