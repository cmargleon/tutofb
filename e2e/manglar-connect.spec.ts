import { test, expect } from '@playwright/test';

test('Manglar consent shows the exact clients, returns to ChatGPT, and connections can be revoked', async ({ page, request }) => {
  const module = await (await request.get('/src/pages/ManglarConnect.tsx')).text();
  const router = module.match(/from ["']([^"']*react-router-dom\.js[^"']*)["']/)?.[1];
  expect(router).toBeTruthy();
  const decisions: any[] = []; const revocations: string[] = [];
  await page.exposeFunction('__manglarDecide', (input: any) => { decisions.push(input); return { redirectUrl: 'https://chatgpt.com/connector_platform_oauth_redirect?code=test-only&state=test-only' }; });
  await page.exposeFunction('__manglarRevoke', (id: string) => { revocations.push(id); return { revoked: true }; });
  await page.route('https://**/*', (route) => route.abort());
  await page.route('https://chatgpt.com/connector_platform_oauth_redirect*', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Regreso a ChatGPT</h1>' }));
  await page.route('**/src/features/auth/AuthProvider.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useRole = () => ({ isAdmin: true, isActive: true }); export const useAuth = () => ({ user: { uid: "test" }, loading: false });' }));
  await page.route('**/src/features/automation/manglarConnection.firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `export const getManglarConnectionRequest = async () => ({ application: 'ChatGPT', clients: [{ id: 'jishop', name: 'JISHOP' }, { id: 'test', name: 'Cliente de pruebas' }], scopes: ['jobs:read', 'jobs:create'], expiresAt: '2026-11-02T12:00:00Z' }); export const listManglarConnections = async () => [{ id: 'connection', application: 'ChatGPT', active: true, createdAt: '2026-11-02T10:00:00Z', expiresAt: '2026-12-02T10:00:00Z' }]; export const decideManglarConnection = input => window.__manglarDecide(input); export const revokeManglarConnection = id => window.__manglarRevoke(id);` }));
  await page.route('**/manglar-consent-preview*', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { BrowserRouter } from '${router}'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { ManglarConnect } from '/src/pages/ManglarConnect.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(FeedbackProvider, null, React.createElement(ManglarConnect))));</script>
    </body></html>` }));
  await page.goto('/manglar-consent-preview?request=test-request');
  await expect(page.getByRole('heading', { name: 'Conectar con ChatGPT' })).toBeVisible();
  await expect(page.getByText('JISHOP', { exact: true })).toBeVisible();
  await expect(page.getByText('Cliente de pruebas', { exact: true })).toBeVisible();
  await expect(page.getByText(/Autorizar la conexión no inicia ninguna generación/)).toBeVisible();
  expect(decisions).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/manglar-connect-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Autorizar ChatGPT' }).click();
  await expect(page.getByRole('heading', { name: 'Regreso a ChatGPT' })).toBeVisible();
  expect(decisions).toEqual([{ requestId: 'test-request', approve: true }]);
  await page.goto('/manglar-consent-preview');
  await expect(page.getByRole('heading', { name: 'Conexiones con ChatGPT' })).toBeVisible();
  await page.getByRole('button', { name: 'Revocar', exact: true }).click();
  expect(revocations).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Revocar conexión', exact: true }).click();
  await expect(page.getByText('ChatGPT · Inactiva')).toBeVisible();
  expect(revocations).toEqual(['connection']);
});
