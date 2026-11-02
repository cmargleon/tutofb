import { test, expect } from '@playwright/test';

test('Catalog keeps the exact automation batch while subscriptions load and performs no cancellation on navigation', async ({ page }) => {
  page.on('pageerror', (error) => console.error('Navigation preview:', error.message));
  const module = await (await page.request.get('/src/pages/Catalogo.tsx')).text();
  const router = module.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  if (!router) throw new Error('Vite router module not found');
  await page.route('https://**/*', (route) => route.abort());
  await page.route('**/src/pages/Catalogo.tsx*', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/from ["'][^"']*firebase_firestore\.js[^"']*["']/, 'from "/catalog-firestore-mock.js"');
    await route.fulfill({ response, body: source });
  });
  await page.route('**/catalog-firestore-mock.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const collection = (...args) => ({ type: 'collection', args });
    export const doc = (...args) => ({ type: 'doc', id: args.at(-1) });
    export const where = (...args) => args;
    export const orderBy = (...args) => args;
    export const query = (...args) => ({ type: 'query', args });
    export const onSnapshot = (ref, callback) => {
      const timer = setTimeout(() => callback(ref.type === 'doc'
        ? { id: ref.id, exists: () => true, data: () => ({ clientId: 'client', status: 'pending', pendingJobs: 0, processingJobs: 0, completedJobs: 0, failedJobs: 0, totalJobs: 0, createdAt: { seconds: 1 }, provider: 'fal-seedream' }) }
        : { docs: [] }), ref.type === 'doc' ? 400 : 50);
      return () => clearTimeout(timer);
    };
  ` }));
  await page.route('**/src/components/catalog/CatalogGarmentSection.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const CatalogGarmentSection = () => null;' }));
  await page.route('**/src/components/catalog/CatalogLightbox.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const CatalogLightbox = () => null;' }));
  await page.route('**/src/features/auth/AuthProvider.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useRole = () => ({ canRegenerate: true }); export const useAuth = () => ({ user: null });' }));
  await page.route('**/src/features/system/useSystemConfig.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useSystemConfig = () => ({ config: { disabledProviders: [] }, loading: false });' }));
  await page.route('**/src/features/clients/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `export const subscribeToClients = (callback) => { const timer = setTimeout(() => callback([{ id: 'client', name: 'Cliente de prueba' }]), 200); return () => clearTimeout(timer); };` }));
  await page.route('**/src/features/evaluation/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const cancelBatchProcessing = async () => { window.__cancelCalls = (window.__cancelCalls || 0) + 1; throw new Error('Unexpected cancellation'); };
    export const cancelJobGeneration = async () => {}; export const deleteJob = async () => {}; export const regenerateJob = async () => {}; export const retryJobAutoReview = async () => {}; export const selectJobOutput = async () => {}; export const setJobManualFlag = async () => {}; export const updateBatchProductDraft = async () => {};
    export const editBatchSpreadsheet = async () => {}; export const exportBatchSpreadsheet = async () => {}; export const regenerateFailedBatchJobs = async () => {};
  ` }));
  await page.route('**/src/features/catalog/useCatalogJobs.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js'; const { useEffect, useState } = React;
    const empty = [];
    export const useCatalogJobs = () => {
      const [batches, setBatches] = useState(empty);
      useEffect(() => { const timer = setTimeout(() => setBatches([{ id: 'newest-wrong-batch', clientId: 'client', createdAt: { seconds: 2 } }]), 800); return () => clearTimeout(timer); }, []);
      return { batches, garmentGroups: empty, loading: false, error: null, currentPage: 1, totalPages: 1, hasPreviousPage: false, hasNextPage: false, goToPreviousPage: () => {}, goToNextPage: () => {} };
    };
  ` }));
  await page.route('**/catalog-navigation-preview?*', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { BrowserRouter } from '${router}'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { Catalogo } from '/src/pages/Catalogo.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(FeedbackProvider, null, React.createElement(Catalogo))));</script>
    </body></html>` }));
  await page.goto('/catalog-navigation-preview?clientId=client&batchId=automation-requested-batch');
  await expect(page.getByText('Lote', { exact: false }).first()).toBeVisible();
  await expect(page.locator('select').nth(1)).toHaveValue('automation-requested-batch');
  await expect(page.locator('select').nth(1).locator('option[value="newest-wrong-batch"]')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('batchId')).toBe('automation-requested-batch');
  expect(await page.evaluate(() => (window as any).__cancelCalls || 0)).toBe(0);
});
