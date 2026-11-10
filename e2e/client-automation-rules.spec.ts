import { test, expect, type Page } from '@playwright/test';
import type { ClientAutomationConfig } from '../shared/src/types';

type FixtureOptions = { automation?: ClientAutomationConfig; system?: Record<string, unknown>; globalSettings?: boolean };

async function preview(page: Page, options: FixtureOptions = {}) {
  let automation = options.automation ?? { enabled: true, driveFolderIds: ['folder-a'], presets: { catalogo: { prompt: 'Catálogo del cliente' } } };
  let system = options.system ?? {};
  const saves: unknown[] = [];
  await page.exposeFunction('__saveClientAutomationRules', (input: any) => {
    expect(input.clientId).toBe('client');
    expect(input.section).toBe('automation');
    expect(input.automation.driveFolderIds).toBeUndefined();
    automation = { ...input.automation, driveFolderIds: automation.driveFolderIds };
    saves.push(input);
    return { automation };
  });
  await page.exposeFunction('__saveGlobalAutomationRules', (patch: any) => {
    system = { ...system, ...patch };
    saves.push(patch);
    return { success: true, config: system };
  });
  // Every Firebase access is replaced; external requests cannot reach live services.
  await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.fallback() : route.abort());
  await page.route('**/src/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    `export const auth = { app: { options: { projectId: 'demo-automation-rules' } }, currentUser: { uid: 'isolated-admin' } }; export const db = {}; export const functions = {}; export const storage = {};`,
  }));
  await page.route('**/src/features/auth/AuthProvider.tsx*', route => route.fulfill({ contentType: 'application/javascript', body:
    `const user = { uid: 'isolated-admin' }; export const useAuth = () => ({ user, appUser: { role: 'admin' }, loading: false }); export const useRole = () => ({ canManageUsers: true, isAdmin: true });`,
  }));
  await page.route('**/src/features/models/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    `const models = [{id:'man', name:'Modelo masculino', clientId:'client', status:'active', identityTraits:{sex:'male'}, poses:[]}, {id:'woman', name:'Modelo femenino', clientId:'client', status:'active', identityTraits:{sex:'female'}, poses:[]}]; export const subscribeToModels = callback => { callback(models); return () => {}; };`,
  }));
  await page.route('**/src/features/clients/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    'export const updateClientAutomation = input => window.__saveClientAutomationRules(input);',
  }));
  await page.route('**/src/features/system/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    'export const updateSystemConfig = patch => window.__saveGlobalAutomationRules(patch);',
  }));
  await page.route('**/src/features/system/useSystemConfig.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    `const config = ${JSON.stringify(system)}; export const useSystemConfig = () => ({ config, loading: false });`,
  }));
  await page.route('**/client-automation-rules-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/dev/deps/react.js'; import ReactDOM from '/node_modules/.vite/dev/deps/react-dom_client.js'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { ClientAutomationFields, ClientAutomationSave } from '/src/components/clients/ClientAutomationSection.tsx'; import { useClientAutomationConfig } from '/src/features/automation/useClientAutomationConfig.ts'; import { AutomationRulesSettings } from '/src/components/automation/AutomationRulesSettings.tsx'; import '/src/index.css';
    const client = { id: 'client', name: 'Cliente de prueba', status: 'active', automation: ${JSON.stringify(automation)} };
    function Preview() { const state = useClientAutomationConfig(client); return React.createElement('main', { className: 'p-4' }, React.createElement(ClientAutomationFields, { client, state }), React.createElement(ClientAutomationSave, { state, section: 'automation', disabled: false })); }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(${options.globalSettings ? 'AutomationRulesSettings' : 'Preview'})));
    </script></body></html>`,
  }));
  await page.goto('/client-automation-rules-preview');
  return { get automation() { return automation; }, get system() { return system; }, saves };
}

test('las reglas y el Organizador actualizan el borrador, se guardan y vuelven a heredar después de recargar', async ({ page }) => {
  const fixture = await preview(page, { system: {
    automationRules: { garmentGenderMinConfidence: 0.75, classificationMinConfidence: 0.72 },
    automationBudget: { defaultBudgetUsd: 12, maxBudgetUsd: 100, maxReviewAttempts: 3, maxOperationalRetries: 2 },
  } });
  const summary = page.getByRole('region', { name: 'Resumen del flujo' });
  const gender = page.getByRole('spinbutton', { name: 'Confianza mínima de género', exact: true });
  const classification = page.getByRole('spinbutton', { name: 'Confianza mínima de clasificación', exact: true });
  const enabled = page.getByRole('checkbox', { name: 'Generar fotos automáticamente al organizar' });
  const preset = page.getByRole('combobox', { name: 'Preset desde el Organizador' });
  await expect(summary).toContainText('Confianza de género: 0.75Sistema');
  await expect(summary).toContainText('Clasificación: 0.72Sistema');
  await expect(summary).toContainText('USD 12Sistema');
  await expect(gender).toHaveAttribute('placeholder', 'Heredar Sistema (0.75)');
  await expect(classification).toHaveAttribute('placeholder', 'Heredar Sistema (0.72)');
  await expect(enabled).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Editar o crear preset' })).toBeVisible();
  await gender.fill('0.8');
  await classification.fill('0.85');
  await enabled.uncheck();
  await preset.selectOption('catalogo');
  await expect(summary).toContainText('Confianza de género: 0.8Cliente');
  await expect(summary).toContainText('Clasificación: 0.85Cliente');
  await expect(summary).toContainText('Generación desactivadaCliente');
  await expect(summary).toContainText('Desde el Organizador: catalogoCliente');
  await expect(page.getByText(/Cambios sin guardar en Automatizaciones/)).toBeVisible();
  expect(fixture.saves).toHaveLength(0);
  await page.screenshot({ path: '/tmp/tuto-automation-client-rules.png', fullPage: true });
  await page.getByRole('button', { name: 'Guardar automatizaciones', exact: true }).click();
  await expect.poll(() => fixture.automation.rules).toEqual({ garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.85 });
  expect(fixture.automation.organizerGeneration).toEqual({ enabled: false, preset: 'catalogo' });
  expect(fixture.automation.driveFolderIds).toEqual(['folder-a']);
  await page.reload();
  await expect(gender).toHaveValue('0.8');
  await expect(classification).toHaveValue('0.85');
  await expect(enabled).not.toBeChecked();
  await expect(preset).toHaveValue('catalogo');
  await page.getByRole('button', { name: 'Volver a heredar confianza mínima de género' }).click();
  await page.getByRole('button', { name: 'Volver a heredar confianza mínima de clasificación' }).click();
  await expect(gender).toHaveValue('');
  await expect(classification).toHaveValue('');
  await expect(summary).toContainText('Confianza de género: 0.75Sistema');
  await enabled.check();
  await preset.selectOption('');
  await page.getByRole('button', { name: 'Guardar automatizaciones', exact: true }).click();
  await expect.poll(() => fixture.automation.rules).toBeUndefined();
  expect(fixture.automation.organizerGeneration).toBeUndefined();
  await page.reload();
  await expect(gender).toHaveValue('');
  await expect(classification).toHaveValue('');
  await expect(summary).toContainText('Clasificación: 0.72Sistema');
  await expect(enabled).toBeChecked();
  await expect(preset).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/tuto-automation-client-rules-mobile.png', fullPage: true });
});

test('sin ajustes globales el resumen conserva valores predeterminados y el interruptor apagado muestra un aviso', async ({ page }) => {
  await preview(page, { system: { organizerAutoGenerationEnabled: false } });
  const summary = page.getByRole('region', { name: 'Resumen del flujo' });
  await expect(summary).toContainText('Confianza de género: 0.65Predeterminado');
  await expect(summary).toContainText('Clasificación: 0.65Predeterminado');
  await expect(summary).toContainText('USD 10Predeterminado');
  await expect(summary).toContainText('Generación desactivadaSistema');
  await expect(page.getByText(/El interruptor general de Sistema está apagado/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Generar fotos automáticamente al organizar' })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('las reglas globales guardan sus valores y permiten restaurar los predeterminados', async ({ page }) => {
  const fixture = await preview(page, { globalSettings: true });
  const gender = page.getByRole('spinbutton', { name: /Confianza mínima de género/ });
  const classification = page.getByRole('spinbutton', { name: /Confianza mínima de clasificación/ });
  await gender.fill('0.8');
  await classification.fill('0.9');
  await page.getByRole('button', { name: 'Guardar reglas de automatización' }).click();
  await expect.poll(() => fixture.system.automationRules).toEqual({ garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.9 });
  await page.reload();
  await expect(gender).toHaveValue('0.8');
  await expect(classification).toHaveValue('0.9');
  await gender.fill('');
  await classification.fill('');
  await page.getByRole('button', { name: 'Guardar reglas de automatización' }).click();
  await expect.poll(() => fixture.system.automationRules).toEqual({});
  await page.reload();
  await expect(gender).toHaveValue('');
  await expect(gender).toHaveAttribute('placeholder', 'Predeterminado (0.65)');
});
