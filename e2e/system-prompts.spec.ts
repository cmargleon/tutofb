import { test, expect } from '@playwright/test';

test('configuration edits, saves, reloads and resets every additional global prompt', async ({ page }) => {
  let saved: Record<string, unknown> = {
    jobMaxRetries: 3, jobRetryDelayMs: 300000, batchMaxJobs: 100,
    geminiImageReviewModel: 'gemini-3.1-flash-lite-preview', disabledProviders: [],
  };
  await page.exposeBinding('__saveSystemConfig', (_, patch) => { saved = { ...saved, ...patch }; return { success: true, config: saved }; });
  await page.route('**/src/features/auth/AuthProvider.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const useRole = () => ({ canManageUsers: true, canAccessAnalytics: false });
  ` }));
  await page.route('**/src/features/system/useSystemHealth.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const useSystemHealth = () => ({ data: null, loading: false, error: null, refresh: async () => {} });
  ` }));
  await page.route('**/src/features/system/useSystemConfig.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const config = ${JSON.stringify(saved)};
    export const useSystemConfig = () => ({ config, loading: false });
  ` }));
  await page.route('**/src/features/system/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export const updateSystemConfig = (patch) => window.__saveSystemConfig(patch);
    export const updateSystemAlertSettings = async () => { throw new Error('Unexpected alert update'); };
  ` }));
  await page.route('**/config-preview', (route) => route.fulfill({ contentType: 'text/html', body: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx';
      import { Configuracion } from '/src/pages/Configuracion.tsx';
      import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(Configuracion)));
    </script></body></html>` }));
  await page.goto('/config-preview');
  const savePrompts = page.getByRole('heading', { name: 'Prompts globales del wizard' }).locator('../..').getByRole('button', { name: 'Guardar', exact: true });
  const fields = [
    ['Conservación de identidad de la modelo', 'systemPromptIdentity'],
    ['Tratamiento de etiquetas interiores', 'systemPromptInternalLabels'],
    ['Caso D: accesorio transportable', 'systemPromptCarryAccessory'],
    ['Reglas de accesorios', 'systemPromptAccessories'],
    ['Instrucciones generales de fotografía de producto', 'systemPromptProduct'],
  ];
  for (const [label] of fields) await page.getByRole('textbox', { name: label, exact: true }).fill(`Global: ${label}`);
  const scenes = ['Lifestyle · entorno natural', 'Ambiente cotidiano', 'Segundo contexto de uso', 'Lifestyle · composición ambiental', 'Persona usando el producto', 'Persona usando el producto · otra vista'];
  for (const label of scenes) await page.getByRole('textbox', { name: label, exact: true }).fill(`Global: ${label}`);
  await savePrompts.click();
  await expect(page.getByText('Cambios aplicados.', { exact: true })).toBeVisible();
  for (const [label, key] of fields) expect(saved[key]).toBe(`Global: ${label}`);
  expect(Object.values(saved.systemProductScenePrompts as object)).toEqual(scenes.map((label) => `Global: ${label}`));
  await page.reload();
  for (const [label] of fields) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(`Global: ${label}`);
  for (const label of scenes) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(`Global: ${label}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/tutofb-global-prompts-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  for (const [label] of fields) await page.getByRole('textbox', { name: label, exact: true }).fill('');
  for (const label of scenes) await page.getByRole('textbox', { name: label, exact: true }).fill('');
  await savePrompts.click();
  await expect(page.getByText('Cambios aplicados.', { exact: true })).toBeVisible();
  await expect.poll(() => saved.systemPromptIdentity).toBeNull();
  await page.reload();
  for (const [label, key] of fields) {
    expect(saved[key]).toBeNull();
    await expect(page.getByRole('textbox', { name: label, exact: true })).not.toHaveValue('');
  }
  expect(saved.systemProductScenePrompts).toBeNull();
  for (const label of scenes) await expect(page.getByRole('textbox', { name: label, exact: true })).not.toHaveValue('');
});
