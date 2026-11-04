import { test, expect, type Page } from '@playwright/test';

// Exercise the real catalog, wizard and subscription hooks without production reads or paid calls.
async function openPreview(page: Page) {
  const hook = await (await page.request.get('/src/features/generate/wizard/hooks/useGenerateWizard.ts')).text();
  const router = hook.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  if (!router) throw new Error('Vite router module not found');
  await page.route('**/src/features/models/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const listeners = new Set();
    let models = [{ id: 'model', name: 'Modelo de prueba', clientId: 'client', clientNameSnapshot: 'Cliente', status: 'active', poseCount: 3,
      createdAt: '2026-11-03', coverPoseId: 'inactive', coverPosePath: 'test/inactive.jpg',
      poses: ['legacy', 'active', 'inactive'].map(id => ({ id, fileName: id + '.jpg', storagePath: 'test/' + id + '.jpg',
        ...(id === 'legacy' ? {} : { active: id === 'active' }),
        aiClassification: { usableForGarmentViews: ['front'], bodyFocus: 'full_body', orientationGroup: 'front', orientationDetail: 'front',
          faceVisible: true, framing: 'full_body', autoCategory: 'front_cuerpo_completo', confidence: 0.99 } })) }];
    export const subscribeToModels = callback => { listeners.add(callback); callback(models); return () => listeners.delete(callback); };
    export const setModelPoseActive = async input => {
      if (window.__failToggle) { window.__failToggle = false; throw new Error('Error de prueba'); }
      models = models.map(model => ({ ...model, poses: model.poses.map(pose => pose.id === input.poseId ? { ...pose, active: input.active } : pose) }));
      listeners.forEach(callback => callback(models));
      return { success: true, ...input };
    };
    const unexpected = async () => { throw new Error('Unexpected catalog mutation'); };
    export const archiveModel = unexpected, downloadModelBundle = unexpected, generateModelPoses = unexpected,
      importModelBundle = unexpected, permanentlyDeleteModel = unexpected, replaceModelPoseWithGeneratedPhoto = unexpected,
      restoreModel = unexpected, updateModel = unexpected;
  ` }));
  await page.route('**/src/features/clients/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const clients = [{ id: 'client', name: 'Cliente', status: 'active' }];
    export const subscribeToClients = callback => { callback(clients); return () => {}; };
    export const subscribeToClientSpreadsheetTemplates = (id, callback) => { callback([]); return () => {}; };
    export const subscribeToSpreadsheetTemplateCategories = (client, template, callback) => { callback([]); return () => {}; };
  ` }));
  await page.route('**/src/features/system/useSystemConfig.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const config = { disabledProviders: [], batchMaxJobs: 100 };
    export const useSystemConfig = () => ({ config, loading: false });
  ` }));
  await page.route('**/src/features/generate/storage.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const deleteGarmentDraftByStoragePath = async () => {};
    export const uploadWizardSourceSpreadsheet = async () => { throw new Error('Unexpected spreadsheet'); };
    export const uploadGarmentDrafts = async (draft, items) => ({ failed: [], uploaded: items.map(item => ({ garmentId: item.id, attempts: 1,
      storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/front.jpg',
      photoUploads: item.originalPhotos.map(photo => ({ photoId: photo.id, storagePath: 'garments/drafts/user/' + draft + '/' + item.id + '/' + photo.id + '.jpg' })) })) });
  ` }));
  await page.route('**/src/features/generate/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const classifyGarmentViewsWithGemini = async request => ({ success: true, garments: request.garments.map(item => ({
      garmentId: item.garmentId, garmentName: item.garmentName, itemKind: 'garment', itemKindConfidence: 0.99,
      itemLabel: 'Camiseta', usedGemini: true, garmentBodyArea: 'upper_body', availableViews: ['front'],
      photos: item.photos.map(photo => ({ ...photo, view: 'front', confidence: 0.99, classifiedBy: 'gemini' })) })) });
    export const previewProductDrafts = async () => { throw new Error('Unexpected spreadsheet preview'); };
    export const createGenerationBatch = async request => { window.__request = request; return { batchId: 'test', createdJobs: request.poseIds.length }; };
    export const createProductGenerationBatch = async () => { throw new Error('Unexpected product generation'); };
  ` }));
  await page.route('**/src/features/storage/useStorageAssetUrl.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useStorageAssetUrl = () => ({ url: null, loading: false, error: null });
  ` }));
  await page.route(/https:\/\/.*(?:googleapis\.com|cloudfunctions\.net|run\.app)\//, route => route.abort());
  await page.route('**/pose-preview*', route => route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { BrowserRouter } from '${router}';
      import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx';
      import { ModelsCatalog } from '/src/pages/ModelsCatalog.tsx';
      import { Wizard } from '/src/pages/Wizard.tsx';
      import '/src/index.css';
      const h = React.createElement;
      ReactDOM.createRoot(document.getElementById('root')).render(h(BrowserRouter, null, h(FeedbackProvider, null,
        h('section', { 'aria-label': 'Catálogo', style: { padding: '16px' } }, h(ModelsCatalog)),
        h('section', { 'aria-label': 'Wizard', style: { padding: '16px' } }, h(Wizard)))));
    </script></body></html>` }));
  await page.goto('/pose-preview');
}

test('catalog on/off persists immediately and the open wizard hides inactive poses and updates selections', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview(page);
  const catalog = page.getByRole('region', { name: 'Catálogo', exact: true });
  const wizard = page.getByRole('region', { name: 'Wizard', exact: true });
  await catalog.getByText('Modelo de prueba', { exact: true }).click();
  const active = catalog.getByRole('switch', { name: 'Pose activa: active.jpg', exact: true });
  const inactive = catalog.getByRole('switch', { name: 'Pose activa: inactive.jpg', exact: true });
  const legacy = catalog.getByRole('switch', { name: 'Pose activa: legacy.jpg', exact: true });
  await expect(active).toBeChecked();
  await expect(inactive).not.toBeChecked();
  await expect(legacy).toBeChecked();
  await wizard.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('client');
  await wizard.getByLabel('Fotos del mismo artículo').setInputFiles({ name: 'shirt-front.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64') });
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: /Modelo de prueba/ }).click();
  await expect(wizard.getByText('active.jpg', { exact: true })).toBeVisible();
  await expect(wizard.getByText('legacy.jpg', { exact: true })).toBeVisible();
  await expect(wizard.getByText('inactive.jpg', { exact: true })).toHaveCount(0);
  await expect(wizard.getByText('2 seleccionadas de 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/tutofb-pose-on-off-mobile.png', fullPage: true });

  await active.click();
  await expect(active).not.toBeChecked();
  await expect(wizard.getByText('active.jpg', { exact: true })).toHaveCount(0);
  await expect(wizard.getByText('1 seleccionada de 1', { exact: true })).toBeVisible();
  await inactive.click();
  await expect(wizard.getByText('inactive.jpg', { exact: true })).toBeVisible();
  await expect(wizard.getByText('2 seleccionadas de 2', { exact: true })).toBeVisible();

  await page.evaluate(() => { (window as any).__failToggle = true; });
  await legacy.click();
  await expect(page.getByText('No pudimos cambiar el estado de la pose', { exact: true })).toBeVisible();
  await expect(legacy).toBeChecked();
  await expect(wizard.getByText('legacy.jpg', { exact: true })).toBeVisible();

  await legacy.click();
  await inactive.click();
  await expect(wizard.getByRole('status')).toContainText('Este modelo no tiene poses activas');
  await expect(wizard.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await active.click();
  await expect(wizard.getByText('1 seleccionada de 1', { exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await wizard.getByRole('button', { name: /Crear lote y abrir evaluación/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__request?.poseIds)).toEqual(['active']);
});
