import { test, expect, type Page } from '@playwright/test';

// Isolate the real wizard from Firebase: no live reads, uploads or paid generation.
const previewUrl = process.env.WIZARD_TEST_URL || 'http://localhost:3000';
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64') });
async function openWizard(page: Page, promptConfig: Record<string, unknown> = {}, options: { confidence?: number; failAnalysisOnce?: boolean; templates?: boolean; failPreviewOnce?: boolean } = {}) {
  page.on('pageerror', (error) => console.error(error.message));
  const hookModule = await (await page.request.get(`${previewUrl}/src/features/generate/wizard/hooks/useGenerateWizard.ts`)).text();
  const routerModule = hookModule.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  if (!routerModule) throw new Error('Vite router module not found');
  await page.route('**/src/features/generate/wizard/hooks/useGenerateWizardCatalog.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const clients = [{ id: 'client', name: 'Cliente de prueba' }];
    const poses = ['front', 'back'].map(view => ({ id: 'pose-' + view, fileName: view + '.jpg', storagePath: 'test/' + view + '.jpg',
      aiClassification: { usableForGarmentViews: [view], bodyFocus: 'full_body', orientationGroup: view, orientationDetail: view,
        faceVisible: true, framing: 'full_body', autoCategory: view + '_cuerpo_completo', confidence: 0.99 } }));
    const models = [{ id: 'model', clientId: 'client', name: 'Modelo de prueba', identityTraits: { sex: 'female' }, poses, poseCount: 2 }, { id: 'model2', clientId: 'client', name: 'Segundo modelo', identityTraits: { sex: 'male' }, poses, poseCount: 2 }];
    const templates = ${options.templates ? "[{ id: 'template', name: 'Plantilla de prueba', defaultCategoryId: 'category' }]" : '[]'};
    const categories = [{ id: 'category', label: 'Camisetas', attributes: [], columns: [] }];
    const empty = [];
    export const useGenerateWizardCatalog = (state) => ({ clients, models: state.selectedClientId ? models : empty,
      selectedClient: clients.find(c => c.id === state.selectedClientId) || null,
      selectedModel: models.find(m => m.id === state.selectedModelId) || null,
      spreadsheetTemplates: templates, spreadsheetCategories: state.selectedSpreadsheetTemplateId ? categories : empty,
      selectedSpreadsheetCategory: categories.find(c => c.id === state.selectedSpreadsheetCategoryId) || null,
      selectedClientHasSpreadsheetTemplates: templates.length > 0, loadingSpreadsheetTemplates: false, loadingData: false, error: null });
  ` }));
  await page.route('**/src/features/system/useSystemConfig.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const config = { disabledProviders: [], batchMaxJobs: 100, systemPromptOverride: null, ...${JSON.stringify(promptConfig)} };
    export const useSystemConfig = () => ({ config, loading: false });
  ` }));
  await page.route('**/src/features/generate/storage.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const deleteGarmentDraftByStoragePath = async () => {};
    export const uploadWizardSourceSpreadsheet = async () => { throw new Error('Unexpected spreadsheet upload'); };
    export const uploadGarmentDrafts = async (draft, items) => {
      window.__uploadCalls = (window.__uploadCalls || 0) + 1;
      window.__uploadedItems = items;
      return { failed: [], uploaded: items.map(item => ({ garmentId: item.id, attempts: 1,
        storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/front.jpg',
        photoUploads: item.originalPhotos.map(photo => ({ photoId: photo.id, storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/' + photo.id + '.jpg' })) })) };
    };
  ` }));
  await page.route('**/src/features/generate/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const options = ${JSON.stringify(options)};
    export const classifyGarmentViewsWithGemini = async (request) => {
      window.__analysisRequests = [...(window.__analysisRequests || []), request];
      if (options.failAnalysisOnce && window.__analysisRequests.length === 1) throw new Error('Simulated analysis failure');
      await new Promise(resolve => setTimeout(resolve, 40));
      return { success: true, garments: request.garments.map(item => {
        const kind = /shirt|pants/i.test(item.garmentName) ? 'garment' : 'product';
        return { garmentId: item.garmentId, garmentName: item.garmentName, itemKind: kind,
          itemKindConfidence: options.confidence ?? 0.99, itemKindReasoning: 'Tipo detectado en la imagen', itemLabel: kind === 'garment' ? 'Camiseta' : 'Objeto de prueba',
          usedGemini: true, garmentBodyArea: kind === 'garment' ? 'upper_body' : null, garmentAccessoryType: null,
          matchedCategoryId: request.spreadsheetTemplateId ? 'category' : null, matchedCategoryLabel: request.spreadsheetTemplateId ? 'Camisetas' : null,
          matchedColor: 'Azul', availableViews: ['front', 'back'],
          photos: item.photos.map(photo => ({ ...photo, view: /back/i.test(photo.fileName) ? 'back' : 'front', confidence: 0.99, classifiedBy: 'gemini' })) };
      }) };
    };
    export const previewProductDrafts = async request => {
      window.__previewRequests = [...(window.__previewRequests || []), request];
      if (options.failPreviewOnce && window.__previewRequests.length === 1) throw new Error('Simulated spreadsheet failure');
      return { success: true, productDrafts: request.garments.map(garment => ({ garmentId: garment.id, garmentName: garment.name,
        categoryId: 'category', categoryName: 'Camisetas', matchedColor: 'Azul', rows: [], inferredValues: {} })) };
    };
    export const createGenerationBatch = async request => { window.__garmentRequest = request; return { batchId: 'garment-test', createdJobs: 1 }; };
    export const createProductGenerationBatch = async (request) => { window.__productRequest = request; return { batchId: 'product-test', createdJobs: request.items.length * request.scenes.length }; };
  ` }));
  await page.route('**/src/features/storage/useStorageAssetUrl.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useStorageAssetUrl = () => ({ url: null, loading: false, error: null });
  ` }));
  await page.route(/https:\/\/.*(?:googleapis\.com|cloudfunctions\.net|run\.app)\//, route => route.abort());
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

const next = (page: Page) => page.getByRole('button', { name: 'Continuar', exact: true });
const back = (page: Page) => page.getByRole('button', { name: 'Volver', exact: true });
const uploadItem = (page: Page, names = ['front.png']) => page.getByLabel('Fotos del mismo artículo').setInputFiles(names.map(image));
const openAdvanced = (page: Page) => page.getByText('Ajustes avanzados · Instrucciones', { exact: true }).click();

test('garment gender prompt starts empty and switches with model sex while preserving other local edits', async ({ page }) => {
  await openWizard(page, { systemPromptMale: 'Global male instructions' });
  await uploadItem(page, ['shirt-front.png']);
  await next(page).click();
  await page.getByRole('button', { name: /Modelo de prueba/ }).click();
  await next(page).click();
  await openAdvanced(page);
  const female = page.getByRole('textbox', { name: 'Prendas · Prompt adicional para modelo mujer', exact: true });
  const male = page.getByRole('textbox', { name: 'Prendas · Prompt adicional para modelo hombre', exact: true });
  await expect(female).toHaveValue('');
  await expect(male).toHaveCount(0);
  await female.fill('Local female instructions');
  const labels = page.getByRole('textbox', { name: 'Tratamiento de etiquetas interiores', exact: true });
  await labels.fill('Local label instructions');
  await expect(page.getByLabel('Prompt completo para fal.ai')).toContainText('Local female instructions');
  await back(page).click();
  await page.getByRole('button', { name: /Segundo modelo/ }).click();
  await next(page).click();
  if (!(await male.isVisible())) await openAdvanced(page);
  await expect(male).toHaveValue('Global male instructions');
  await expect(female).toHaveCount(0);
  await expect(labels).toHaveValue('Local label instructions');
  const preview = page.getByLabel('Prompt completo para fal.ai');
  await expect(preview).not.toContainText('Local female instructions');
  await male.fill('Local male instructions');
  await expect(preview).toContainText('Local male instructions');
  await page.getByRole('button', { name: /Crear lote y abrir evaluación/ }).click();
  await expect(page).toHaveURL(/batchId=garment-test/);
  const request = await page.evaluate(() => (window as any).__garmentRequest);
  expect(request.modelId).toBe('model2');
  expect(request.approvedPrompts[0].text).toContain('Local male instructions');
  expect(request.approvedPrompts[0].text).toContain('Local label instructions');
  expect(request.approvedPrompts[0].text).not.toMatch(/Global male instructions|Local female instructions/);
});

test('selecting a model resets to Portrait 4:3 while preserving quality, format and later manual framing', async ({ page }) => {
  await openWizard(page);
  await uploadItem(page);
  await next(page).click();
  await next(page).click();
  const portrait = page.getByRole('button', { name: /^Portrait 4:3/ });
  await expect(portrait).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Square HD/ }).click();
  await page.getByRole('button', { name: 'High', exact: true }).click();
  await page.getByRole('button', { name: 'JPEG', exact: true }).click();
  await page.getByRole('button', { name: /Seedream v4\.5/ }).click();
  await expect(portrait).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /GPT Image 2.5 Flare/ }).click();
  await expect(portrait).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Landscape 4:3/ }).click();
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (6)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  expect(await page.evaluate(() => (window as any).__productRequest.imageConfig)).toMatchObject({
    provider: 'fal-gpt-image-2.5-flare', imageSize: 'landscape_4_3', quality: 'high', outputFormat: 'jpeg',
  });
});

test('detects an object before configuration, groups references and submits edited scenes', async ({ page }) => {
  await openWizard(page);
  await expect(next(page)).toBeDisabled();
  await expect(page.getByText('¿Qué quieres fotografiar?')).toHaveCount(0);
  await uploadItem(page, ['front.png', 'side.png']);
  await expect(page.getByText('Lote de objetos · Prepararemos escenas de producto')).toBeVisible();
  await expect(page.getByText('2 vistas', { exact: true })).toBeVisible();
  await next(page).click();
  await expect(page.getByText('Modelos del cliente', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(6);
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(next(page)).toBeDisabled();
  await page.getByRole('checkbox', { name: /Lifestyle · entorno natural/ }).check();
  await page.getByText('Editar instrucciones de la escena', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Prompt de Lifestyle · entorno natural' }).fill('On a wooden table');
  await next(page).click();
  await expect(page.getByRole('button', { name: /GPT Image 2.5 Flare/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Seedream v4\.5/ }).click();
  await openAdvanced(page);
  const prompt = page.getByRole('textbox', { name: 'Instrucciones generales de fotografía de producto' });
  await prompt.fill('Warm soft light');
  await page.getByText('Ver prompt completo por escena', { exact: true }).click();
  await expect(page.locator('pre')).toContainText('Preserve the exact referenced product');
  await expect(page.locator('pre')).toContainText('Warm soft light\nOn a wooden table');
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-summary.png', fullPage: true });
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (1)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const request = await page.evaluate(() => (window as any).__productRequest);
  expect(request.items).toHaveLength(1);
  expect(request.items[0].referencePaths).toHaveLength(2);
  expect(request.scenes).toEqual([{ type: 'clean', prompt: 'On a wooden table' }]);
  expect(request.prompt).toBe('Warm soft light');
  expect(request.imageConfig.imageSize).toBe('portrait_4_3');
  expect(request.modelId).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__uploadCalls)).toBe(1);
});

test('correcting the photography type preserves uploaded references and detects a single back photo', async ({ page }) => {
  await openWizard(page);
  await uploadItem(page, ['shirt-back.png']);
  await expect(page.getByText('Lote de ropa · Prepararemos fotos con modelo')).toBeVisible();
  await next(page).click();
  await expect(next(page)).toBeDisabled();
  await page.getByRole('button', { name: /Modelo de prueba/ }).click();
  await expect(page.getByText('1 seleccionada de 2')).toBeVisible();
  await next(page).click();
  await expect(page.getByRole('button', { name: /Crear lote y abrir evaluación/ })).toBeEnabled();
  await back(page).click();
  await back(page).click();
  await page.getByText('Cambiar tipo de fotografía', { exact: true }).click();
  await page.getByRole('button', { name: 'Fotografía de producto', exact: true }).click();
  await expect(page.getByText('1 vista', { exact: true })).toBeVisible();
  await next(page).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(6);
  await next(page).click();
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (6)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const uploaded = await page.evaluate(() => ({ calls: (window as any).__uploadCalls, analysis: (window as any).__analysisRequests.length,
    request: (window as any).__productRequest }));
  expect(uploaded.calls).toBe(1);
  expect(uploaded.analysis).toBe(1);
  expect(uploaded.request.items[0].referencePaths).toHaveLength(1);
});

test('mobile wizard validates reference limits and generates all six scenes with Flare by default', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWizard(page);
  await uploadItem(page, Array.from({ length: 5 }, (_, i) => `view-${i}.png`));
  await expect(page.getByText('Cada artículo admite hasta 4 fotos de referencia.', { exact: true })).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await uploadItem(page);
  await expect(next(page)).toBeEnabled();
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-mobile.png', fullPage: true });
  await next(page).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(6);
  const scene = page.locator('section').filter({ has: page.getByRole('checkbox', { name: /Lifestyle · entorno natural/ }) });
  await scene.getByText('Editar instrucciones de la escena', { exact: true }).click();
  await scene.getByRole('textbox', { name: 'Prompt de Lifestyle · entorno natural' }).fill('');
  await expect(next(page)).toBeDisabled();
  await scene.getByRole('button', { name: 'Restaurar escena global', exact: true }).click();
  await next(page).click();
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).map(el => el.tagName).slice(0, 8))).toEqual([]);
  await expect(page.getByRole('button', { name: /GPT Image 2.5 Flare/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Instrucciones generales de fotografía de producto' })).not.toBeVisible();
  await page.screenshot({ path: '/tmp/tutofb-wizard-product-scenes-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (6)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const request = await page.evaluate(() => (window as any).__productRequest);
  expect(request.provider).toBe('fal-gpt-image-2.5-flare');
  expect(request.imageConfig.imageSize).toBe('portrait_4_3');
  expect(request.scenes).toHaveLength(6);
  expect(request.scenes.filter((entry: { type: string }) => entry.type.startsWith('human_use_'))).toHaveLength(2);
});

test('global product prompts populate, restore and preserve local edits when going back', async ({ page }) => {
  await openWizard(page, { systemPromptProduct: 'Global warm lighting', systemProductScenePrompts: { clean: 'Global wooden table' } });
  await uploadItem(page);
  await next(page).click();
  const scene = page.locator('section').filter({ has: page.getByRole('checkbox', { name: /Lifestyle · entorno natural/ }) });
  await scene.getByText('Editar instrucciones de la escena', { exact: true }).click();
  const scenePrompt = scene.getByRole('textbox', { name: 'Prompt de Lifestyle · entorno natural' });
  await expect(scenePrompt).toHaveValue('Global wooden table');
  await scenePrompt.fill('Local table');
  await next(page).click();
  await openAdvanced(page);
  const prompt = page.getByRole('textbox', { name: 'Instrucciones generales de fotografía de producto' });
  await expect(prompt).toHaveValue('Global warm lighting');
  await prompt.fill('Temporary lighting');
  await page.getByRole('button', { name: 'Restaurar instrucciones globales', exact: true }).click();
  await expect(prompt).toHaveValue('Global warm lighting');
  await prompt.fill('Local lighting');
  await back(page).click();
  await expect(scenePrompt).toHaveValue('Local table');
  await next(page).click();
  await openAdvanced(page);
  await expect(prompt).toHaveValue('Local lighting');
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (6)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  const request = await page.evaluate(() => (window as any).__productRequest);
  expect(request.prompt).toBe('Local lighting');
  expect(request.scenes.find((entry: { type: string }) => entry.type === 'clean').prompt).toBe('Local table');
});

for (const kind of ['garment', 'product'] as const) {
  test(`keeps the ${kind} majority, warns with excluded names and counts articles rather than photos`, async ({ page }) => {
    await openWizard(page);
    await page.getByLabel('Fotos de artículos independientes').setInputFiles(kind === 'garment'
      ? [image('shirt.png'), image('pants.png'), image('lamp.png')]
      : [image('lamp.png'), image('cup.png'), image('shirt.png')]);
    await expect(page.getByRole('alert').filter({ hasText: 'Se quitaron del lote 1 artículo(s)' })).toContainText(kind === 'garment' ? 'lamp' : 'shirt');
    await expect(page.getByRole('button', { name: /Quitar / })).toHaveCount(2);
    await next(page).click();
    if (kind === 'garment') await page.getByRole('button', { name: /Modelo de prueba/ }).click();
    else await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(6);
    await next(page).click();
    await page.getByRole('button', { name: /Crear lote y abrir evaluación/ }).click();
    await expect(page).toHaveURL(new RegExp(`batchId=${kind}-test`));
    const request = await page.evaluate(kind => kind === 'garment' ? (window as any).__garmentRequest : (window as any).__productRequest, kind);
    expect(kind === 'garment' ? request.garments : request.items).toHaveLength(2);
    expect(request.provider).toBe('fal-gpt-image-2.5-flare');
  });
}

test('ties and uncertain detections wait for an explicit choice and keep the photos', async ({ page }) => {
  await openWizard(page, {}, { confidence: 0.4 });
  await page.getByLabel('Fotos de artículos independientes').setInputFiles([image('shirt.png'), image('lamp.png')]);
  await expect(page.getByText('Confirma cómo quieres fotografiar este lote')).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: /Quitar / })).toHaveCount(2);
  await page.getByRole('button', { name: 'Fotografía de producto', exact: true }).click();
  await next(page).click();
  await next(page).click();
  await page.getByRole('button', { name: 'Crear lote y abrir evaluación (12)', exact: true }).click();
  await expect(page).toHaveURL(/batchId=product-test/);
  expect(await page.evaluate(() => (window as any).__productRequest.items.length)).toBe(2);
});

test('failed analysis retries with the same uploaded photos and does not advance early', async ({ page }) => {
  await openWizard(page, {}, { failAnalysisOnce: true });
  await uploadItem(page);
  await expect(page.getByRole('button', { name: 'Reintentar análisis' })).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Reintentar análisis' }).click();
  await expect(next(page)).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__uploadCalls)).toBe(1);
  expect(await page.evaluate(() => (window as any).__analysisRequests.length)).toBe(2);
});

test('clothing chooses model before output, reuses visual analysis and prepares spreadsheet only at the end', async ({ page }) => {
  await openWizard(page, {}, { templates: true, failPreviewOnce: true });
  await uploadItem(page, ['shirt-front.png']);
  await next(page).click();
  await expect(page.getByText('Salida final', { exact: true })).toHaveCount(0);
  await expect(next(page)).toBeDisabled();
  await page.getByRole('button', { name: /Modelo de prueba/ }).click();
  await expect(next(page)).toBeEnabled();
  await page.getByRole('button', { name: /Segundo modelo/ }).click();
  await next(page).click();
  expect(await page.evaluate(() => (window as any).__analysisRequests.length)).toBe(1);
  await page.getByRole('button', { name: 'Con spreadsheet' }).click();
  await expect(page.getByRole('button', { name: /Crear lote y abrir evaluación/ })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Spreadsheet del cliente', exact: true }).selectOption('template');
  await expect(page.getByRole('button', { name: 'Reintentar preparación' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar preparación' }).click();
  await expect(page.getByRole('button', { name: /Crear lote y abrir evaluación/ })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__analysisRequests.length)).toBe(2);
  await page.getByRole('button', { name: /Crear lote y abrir evaluación/ }).click();
  await expect(page).toHaveURL(/batchId=garment-test/);
  const request = await page.evaluate(() => (window as any).__garmentRequest);
  expect(request.modelId).toBe('model2');
  expect(request.outputMode).toBe('spreadsheet');
  expect(request.productDrafts).toHaveLength(1);
  expect(request.poseIds).toEqual(['pose-front']);
  expect(request.garments[0].photos[0].view).toBe('front');
  expect(request.provider).toBe('fal-gpt-image-2.5-flare');
});
