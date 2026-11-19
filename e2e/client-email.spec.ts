import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, loseResponse = false, view: 'client' | 'settings' = 'client', connected = true) {
  page.on('pageerror', error => console.error('Email preview:', error.message));
  const main = await (await page.request.get('/src/main.tsx')).text();
  const react = main.match(/from ["']([^"']*\/react\.js[^"']*)/)![1];
  const dom = main.match(/from ["']([^"']*\/react-dom_client\.js[^"']*)/)![1];
  const router = (await (await page.request.get('/src/app/AppRouter.tsx')).text()).match(/from ["']([^"']*react-router-dom[^"']*)/)![1];
  const hook = await (await page.request.get('/src/features/email/useClientEmail.ts')).text();
  const feedback = hook.match(/from ["']([^"']*\/FeedbackProvider\.tsx[^"']*)/)![1];
  const calls: any[] = [];
  const receipts = new Map<string, any>();
  await page.exposeFunction('__emailConnection', () => ({ sender: 'contacto@agenciamanglar.mx', connected }));
  await page.exposeFunction('__emailDisconnect', () => { connected = false; return { disconnected: true }; });
  await page.exposeFunction('__emailConnect', (args: any[]) => { calls.push({ action: 'connect', args }); return { url: 'https://accounts.google.com/email-test' }; });
  await page.route('https://accounts.google.com/email-test', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Autorización simulada</h1>' }));
  await page.exposeFunction('__emailSend', (input: any) => {
    calls.push(input);
    const receipt = { id: input.requestId, to: input.to, subject: input.subject, status: 'sent', createdAt: new Date().toISOString() };
    receipts.set(input.requestId, receipt);
    if (loseResponse && calls.length === 1) throw new Error('Se perdió la respuesta. Consulta el intento.');
    return receipt;
  });
  await page.exposeFunction('__emailHistory', () => ({ messages: [...receipts.values()] }));
  await page.route('**/src/features/auth/AuthProvider.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useRole = () => ({ isAdmin: true }); export const useAuth = () => ({ user: { uid: 'isolated-admin' } });` }));
  await page.route('**/src/features/email/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const getGmailConnection = () => window.__emailConnection();
    export const listClientEmails = () => window.__emailHistory();
    export const sendClientEmail = input => window.__emailSend(input);
    export const startGmailConnection = (...args) => window.__emailConnect(args);
    export const disconnectGmail = () => window.__emailDisconnect();
  ` }));
  await page.route('http://localhost:3000/email-preview*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">import React from '${react}'; import ReactDOM from '${dom}'; import { BrowserRouter } from '${router}'; import { FeedbackProvider } from '${feedback}'; import { ClientEmail } from '/src/components/clients/ClientEmail.tsx'; import { GmailSettings } from '/src/components/settings/GmailSettings.tsx'; import '/src/index.css';
    const client = { id: 'test-client', name: 'Cliente de prueba', status: 'active', contacts: [{ name: 'Ana', email: 'ana@example.com' }] };
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(FeedbackProvider, null, React.createElement('main', { style: { padding: 20, maxWidth: 1100, margin: 'auto' } }, ${view === 'client' ? 'React.createElement(ClientEmail, { client })' : 'React.createElement(GmailSettings)'}))));</script></body></html>` }));
  await page.goto('/email-preview');
  return calls;
}

test('manual email requires review and displays the accepted send in history', async ({ page }) => {
  const calls = await setup(page);
  await expect(page.getByRole('button', { name: /conectar/i })).toHaveCount(0);
  await page.getByLabel('Asunto', { exact: true }).fill('Tus fotografías están listas');
  await page.getByLabel('Mensaje', { exact: true }).fill('Hola Ana, tus fotografías están listas.\nSaludos, Manglar.');
  await page.getByRole('button', { name: 'Revisar correo', exact: true }).click();
  expect(calls).toHaveLength(0);
  await expect(page.getByText('ana@example.com', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Enviar correo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escribir otro correo' })).toBeVisible();
  await expect(page.getByText('Correo enviado', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].to).toBe('ana@example.com');
  await expect(page.getByRole('list').getByText('Tus fotografías están listas', { exact: true })).toBeVisible();
});

test('an unconnected client points to global settings without a connect button', async ({ page }) => {
  await setup(page, false, 'client', false);
  await expect(page.getByRole('link', { name: 'Ir a configuración de correo' })).toHaveAttribute('href', '/configuracion#correo');
  await expect(page.getByRole('button', { name: /conectar/i })).toHaveCount(0);
});

test('global settings disconnect and reconnect the mailbox without a client', async ({ page }) => {
  const calls = await setup(page, false, 'settings');
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desconectar', exact: true }).click();
  await expect(page.getByText('Pendiente de conectar', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conectar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Autorización simulada' })).toBeVisible();
  expect(calls).toEqual([{ action: 'connect', args: [] }]);
});

test('a lost response survives reload and consults the same send id; mobile layout stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page, true);
  await page.getByLabel('Asunto', { exact: true }).fill('Entrega');
  await page.getByLabel('Mensaje', { exact: true }).fill('Hola Ana.');
  await page.getByRole('button', { name: 'Revisar correo', exact: true }).click();
  await page.getByRole('button', { name: 'Enviar correo', exact: true }).click();
  await expect(page.getByText('Se perdió la respuesta. Consulta el intento.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Consultar intento de envío', exact: true }).click();
  await expect(page.getByText('Correo enviado', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/tutofb-client-email-mobile.png', fullPage: true });
});
