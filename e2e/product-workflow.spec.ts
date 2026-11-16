import { chromium, expect, test } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

const links = 'clientId=local-client&variantId=local-variant&baseProductId=local-base';
const calls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__localCalls || []) as Promise<Array<{ name: string; input: any }>>;

test('ficha, generación explícita, revisión y validación con recarga y Atrás', async () => {
  const { page, baseURL, close } = await openIsolatedBrowser(chromium, { realAuth: true });
  try {
    await page.addInitScript(() => { (window as any).__productWorkflowFixture = { role: 'operador' }; });
    await page.goto(`${baseURL}/organizador?clientId=local-client`);
    await page.getByRole('link', { name: 'Abrir ficha' }).click();
    await expect(page.getByRole('heading', { name: 'Jarras', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Referencias Aprobadas' })).toBeVisible();
    await expect(page.getByText(/Jarra.jpg/)).toBeVisible();
    await page.getByRole('link', { name: 'Siguiente paso · Preparar generación' }).click();
    await expect(page).toHaveURL(new RegExp(`/generate\\?${links}`));
    await expect(page.getByRole('button', { name: 'Importar referencias' })).toBeEnabled();
    expect((await calls(page)).some(call => call.input?.action === 'draft')).toBe(false);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Cliente' })).toHaveValue('local-client');
    await page.getByRole('button', { name: 'Importar referencias' }).click();
    await expect(page.getByText(/Lote de objetos/)).toBeVisible();
    expect((await calls(page)).some(call => /^create.*Batch$/.test(call.name))).toBe(false);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: /Crear lote y abrir evaluación/ }).click();
    await expect(page).toHaveURL(new RegExp(`/catalogo\\?${links}&batchId=new-workflow-batch`));
    await expect(page.getByText('Aprobada', { exact: true })).toBeVisible();
    await expect(page.getByText('Requiere atención', { exact: true })).toBeVisible();
    await expect(page.getByText('Artículo ajeno')).toHaveCount(0);
    const created = (await calls(page)).find(call => call.name === 'createProductGenerationBatch');
    expect(created?.input.organizerContext).toEqual({ clientId: 'local-client', baseProductId: 'local-base', variantId: 'local-variant' });

    await page.getByRole('link', { name: 'Siguiente paso · Validar exportación por canal' }).click();
    await expect(page.getByRole('dialog', { name: 'Exportar a marketplaces' })).toBeVisible();
    await page.reload();
    const drawer = page.getByRole('dialog', { name: 'Exportar a marketplaces' });
    await drawer.getByText(/SHEIN · resumen de validación/).click();
    await expect(drawer.getByText('Falta el material.')).toBeVisible();
    const preview = (await calls(page)).find(call => call.name === 'previewMarketplaceExports');
    expect(preview?.input).toMatchObject({ batchIds: ['new-workflow-batch'], masterProductId: 'local-master', organizerContext: created?.input.organizerContext });
    expect((await calls(page)).some(call => /downloadMarketplace|publishMarketplace|selectJobOutput/.test(call.name))).toBe(false);
    await page.goBack();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Jarras · Revisión' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver a la ficha del producto' }).click();
    await expect(page).toHaveURL(new RegExp(`/organizador\\?${links}&batchId=new-workflow-batch`));
    await expect(page.getByText('new-workflow-batch', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Jarras · Revisión' })).toBeVisible();
  } finally {
    await close();
  }
});

test('los enlaces directos preservan el alcance y ocultan generación para revisores', async () => {
  const { page, baseURL, close } = await openIsolatedBrowser(chromium, { realAuth: true });
  try {
    await page.addInitScript(() => { (window as any).__productWorkflowFixture = { role: 'revisor', historical: true }; });
    await page.goto(`${baseURL}/organizador?${links}&batchId=local-batch`);
    await expect(page.getByRole('link', { name: 'Revisar lote' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Preparar.*generación/ })).toHaveCount(0);
    await page.goto(`${baseURL}/generate?${links}`);
    await expect(page).toHaveURL(`${baseURL}/`);
    await page.goto(`${baseURL}/catalogo?${links}&batchId=unrelated&view=export`);
    await expect(page.getByRole('alert')).toHaveText(/El lote no pertenece a la variante/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(`${baseURL}/catalogo?${links.replace('local-client', 'otro-cliente')}&batchId=local-batch&view=export`);
    await expect(page.getByRole('alert')).toHaveText(/Cliente fuera de tu alcance/);
    expect((await calls(page)).some(call => call.name === 'previewMarketplaceExports')).toBe(false);
  } finally {
    await close();
  }
});
