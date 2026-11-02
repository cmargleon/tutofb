import { test, expect } from '@playwright/test';

test('Automation shows the article incident alongside completed siblings and the existing batch', async ({ page }) => {
  const module = await (await page.request.get('/src/pages/Automation.tsx')).text();
  const router = module.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  if (!router) throw new Error('Vite router module not found');
  await page.route('https://**/*', (route) => route.abort());
  const job = {
    id: 'partial-classification', clientId: 'client', source: 'api', jobType: 'garment', status: 'needs_attention',
    inputImages: [], outputImages: [], generationJobIds: ['valid-scene'], batchId: 'existing-batch', retryCount: 0,
    progress: { total: 1, completed: 1, failed: 0 },
    items: [
      { itemId: 'uncertain-article', status: 'needs_attention', scenes: [], issue: { code: 'classification-required', message: 'La clasificación de camiseta.jpg necesita revisión.' } },
      { itemId: 'valid-article', status: 'completed', scenes: [{ jobId: 'valid-scene', scene: 'front', status: 'completed', attempts: 1, verdict: 'approved', reason: null }] },
    ],
  };
  await page.route('**/src/features/automation/useAutomation.ts*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export const useAutomation = () => ({ jobs: [], selectedJob: ${JSON.stringify(job)}, clients: [], canCreate: false });`,
  }));
  await page.route('**/automation-incidents-preview?*', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { BrowserRouter } from '${router}'; import { Automation } from '/src/pages/Automation.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(Automation)));</script>
    </body></html>` }));
  await page.goto('/automation-incidents-preview?job=partial-classification');
  await expect(page.getByText('classification-required: La clasificación de camiseta.jpg necesita revisión.')).toBeVisible();
  await expect(page.getByText('uncertain-article', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: 'front completed 1 approved' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Batch: existing-batch' })).toHaveAttribute('href', '/catalogo?clientId=client&batchId=existing-batch');
});
