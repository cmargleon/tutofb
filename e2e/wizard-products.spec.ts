import { test, expect, type Page } from '@playwright/test';

// Isolate the real wizard from Firebase: no live reads, uploads or paid generation.
const previewUrl = process.env.WIZARD_TEST_URL || 'http://localhost:3000';
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64') });
async function openWizard(page: Page) {
  page.on('pageerror', (error) => console.error(error.message));
  const hookModule = await (await page.request.get(`${previewUrl}/src/features/generate/wizard/hooks/useGenerateWizard.ts`)).text();
  const routerModule = hookModule.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  if (!routerModule) throw new Error('Vite router module not found');
  await page.route('**/src/features/generate/wizard/hooks/useGenerateWizardCatalog.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const clients = [{ id: 'client', name: 'Cliente de prueba' }];
    const models = [{ id: 'model', clientId: 'client', name: 'Modelo de prueba', poses: [], poseCount: 0 }];
    const empty = [];
    export const useGenerateWizardCatalog = (state) => ({ clients, models: state.selectedClientId ? models : empty,
      selectedClient: clients.find(c => c.id === state.selectedClientId) || null,
      selectedModel: models.find(m => m.id === state.selectedModelId) || null,
      spreadsheetTemplates: empty, spreadsheetCategories: empty, selectedSpreadsheetCategory: null,
      selectedClientHasSpreadsheetTemplates: false, loadingSpreadsheetTemplates: false, loadingData: false, error: null });
  ` }));
  await page.route('**/src/features/system/useSystemConfig.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const config = { disabledProviders: [], batchMaxJobs: 100, systemPromptOverride: null };
    export const useSystemConfig = () => ({ config, loading: false });
  ` }));
  await page.route('**/src/features/generate/storage.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const deleteGarmentDraftByStoragePath = async () => {};
    export const uploadWizardSourceSpreadsheet = async () => { throw new Error('Unexpected spreadsheet upload'); };
    export const uploadGarmentDrafts = async (draft, items) => {
      window.__uploadedItems = items;
      return { failed: [], uploaded: items.map(item => ({ garmentId: item.id, attempts: 1,
        storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/front.jpg',
        photoUploads: item.originalPhotos.map(photo => ({ photoId: photo.id, storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/' + photo.id + '.jpg' })) })) };
    };
  ` }));
  await page.route('**/src/features/generate/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const classifyGarmentViewsWithGemini = async () => { throw new Error('Unexpected garment classification'); };
    export const previewProductDrafts = async () => { throw new Error('Unexpected spreadsheet preparation'); };
    export const createGenerationBatch = async () => { throw new Error('Unexpected garment batch'); };
    export const createProductGenerationBatch = async (request) => { window.__productRequest = request; return { batchId: 'product-test', createdJobs: request.items.length * request.scenes.length }; };
  ` }));
  await page.route('**/wizard-preview*', (route) => route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html class="theme-dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="padding:20px"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { BrowserRouter } from '${routerModule}';
      import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx';
      import { Wizard } from '/src/pages/Wizard.tsx';
      import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(FeedbackProvider, null, React.createElement(Wizard))));
    </script></body></html>` }));
  await page.goto(`${previewUrl}/wizard-preview`);
  await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('client');
}

test('object wizard groups references, edits scenes and prompts and submits only selected scenes', async ({ page }) => {
  await openWizard(page);
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Objetos / productos' }).click();
  await expect(page.getByText('Modelos del cliente', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Fotos del mismo objeto')).toBeEnabled();
  await page.getByLabel('Fotos del mismo objeto').setInputFiles([image('front.png'), image('side.png')]);
  await expect(page.getByText('2 vistas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(6);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Lifestyle · entorno natural/ }).check();
  await page.getByText('Editar instrucciones de la escena', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Prompt de Lifestyle · entorno natural' }).fill('On a wooden table');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: /Seedream v4\.5/ }).click();
  const prompt = page.getByRole('textbox', { name: 'Instrucciones generales de fotografía de producto' });
  await prompt.fill('Warm soft light');
  await page.getByText('Ver prompt completo por escena', { exact: true }).click();
  await expect(page.locator('pre')).toContainText('Preserve the exact referenced product');
  await expect(page.locator('pre')).toContainText('Warm soft light\nOn a wooden table');
  await expect(page.getByText('1 objeto(s) × 1 escena(s) = 1 imágenes · Solo fotos')).toBeVisible();
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-summary.png', fullPage: true });
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (1)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const request = await page.evaluate(() => (window as any).__productRequest);
  expect(request.items).toHaveLength(1);
  expect(request.items[0].referencePaths).toHaveLength(2);
  expect(request.scenes).toEqual([{ type: 'clean', prompt: 'On a wooden table' }]);
  expect(request.prompt).toBe('Warm soft light');
  expect(request.imageConfig.imageSize).toBe('square_hd');
  expect(request.modelId).toBeUndefined();
});

test('changing type confirms discarded selections and preserves the clothing model requirement', async ({ page }) => {
  await openWizard(page);
  await page.getByRole('button', { name: 'Objetos / productos' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Fotos del mismo objeto').setInputFiles([image('front.png')]);
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByRole('button', { name: 'Ropa con modelo' }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Objetos / productos' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Ropa con modelo' }).click();
  await page.getByRole('button', { name: 'Cambiar y empezar de nuevo', exact: true }).click();
  await expect(page.getByText('Modelos del cliente', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Modelo de prueba/ }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Todavía no hay prendas en el lote', { exact: true })).toBeVisible();
});

test('mobile object wizard validates reference limits and restores original prompts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWizard(page);
  await page.getByRole('button', { name: 'Objetos / productos' }).click();
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Fotos del mismo objeto').setInputFiles(Array.from({ length: 5 }, (_, i) => image(`view-${i}.png`)));
  await expect(page.getByText('Cada objeto admite hasta 4 fotos de referencia.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByLabel('Fotos del mismo objeto').setInputFiles([image('front.png')]);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(6);
  const scene = page.locator('section').filter({ has: page.getByRole('checkbox', { name: /Lifestyle · entorno natural/ }) });
  await scene.getByText('Editar instrucciones de la escena', { exact: true }).click();
  const scenePrompt = scene.getByRole('textbox', { name: 'Prompt de Lifestyle · entorno natural' });
  await scenePrompt.fill('');
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await scene.getByRole('button', { name: 'Restaurar escena original', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-scenes-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: /Seedream v4\.5/ }).click();
  const prompt = page.getByRole('textbox', { name: 'Instrucciones generales de fotografía de producto' });
  const original = await prompt.inputValue();
  await prompt.fill('Custom instructions');
  await page.getByRole('button', { name: 'Restaurar instrucciones originales', exact: true }).click();
  await expect(prompt).toHaveValue(original);
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => ({ tag: el.tagName, classes: el.className, width: el.getBoundingClientRect().width })).slice(0, 8));
  expect(overflow).toEqual([]);
  await expect(page.getByText('1 objeto(s) × 6 escena(s) = 6 imágenes · Solo fotos')).toBeVisible();
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (6)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const request = await page.evaluate(() => (window as any).__productRequest);
  expect(request.scenes).toHaveLength(6);
  const humanUseScenes = request.scenes.filter((entry: { type: string }) => entry.type.startsWith('human_use_'));
  expect(humanUseScenes).toHaveLength(2);
  for (const entry of humanUseScenes) {
    expect(entry.prompt).toMatch(/person naturally using/i);
    expect(entry.prompt).toContain('relatively neutral, uncluttered background');
  }
});
