import { test, expect, type Page } from '@playwright/test';

const initialClients = () => Array.from({ length: 45 }, (_, index) => ({
  id: `client-${index}`, name: `Cliente ${String(index).padStart(2, '0')}`, status: index === 44 ? 'archived' : 'active',
  createdAt: '2026-01-01', batchCount: 3, lastBatchCreatedAt: null, generationPromptBase: 'Prompt conservado',
  automation: { enabled: true, driveFolderIds: ['folder-a'], defaultMaleModelId: 'man', defaultFemaleModelId: 'woman', defaultModelId: 'man', defaultBudgetUsd: 4, maxOperationalRetries: 2, presets: { custom: { prompt: 'Conservar preset' } } },
}));
async function setup(page: Page, role = 'admin') {
  const routerSource = await (await page.request.get('/src/app/AppRouter.tsx')).text();
  const routerImport = routerSource.match(/from ["']([^"']*react-router-dom[^"']*)/)![1];
  const controls = { rejectMarketplace: false, readError: false, readDelayMs: 0 };
  const clients: any[] = initialClients();
  const calls: { name: string; input: any }[] = [];
  const reads: any[] = [];
  await page.exposeFunction('__clientsRead', async (kind: string, id?: string) => {
    if (controls.readDelayMs) await new Promise(resolve => setTimeout(resolve, controls.readDelayMs));
    reads.push({ kind, id });
    if (controls.readError) throw new Error('Lectura no disponible');
    if (kind === 'page') {
      const filters = JSON.parse(id!); const q = (filters.search || '').trim().toLowerCase();
      const matching = clients.filter(client => (filters.showArchived || client.status !== 'archived') && (!filters.status || filters.status === 'all' || client.status === filters.status) && client.name.toLowerCase().includes(q));
      const page = Math.max(1, Math.min(filters.page || 1, Math.ceil(matching.length / 20)));
      return { clients: matching.slice((page-1)*20, page*20), page, hasMore: matching.length > page*20 };
    }
    if (kind === 'templates') return [{ id: 'template', clientId: id, name: 'Plantilla real simulada', categories: [{ id: 'cat', label: 'Ropa' }], defaultCategoryId: 'cat' }];
    return id ? clients.find(client => client.id === id) ?? null : clients;
  });
  await page.exposeFunction('__clientsMutate', (name: string, input: any) => {
    calls.push({ name, input });
    if (name === 'marketplace' && controls.rejectMarketplace) throw new Error('No se pudo guardar el marketplace');
    const client = clients.find(client => client.id === input.clientId || client.id === input.id);
    if (name === 'archive' || name === 'restore') client.status = name === 'archive' ? 'archived' : 'active';
    if (name === 'create') clients.unshift({ ...initialClients()[0], id: 'new-client', name: input.name, generationPromptBase: input.prompt });
    if (name === 'update') {
      const current = { name: client.name, generationPromptBase: client.generationPromptBase ?? null };
      const patch = Object.fromEntries(['name', 'generationPromptBase'].filter(key => key in input).map(key => [key, input[key]]));
      if (Object.keys(patch).some(key => input.expected?.[key] !== current[key])) return { _conflict: { current } };
    }
    if (name === 'update') { if (input.name !== undefined) client.name = input.name; if (input.generationPromptBase !== undefined) client.generationPromptBase = input.generationPromptBase; }
    if (name === 'automation') {
      if (input.section === 'sources') client.automation = { ...client.automation, driveFolderIds: input.automation.driveFolderIds };
      else client.automation = { ...input.automation, driveFolderIds: client.automation.driveFolderIds };
    }
    if (name === 'marketplace') {
      client.marketplaces ??= {};
      const previous = client.marketplaces[input.marketplaceId];
      const current = { enabled: previous?.enabled === true, region: previous?.settings?.region ?? '', sellerId: previous?.settings?.sellerId ?? '' };
      const patch = { ...input.settings, ...('enabled' in input ? { enabled: input.enabled } : {}) };
      if (Object.keys(patch).some(key => input.expected?.[key] !== current[key])) return { _conflict: { current } };
      client.marketplaces[input.marketplaceId] = { enabled: false, ...previous, ...('enabled' in input ? { enabled: input.enabled } : {}), ...('settings' in input ? { settings: { ...previous?.settings, ...Object.fromEntries(Object.entries(input.settings).map(([key, value]) => [key, (value as string).trim()])) } } : {}) };
    }
    return name === 'automation' ? { automation: client.automation } : { success: true };
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/src/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const auth = { currentUser: { uid: 'admin' }, app: { options: { projectId: 'demo-clients' } } }; export const db = {}; export const functions = {}; export const storage = {};` }));
  await page.route('**/__clients-fixture.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    const listeners = new Set();
    export const sub = (kind, id, callback, onError) => { let active = true; const emit = async () => { try { const value = await window.__clientsRead(kind, id); if (active) callback(value); } catch (err) { if (active) onError?.(err); } }; listeners.add(emit); emit(); return () => { active = false; listeners.delete(emit); }; };
    export const mutate = async (name, input) => { const result = await window.__clientsMutate(name, input); if (result?._conflict) { const error = new Error('Los valores cambiaron en otra sesión.'); error.details = result._conflict; throw error; } await Promise.all([...listeners].map(emit => emit())); return result; };
  ` }));
  await page.route('**/src/features/marketplaces/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { mutate } from '/__clients-fixture.js';
    export const updateClientMarketplace = input => mutate('marketplace', input);
  ` }));
  await page.route('**/src/features/clients/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { sub, mutate } from '/__clients-fixture.js';
    export const listClients = input => window.__clientsRead('page', JSON.stringify(input));
    export const subscribeToClients = (callback, onError) => sub('clients', null, callback, onError);
    export const subscribeToClient = (id, callback, onError) => sub('client', id, callback, onError);
    export const subscribeToClientSpreadsheetTemplates = (id, callback, onError) => sub('templates', id, callback, onError);
    export const subscribeToSpreadsheetTemplateCategories = (clientId, templateId, callback) => { callback([]); return () => {}; };
    export const createClient = (name, prompt) => mutate('create', { name, prompt });
    export const updateClient = (id, patch) => mutate('update', { id, ...patch });
    export const archiveClient = id => mutate('archive', { id });
    export const restoreClient = id => mutate('restore', { id });
    export const updateClientAutomation = input => mutate('automation', input);
    export const importClientSpreadsheetTemplate = () => { throw Error('No upload expected'); };
    export const deleteClientSpreadsheetTemplate = () => { throw Error('No deletion expected'); };
    export const updateClientSpreadsheetTemplateCategory = () => { throw Error('No category edit expected'); };
  ` }));
  await page.route('**/src/features/models/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const subscribeToModels = callback => { callback([
    { id: 'man', name: 'Modelo masculino', clientId: 'client-0', status: 'active', identityTraits: { sex: 'male' }, poses: [] },
    { id: 'woman', name: 'Modelo femenino', clientId: 'client-0', status: 'active', identityTraits: { sex: 'female' }, poses: [] },
  ]); return () => {}; };` }));
  await page.route('**/src/features/auth/AuthProvider.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useRole = () => ({ isAdmin: true, canRegenerate: true, canEvaluate: true }); export const useAuth = () => ({ user: { uid: 'admin' }, appUser: { active: true, role: '${role}' }, loading: false });` }));
  await page.route('**/src/components/Layout.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `import React from '/node_modules/.vite/deps/react.js'; import { Outlet } from '${routerImport}'; export const Layout = () => React.createElement('main', { style: { padding: 16 } }, React.createElement(Outlet));` }));
  await page.route('**/src/pages/Dashboard.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `import React from '/node_modules/.vite/deps/react.js'; export const Dashboard = () => React.createElement('h1', null, 'Inicio');` }));
  await page.route('http://localhost:3000/**', route => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es" class="theme-dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
      <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
      <script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx'; import { AppRouter } from '/src/app/AppRouter.tsx'; import '/src/index.css'; ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FeedbackProvider, null, React.createElement(AppRouter)));</script></body></html>` });
  });
  return { clients, calls, reads, controls };
}

test('compact list filters the full collection, pages in URL, returns to context, and redirects legacy links', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/lista');
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(page.getByText('Carpetas autorizadas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole('link', { name: 'Cliente 20', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cliente 20', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a la lista' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('searchbox').fill('Cliente 43');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page).not.toHaveURL(/page=/);
  await page.getByLabel('Mostrar archivados').click();
  await expect(page.getByLabel('Mostrar archivados')).toBeChecked();
  await page.getByLabel('Estado', { exact: true }).selectOption('archived');
  await page.getByRole('searchbox').fill('Cliente 44');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const url = page.url();
  await page.getByRole('link', { name: 'Cliente 44' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: 'Volver a la lista' }).click();
  await expect(page).toHaveURL(url);
  await page.goto('/clients/lista#client-client-0');
  await expect(page).toHaveURL(/\/clients\/client-0\?/);
  await expect(page.getByRole('heading', { name: 'Cliente 00' })).toBeVisible();
  expect(state.calls).toEqual([]);
  expect(state.reads.filter(read => read.kind === 'templates').every(read => !!read.id)).toBe(true);
});

test('detail preserves shared automation drafts, channel settings and general settings across tabs and navigation', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/client-0?tab=fuentes&list=q%3DCliente%2B00');
  const folders = page.getByRole('textbox', { name: 'Carpetas autorizadas de Google Drive' });
  await expect(folders).toHaveValue('folder-a');
  await expect(page.getByText('Plantilla real simulada', { exact: true })).toBeVisible();
  await folders.fill('folder-a\nfolder-b');
  await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Presupuesto por pedido (USD)' }).fill('6');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nombre del cliente' }).fill('Nombre pendiente');
  await page.getByRole('button', { name: 'Marketplaces', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
  const amazon = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Amazon', exact: true }) });
  await amazon.getByRole('textbox', { name: 'País o región' }).fill('MX');
  await page.getByRole('link', { name: 'Volver a la lista' }).click();
  await page.getByRole('link', { name: 'Cliente 00', exact: true }).click();
  await page.getByRole('button', { name: 'Fuentes de datos', exact: true }).click();
  await expect(folders).toHaveValue('folder-a\nfolder-b');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(folders).toHaveValue('folder-a\nfolder-b');
  await page.getByRole('button', { name: 'Guardar fuentes de datos', exact: true }).click();
  await expect.poll(() => state.clients[0].automation.driveFolderIds).toEqual(['folder-a', 'folder-b']);
  expect(state.clients[0].automation.defaultBudgetUsd).toBe(4);
  expect(state.calls[0].input.automation).toEqual({ driveFolderIds: ['folder-a', 'folder-b'] });
  expect(state.calls[0].input.section).toBe('sources');
  await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Presupuesto por pedido (USD)' })).toHaveValue('6');
  await page.getByRole('button', { name: 'Guardar automatizaciones', exact: true }).click();
  await expect.poll(() => state.clients[0].automation.defaultBudgetUsd).toBe(6);
  expect(state.calls[1].input.section).toBe('automation');
  expect(state.calls[1].input.automation.driveFolderIds).toBeUndefined();
  expect(state.clients[0].automation.defaultMaleModelId).toBe('man');
  expect(state.clients[0].automation.defaultFemaleModelId).toBe('woman');
  expect(state.clients[0].automation.defaultModelId).toBe('man');
  expect(state.clients[0].automation.presets.custom.prompt).toBe('Conservar preset');
  expect(state.clients[0].automation.driveFolderIds).toEqual(['folder-a', 'folder-b']);
  expect(state.clients[0].automation.maxOperationalRetries).toBe(2);
  expect(state.calls[0].input.expectedAutomation.defaultBudgetUsd).toBe(4);
  await page.getByRole('button', { name: 'Fuentes de datos', exact: true }).click();
  await folders.fill('folder-a\nfolder-b\nfolder-c');
  await page.getByRole('button', { name: 'Automatizaciones', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Presupuesto por pedido (USD)' }).fill('7');
  await page.getByRole('button', { name: 'Guardar automatizaciones', exact: true }).click();
  await expect.poll(() => state.clients[0].automation.defaultBudgetUsd).toBe(7);
  expect(state.clients[0].automation.driveFolderIds).toEqual(['folder-a', 'folder-b']);
  await page.getByRole('button', { name: 'Fuentes de datos', exact: true }).click();
  await expect(folders).toHaveValue('folder-a\nfolder-b\nfolder-c');
  await page.getByRole('button', { name: 'Descartar cambios de esta pestaña', exact: true }).click();
  await expect(folders).toHaveValue('folder-a\nfolder-b');
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nombre del cliente' })).toHaveValue('Nombre pendiente');
  await page.getByRole('button', { name: 'Guardar datos generales' }).click();
  await expect(page.getByRole('heading', { name: 'Nombre pendiente' })).toBeVisible();
  expect(state.clients[0].generationPromptBase).toBe('Prompt conservado');
  await page.getByRole('button', { name: 'Marketplaces', exact: true }).click();
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue('MX');
  await amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' }).click();
  await amazon.getByRole('switch').click();
  await expect(amazon.getByRole('switch')).toBeChecked();
  const shein = page.getByRole('switch', { name: 'Habilitar SHEIN administrativamente' });
  await shein.click(); await expect(shein).toBeChecked();
  expect(state.clients[0].marketplaces.amazon.settings.region).toBe('MX');
  expect(state.calls.filter(call => call.name === 'marketplace')).toHaveLength(3);
  expect(state.calls.every(call => ['automation', 'marketplace', 'update'].includes(call.name))).toBe(true);
  await page.reload();
  await expect(amazon.getByRole('switch')).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/tuto-client-detail-mobile.png', fullPage: true });
});

test('marketplace drafts stay independent by client and channel, survive errors and save trimmed settings', async ({ page }) => {
  const state = await setup(page);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/clients/client-0?tab=marketplaces');
  const card = (name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const amazon = card('Amazon');
  const shein = card('SHEIN');
  await expect(page.getByRole('switch')).toHaveCount(4);
  for (const name of ['Amazon', 'SHEIN', 'TikTok Shop', 'Mercado Libre']) {
    await expect(card(name).getByRole('switch')).not.toBeChecked();
  }
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await shein.getByRole('button', { name: 'Configurar', exact: true }).click();
  await amazon.getByRole('textbox', { name: 'País o región' }).fill(' MX ');
  await amazon.getByRole('textbox', { name: 'Identificador de vendedor' }).fill(' amazon-seller ');
  await shein.getByRole('textbox', { name: 'País o región' }).fill(' US ');
  await shein.getByRole('textbox', { name: 'Identificador de vendedor' }).fill(' shein-seller ');
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.includes('%3Amarketplace%3A')).sort())).toEqual([
    'tuto:client-draft:v2:demo-clients:admin:client-0%3Amarketplace%3Aamazon',
    'tuto:client-draft:v2:demo-clients:admin:client-0%3Amarketplace%3Ashein',
  ]);

  await page.goto('/clients/client-1?tab=marketplaces');
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue('');
  await amazon.getByRole('textbox', { name: 'País o región' }).fill('BR');
  await page.goto('/clients/client-0?tab=marketplaces');
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await shein.getByRole('button', { name: 'Configurar', exact: true }).click();
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue(' MX ');
  await expect(shein.getByRole('textbox', { name: 'País o región' })).toHaveValue(' US ');

  state.controls.rejectMarketplace = true;
  await amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' }).click();
  await expect(amazon.getByRole('alert')).toContainText('No se pudo guardar el marketplace');
  await expect(amazon.getByText('Guardado', { exact: true })).toHaveCount(0);
  await expect(amazon.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue(' amazon-seller ');
  await expect(amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' })).toBeEnabled();
  expect(state.clients[0].marketplaces).toBeUndefined();

  state.controls.rejectMarketplace = false;
  await amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' }).click();
  await expect(amazon.getByText('Guardado', { exact: true })).toBeVisible();
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue('MX');
  await expect(amazon.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue('amazon-seller');
  await expect(amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' })).toBeDisabled();
  await expect(shein.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue(' shein-seller ');
  await expect(shein.getByRole('button', { name: 'Guardar ajustes de SHEIN' })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tuto:client-draft:v2:demo-clients:admin:client-0%3Amarketplace%3Aamazon'))).toBeNull();

  await shein.getByRole('button', { name: 'Guardar ajustes de SHEIN' }).click();
  await expect(shein.getByText('Guardado', { exact: true })).toBeVisible();
  await expect(shein.getByRole('button', { name: 'Guardar ajustes de SHEIN' })).toBeDisabled();
  expect(state.clients[0].marketplaces).toEqual({
    amazon: { enabled: false, settings: { region: 'MX', sellerId: 'amazon-seller' } },
    shein: { enabled: false, settings: { region: 'US', sellerId: 'shein-seller' } },
  });
  expect(state.calls.map(call => [call.name, call.input.clientId, call.input.marketplaceId])).toEqual([
    ['marketplace', 'client-0', 'amazon'], ['marketplace', 'client-0', 'amazon'], ['marketplace', 'client-0', 'shein'],
  ]);
  await page.reload();
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await shein.getByRole('button', { name: 'Configurar', exact: true }).click();
  await expect(amazon.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue('amazon-seller');
  await expect(shein.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue('shein-seller');
  await page.goto('/clients/client-1?tab=marketplaces');
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue('BR');
  expect(state.clients[1].marketplaces).toBeUndefined();
});

test('static create route, editing, confirmed archive and reactivation preserve the client', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/crear');
  await page.getByRole('textbox', { name: 'Nombre del cliente' }).fill('Nuevo cliente');
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click();
  await expect(page.getByText('Cliente creado con éxito')).toBeVisible();
  await page.getByRole('link', { name: 'Ver clientes' }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Nuevo cliente', exact: true }) });
  await row.getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/lista/);
  await page.getByRole('button', { name: 'Sí, archivar cliente' }).click();
  await expect(row).toHaveCount(0);
  await page.getByLabel('Mostrar archivados').click();
  await expect(page.getByLabel('Mostrar archivados')).toBeChecked();
  await row.getByRole('button', { name: 'Reactivar', exact: true }).click();
  await expect(row.getByText('Activo', { exact: true })).toBeVisible();
  expect(state.clients.find(client => client.id === 'new-client')).toBeTruthy();
  expect(state.calls.map(call => call.name)).toEqual(['create', 'archive', 'restore']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '/tmp/tuto-client-list-mobile.png', fullPage: true });
});

test('direct unavailable client and admin-only route gating', async ({ page }) => {
  const state = await setup(page, 'operador');
  await page.goto('/clients/client-0');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  expect(state.reads).toEqual([]);
  expect(state.calls).toEqual([]);
});

test('missing client handles direct URL and reload without writes', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/missing');
  await expect(page.getByRole('heading', { name: 'Cliente no disponible' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cliente no disponible' })).toBeVisible();
  expect(state.calls).toEqual([]);
});


test('save errors retain settings and do not change channel activation; read errors are visible', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/client-0?tab=marketplaces');
  await expect(page.getByRole('switch')).toHaveCount(4);
  const amazon = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Amazon', exact: true }) });
  state.controls.rejectMarketplace = true;
  await amazon.getByRole('switch').click();
  await expect(amazon.getByRole('alert')).toContainText('No se pudo guardar');
  await expect(amazon.getByRole('switch')).not.toBeChecked();
  state.controls.rejectMarketplace = false;
  await amazon.getByRole('switch').click();
  await expect(amazon.getByRole('switch')).toBeChecked();
  await page.evaluate(() => { document.documentElement.className = 'theme-light'; });
  await expect(page.locator('main .rounded-2xl').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: '/tmp/tuto-client-detail-light.png', fullPage: true, animations: 'disabled' });
  state.controls.readError = true;
  await page.goto('/clients/lista');
  await expect(page.getByRole('alert')).toContainText('Lectura no disponible');
});


test('marketplace conflict keeps the edited field and adopts untouched remote fields when resolving', async ({ page }) => {
  const state = await setup(page);
  state.clients[0].marketplaces = { amazon: { enabled: false, settings: { region: 'MX', sellerId: 'seller-old' } } };
  await page.goto('/clients/client-0?tab=marketplaces');
  const amazon = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Amazon', exact: true }) });
  await amazon.getByRole('button', { name: 'Configurar', exact: true }).click();
  await amazon.getByRole('textbox', { name: 'País o región' }).fill('US');
  state.clients[0].marketplaces.amazon.settings = { region: 'CA', sellerId: 'seller-new' };
  await amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' }).click();
  await expect(amazon.getByRole('alert')).toBeVisible();
  await expect(amazon.getByText('Guardado', { exact: true })).toHaveCount(0);
  await expect(amazon.getByRole('textbox', { name: 'País o región' })).toHaveValue('US');
  await expect(amazon.getByText(/Valores actuales: región CA/)).toBeVisible();
  await amazon.getByRole('button', { name: 'Conservar mi borrador y revisar antes de guardar' }).click();
  await expect(amazon.getByRole('textbox', { name: 'Identificador de vendedor' })).toHaveValue('seller-new');
  await amazon.getByRole('button', { name: 'Guardar ajustes de Amazon' }).click();
  await expect(amazon.getByText('Guardado', { exact: true })).toBeVisible();
  expect(state.calls.at(-1)!.input.settings).toEqual({ region: 'US' });
  expect(state.clients[0].marketplaces.amazon.settings).toEqual({ region: 'US', sellerId: 'seller-new' });
});

test('general settings conflict retains name and reviews remote prompt before resolving', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/clients/client-0?tab=configuracion');
  await page.getByRole('textbox', { name: 'Nombre del cliente' }).fill('Mi nombre');
  state.clients[0].name = 'Nombre remoto'; state.clients[0].generationPromptBase = 'Prompt remoto';
  await page.getByRole('button', { name: 'Guardar datos generales' }).click();
  await expect(page.getByText('Valores actuales en el servidor:')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nombre del cliente' })).toHaveValue('Mi nombre');
  await page.getByRole('button', { name: 'Conservar mi borrador y revisar antes de guardar' }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt base del cliente' })).toHaveValue('Prompt remoto');
  await page.getByRole('button', { name: 'Guardar datos generales' }).click();
  await expect(page.getByRole('status')).toHaveText('Datos generales guardados');
  expect(state.clients[0].name).toBe('Mi nombre'); expect(state.clients[0].generationPromptBase).toBe('Prompt remoto');
  expect(state.calls.at(-1)!.input.generationPromptBase).toBeUndefined();
});


test('directory presents loading, empty and read errors without losing filter controls', async ({ page }) => {
  const state = await setup(page);
  state.controls.readDelayMs = 500;
  await page.goto('/clients/lista');
  await expect(page.getByRole('status', { name: 'Cargando datos…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('searchbox', { name: 'Buscar por nombre' }).fill('Sin coincidencias');
  await expect(page.getByRole('heading', { name: 'No hay clientes que mostrar' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar por nombre' })).toHaveValue('Sin coincidencias');
  await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  state.controls.readError = true;
  await page.getByRole('searchbox', { name: 'Buscar por nombre' }).fill('Cliente');
  await expect(page.getByRole('alert')).toContainText('Lectura no disponible');
  await expect(page.getByRole('heading', { name: 'No se pudo cargar el directorio' })).toBeVisible();
  expect(state.calls).toEqual([]);
});
