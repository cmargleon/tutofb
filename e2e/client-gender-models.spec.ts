import { test, expect } from '@playwright/test';

for (const single of [false, true]) test(`Clientes guarda modelos por género ${single ? 'con una única modelo disponible' : 'con selección entre varias modelos'}`, async ({ page }) => {
  let automation: any = { enabled: true, defaultBudgetUsd: 4 };
  const models = [
    ...(!single ? [{ id: 'man', name: 'Modelo masculino', clientId: 'client', status: 'active', identityTraits: { sex: 'male' }, poses: [] }] : []),
    { id: 'woman', name: 'Modelo femenina', clientId: 'client', status: 'active', identityTraits: { sex: 'female' }, poses: [] },
    ...(!single ? [{ id: 'other-woman', name: 'Segunda modelo', clientId: 'client', status: 'active', identityTraits: { sex: 'female' }, poses: [] }] : []),
    { id: 'inactive', name: 'Modelo inactivo', clientId: 'client', status: 'active', active: false, identityTraits: { sex: 'male' }, poses: [] },
    { id: 'foreign', name: 'Otro cliente', clientId: 'foreign', status: 'active', identityTraits: { sex: 'male' }, poses: [] },
  ];
  await page.exposeFunction('__saveClientAutomation', (input: any) => {
    expect(input.clientId).toBe('client'); automation = input.automation;
    return { automation };
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/src/features/models/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    `export const subscribeToModels = callback => { callback(${JSON.stringify(models)}); return () => {}; };`,
  }));
  await page.route('**/src/features/clients/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body:
    'export const updateClientAutomation = input => window.__saveClientAutomation(input);',
  }));
  await page.route('**/client-gender-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '/node_modules/.vite/dev/deps/react.js'; import ReactDOM from '/node_modules/.vite/dev/deps/react-dom_client.js'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { ClientAutomationSection } from '/src/components/clients/ClientAutomationSection.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(ClientAutomationSection, { client: { id: 'client', name: 'Cliente', automation: ${JSON.stringify(automation)} } })));</script></body></html>`,
  }));
  const open = async () => page.getByText(/Google Drive y automatización ·/).click();
  await page.goto('/client-gender-preview'); await open();
  const male = page.getByRole('combobox', { name: 'Modelo masculino predeterminado', exact: true });
  const female = page.getByRole('combobox', { name: 'Modelo femenino predeterminado', exact: true });
  await expect(male).toHaveValue(single ? '' : 'man');
  await expect(female).toHaveValue(single ? 'woman' : '');
  await expect(male.getByRole('option', { name: 'Modelo inactivo' })).toHaveCount(0);
  await expect(male.getByRole('option', { name: 'Otro cliente' })).toHaveCount(0);
  await expect(male.getByRole('option', { name: 'Modelo femenina' })).toHaveCount(0);
  if (!single) await female.selectOption('other-woman');
  await page.getByRole('button', { name: 'Guardar automatizaciones' }).click();
  await expect.poll(() => automation.defaultFemaleModelId).toBe(single ? 'woman' : 'other-woman');
  expect(automation.defaultMaleModelId).toBe(single ? undefined : 'man');
  expect(automation.defaultBudgetUsd).toBe(4);
  await page.reload(); await open();
  await expect(female).toHaveValue(single ? 'woman' : 'other-woman');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `/tmp/tutofb-client-gender-${single ? 'single' : 'both'}.png`, fullPage: true });
});
