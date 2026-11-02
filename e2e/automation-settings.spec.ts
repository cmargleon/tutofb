import { test, expect } from '@playwright/test';

test('automation budget controls persist separately from manual queue settings and expose no pilot controls', async ({ page }) => {
  let saved: any = { automationBudget: { defaultBudgetUsd: 10, maxBudgetUsd: 100, maxReviewAttempts: 3, maxOperationalRetries: 2 }, jobMaxRetries: 7 };
  await page.exposeFunction('__saveAutomationConfig', (patch: any) => { saved = { ...saved, ...patch }; return { success: true, config: saved }; });
  await page.route('https://**/*', (route) => route.abort());
  await page.route('**/src/features/auth/AuthProvider.tsx*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const useRole = () => ({ canManageUsers: true });' }));
  await page.route('**/src/features/system/useSystemConfig.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `const config = ${JSON.stringify(saved)}; export const useSystemConfig = () => ({ config, loading: false });` }));
  await page.route('**/src/features/system/firebase.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export const updateSystemConfig = (patch) => window.__saveAutomationConfig(patch);' }));
  await page.route('**/automation-settings-preview', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { AutomationBudgetSettings } from '/src/components/automation/AutomationBudgetSettings.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(AutomationBudgetSettings)));</script>
    </body></html>` }));
  await page.goto('/automation-settings-preview');
  await expect(page.getByRole('heading', { name: 'Presupuesto de automatización' })).toBeVisible();
  await expect(page.getByText(/piloto/i)).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Presupuesto predeterminado por trabajo (USD)' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Presupuesto máximo por trabajo (USD)' }).fill('12');
  await page.getByRole('spinbutton', { name: 'Máximo de intentos de calidad por imagen' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Máximo de reintentos operativos' }).fill('1');
  await page.getByRole('button', { name: 'Guardar presupuesto de automatización' }).click();
  await expect.poll(() => saved.automationBudget).toEqual({ defaultBudgetUsd: 4, maxBudgetUsd: 12, maxReviewAttempts: 2, maxOperationalRetries: 1 });
  expect(saved.jobMaxRetries).toBe(7);
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Presupuesto predeterminado por trabajo (USD)' })).toHaveValue('4');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/manglar-automation-settings-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
