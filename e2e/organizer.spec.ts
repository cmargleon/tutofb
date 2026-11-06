import { test, expect } from '@playwright/test';

test('el organizador permite configurar un cliente y simular sin confirmar gasto', async ({ page }) => {
  page.on('pageerror', error => console.error('Organizador:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Navegador:', message.text()); });
  await page.route('https://**/*', route => route.abort());
  const module = await (await page.request.get('/src/pages/Organizador.tsx')).text();
  const router = module.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  const hook = await (await page.request.get('/src/features/organizer/useOrganizer.ts')).text();
  const feedback = hook.match(/from ["']([^"']*FeedbackProvider\.tsx[^"']*)["']/)?.[1];
  if (!router || !feedback) throw new Error('No se encontraron los módulos de Vite');
  await page.route('**/src/features/auth/AuthProvider.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: 'export const useRole = () => ({ isAdmin: true, canCreateBatches: true });',
  }));
  await page.route('**/src/features/organizer/firebase.ts*', route => route.fulfill({
    contentType: 'application/javascript', body: `
      const fixture = { id: 'client', name: 'Cliente de prueba', configured: false, driveFolderIds: ['folder-a', 'folder-b'] };
      let config = null;
      let active = null;
      export const organizer = async (request) => {
        (window.organizerCalls ||= []).push(request);
        if (request.action === 'clients') return { items: [fixture], next: null };
        if (request.action === 'config') return config;
        if (request.action === 'configure') {
          config = { ...request.settings, clientId: 'client', clientName: fixture.name, activeRunId: null, destinationId: null,
            watcher: 'disabled', lastPollAt: null, lastSyncAt: null, lastClassifiedAt: null };
          return config;
        }
        if (request.action === 'start') {
          active = { id: 'run-demo', clientId: 'client', status: 'queued', mode: request.mode, phase: 'inventory', createdAt: 1,
            budgetUsd: 0, alerts: [], calls: 0, counts: {} };
          config = { ...config, activeRunId: active.id };
          return active;
        }
        if (request.action === 'run') return active;
        if (request.action === 'products') return { items: [
          { id: 'variant-a', visual: 'ALFA', name: 'Prensa francesa', color: 'Negro', pack: '', status: 'pending', skcs: ['ALFA'], skus: [], sizes: [], referenceState: 'pending', issues: [], references: {front:[],back:[],main:[]} },
          { id: 'variant-b', visual: 'BETA', name: 'Termo de acero', color: 'Rojo', pack: '', status: 'pending', skcs: ['BETA'], skus: [], sizes: [], referenceState: 'pending', issues: [], references: {front:[],back:[],main:[]} }
        ], next: null };
        if (request.action === 'photos') return { items: [{ id: 'photo', name: 'Ambigua.jpg', path: ['Origen', 'Cocina', 'Ambigua.jpg'], sourceUrl: 'https://drive.google.com/open?id=photo',
          copyUrl: null, variantId: null, variantIds: [], candidates: ['variant-a','variant-b'], method: 'pendiente', evidence: ['Carpeta mixta'], confidence: 0, issue: 'Conflicto de identidad',
          candidateDetails: [{ id: 'variant-a', label: 'ALFA · Prensa francesa · Negro', score: 85, evidence: ['Código en ruta'] }]
        }], next: null };
        if (request.action === 'correct') return { id: 'photo', ...request };
        if (request.action === 'tabs') return { items: [{ id: 'ropa', name: 'Ropa', fileName: 'Catálogo', imported: 12, skipped: 0 },
          { id: 'carga', name: 'Control de carga', fileName: 'Catálogo', imported: 8, skipped: 1 }], next: null };
        return { items: [], next: null };
      };`,
  }));
  await page.route('**/organizer-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { BrowserRouter } from '${router}'; import { FeedbackProvider } from '${feedback}'; import { Organizador } from '/src/pages/Organizador.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(FeedbackProvider, null, React.createElement(Organizador))));</script></body></html>` }));
  await page.goto('/organizer-preview');
  await expect(page.getByRole('heading', { name: 'Organizador inteligente' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'folder-a' }).check();
  await page.getByLabel('Carpeta contenedora del destino').fill('destination');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(page.getByRole('button', { name: 'Simular' })).toBeEnabled();
  await page.getByRole('button', { name: 'Fotografías', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambigua.jpg' })).toBeVisible();
  await page.getByRole('button', { name: 'Fotografías', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ambigua.jpg' })).toBeVisible();
  await expect(page.getByText('ALFA · Prensa francesa · Negro', { exact: true }).first()).toBeVisible();
  await page.getByText('Corregir asociación', { exact: true }).click();
  await page.getByLabel('Productos de Ambigua.jpg').selectOption([{ label: 'ALFA · Prensa francesa · Negro' }, { label: 'BETA · Termo de acero · Rojo' }]);
  await page.getByRole('checkbox', { name: 'ALFA · Prensa francesa · Negro', exact: true }).check();
  await page.getByRole('button', { name: 'Guardar asociación', exact: true }).click();
  await page.getByRole('button', { name: 'Pestañas de origen' }).click();
  await expect(page.getByText('Control de carga')).toBeVisible();
  await page.getByRole('button', { name: 'Simular' }).click();
  await expect(page.getByRole('heading', { name: 'En cola' })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { organizerCalls: Record<string, unknown>[] }).organizerCalls);
  expect(calls.find(call => call.action === 'configure')).toMatchObject({ settings: { sourceIds: ['folder-a'] } });
  expect(calls.find(call => call.action === 'start')).toMatchObject({ action: 'start', mode: 'dry_run', clientId: 'client' });
  expect(calls.find(call => call.action === 'start')).not.toHaveProperty('confirmedBudgetUsd', 40);
  expect(calls.find(call => call.action === 'correct')).toMatchObject({ variantId: null, variantIds: ['variant-a','variant-b'], referenceVariantIds: ['variant-a'] });
});
