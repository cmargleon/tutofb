import { test, expect } from '@playwright/test';

test('el interruptor de configuración persiste ambos estados y conserva los otros ajustes', async ({ page }) => {
  let saved = { organizerAutoGenerationEnabled: true, jobMaxRetries: 7 };
  let rejectSave = false;
  await page.exposeFunction('__saveOrganizerConfig', (patch: typeof saved) => {
    if (rejectSave) throw new Error('No se pudo guardar el ajuste');
    saved = { ...saved, ...patch }; return { success: true, config: saved };
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/src/features/auth/AuthProvider.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const useRole = () => ({ canManageUsers: true }); export const useAuth = () => ({ user: null, appUser: null, loading: false });' }));
  await page.route('**/src/features/system/useSystemConfig.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useSystemConfig = () => ({ config: ${JSON.stringify(saved)}, loading: false });` }));
  await page.route('**/src/features/system/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const updateSystemConfig = (patch) => window.__saveOrganizerConfig(patch);' }));
  await page.route('**/organizer-automation-settings-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/dev/deps/react.js'; import ReactDOM from '/node_modules/.vite/dev/deps/react-dom_client.js'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { OrganizerAutomationSettings } from '/src/components/automation/OrganizerAutomationSettings.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(OrganizerAutomationSettings)));</script></body></html>` }));
  await page.goto('/organizer-automation-settings-preview');
  const control = page.getByRole('switch', { name: 'Generar fotos después de organizar' });
  await expect(control).toBeChecked();
  await control.click();
  await expect(control).not.toBeChecked();
  expect(saved.organizerAutoGenerationEnabled).toBe(false);
  expect(saved.jobMaxRetries).toBe(7);
  await page.reload();
  await expect(control).not.toBeChecked();
  await control.click();
  await expect(control).toBeChecked();
  expect(saved.organizerAutoGenerationEnabled).toBe(true);
  rejectSave = true;
  await control.click();
  await expect(page.getByText('No se pudo guardar', { exact: true })).toBeVisible();
  await expect(control).toBeChecked();
  expect(saved.organizerAutoGenerationEnabled).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
