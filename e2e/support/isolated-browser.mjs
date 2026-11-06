import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixturePath = fileURLToPath(new URL('./local-fixtures.mjs', import.meta.url));
const blocked = message => new Error(`BLOCKED before login/navigation: ${message}`);

export function requireLoopback(value) {
  let url;
  try { url = new URL(value); } catch { throw blocked('invalid target URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw blocked('target must use a literal loopback address');
  return url;
}

export async function startIsolatedFrontend() {
  // Reject inherited remote overrides before starting a server or browser.
  if (process.env.PLAYWRIGHT_BASE_URL) requireLoopback(process.env.PLAYWRIGHT_BASE_URL);
  const nonce = randomUUID();
  const roleSource = await readFile(`${root}src/features/auth/AuthProvider.tsx`, 'utf8');
  const role = roleSource.slice(roleSource.indexOf('export const useRole'), roleSource.indexOf('export type RoleCapabilities'));
  const fixtures = await readFile(fixturePath, 'utf8');
  const server = await createServer({
    root, configFile: false, envFile: false, logLevel: 'error',
    plugins: [{
      name: 'tuto-isolated-browser-fixtures', enforce: 'pre',
      resolveId(source) {
        if (['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage', 'firebase/functions'].includes(source)) return fixturePath;
      },
      load(id) {
        const path = id.split('?')[0];
        if (path === fixturePath) return fixtures;
        if (path === `${root}src/firebase.ts`) return `export { auth, db, storage, functions } from ${JSON.stringify(fixturePath)};`;
        if (path === `${root}firebase-applet-config.json`) return JSON.stringify({ projectId: 'demo-local-browser' });
        if (path === `${root}src/sentry.ts`) return 'export const initSentry = () => {}; export const reportError = () => {};';
        if (path === `${root}src/features/auth/AuthProvider.tsx`) return `
          import { user } from ${JSON.stringify(fixturePath)};
          export const useAuth = () => ({ user, appUser: { ...user, role: 'admin', active: true }, loading: false });
          export const AuthProvider = ({ children }) => children;
          ${role}`;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url === '/__tuto_isolation') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ nonce, mode: 'local-doubles' })); return; }
          if (req.url === '/__tuto_external_redirect') { res.statusCode = 302; res.setHeader('Location', 'https://example.invalid/login'); res.end(); return; }
          if (req.url === '/__tuto_fixture.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80"><rect width="60" height="80" fill="teal"/></svg>'); return; }
          next();
        });
      },
    }, react(), tailwindcss()],
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-router-dom', 'lucide-react', 'recharts', 'uuid', 'file-saver', 'jszip'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, open: false },
  });
  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = server.httpServer.address();
  const baseURL = `http://127.0.0.1:${address.port}`;
  return { baseURL, nonce, close: () => server.close() };
}

export async function createIsolatedContext(browser, frontend, options = {}) {
  // Both checks precede context creation, page navigation and any data entry.
  const target = requireLoopback(process.env.PLAYWRIGHT_BASE_URL || frontend.baseURL);
  if (target.origin !== frontend.baseURL || target.pathname !== '/' || target.search || target.hash) throw blocked('target is not the owned fixture frontend');
  let proof;
  try {
    const response = await fetch(`${target.origin}/__tuto_isolation`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    proof = await response.json();
  } catch { throw blocked('frontend isolation proof unavailable'); }
  if (proof.nonce !== frontend.nonce || proof.mode !== 'local-doubles') throw blocked('frontend isolation proof missing');
  const context = await browser.newContext({ ...options, baseURL: frontend.baseURL, serviceWorkers: 'block' });
  const allowed = value => {
    try { return requireLoopback(value).origin === frontend.baseURL; } catch { return false; }
  };
  await context.route('**/*', async route => {
    if (!allowed(route.request().url())) return route.abort('blockedbyclient');
    // Never let the browser or APIRequestContext follow an unchecked redirect.
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers().location;
    if (location && !allowed(new URL(location, route.request().url()).href)) return route.abort('blockedbyclient');
    return route.fulfill({ response, headers: {
      ...response.headers(),
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'; form-action 'self'; base-uri 'self'",
    } });
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  return context;
}

export async function openIsolatedBrowser(chromium, options = {}) {
  const frontend = await startIsolatedFrontend();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--dns-prefetch-disable', '--no-proxy-server'] });
    const context = await createIsolatedContext(browser, frontend, options);
    const page = await context.newPage();
    return { page, context, baseURL: frontend.baseURL, close: async () => { await browser.close(); await frontend.close(); } };
  } catch (error) {
    await browser?.close(); await frontend.close(); throw error;
  }
}
