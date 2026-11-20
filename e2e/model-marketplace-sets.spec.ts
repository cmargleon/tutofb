import { expect, test, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('catalogue sets show native formats, exact missing shots, cost approval and targeted completion on mobile', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  const { page } = isolated;
  try {
  const mainModule = await (await page.request.get('/src/main.tsx')).text();
  const reactModule = mainModule.match(/from ["']([^"']*\/react\.js[^"']*)["']/)?.[1];
  const domModule = mainModule.match(/from ["']([^"']*react-dom_client\.js[^"']*)["']/)?.[1];
  if (!reactModule || !domModule) throw new Error('Inicia el servidor Vite de Tuto antes de ejecutar este test.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/https:\/\/.*(?:googleapis\.com|cloudfunctions\.net|run\.app)\//, route => route.abort());
  await page.route('**/src/features/storage/useStorageAssetUrl.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const useStorageAssetUrl = () => ({ url: null, loading: false, error: null });
  ` }));
  await page.route('**/src/features/models/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { modelBaseSpec } from '/shared/src/modelPhotoSets.ts';
    const channels = { amazon: { enabled: true }, 'tiktok-shop': { enabled: true } };
    export const previewModelPhotoSets = async input => {
      const shots = input.channels.flatMap(channel => ['front', 'front_three_quarter', 'commercial_back'].map(shot => {
        const spec = modelBaseSpec(channel, input.category, 'adult', input.bodyArea, shot, channels, input.aspectRatio || '3:4');
        const pose = window.__model.poses.find(p => p.marketplaceBaseSpec?.channel === channel && p.marketplaceBaseSpec?.shot === shot && p.marketplaceBaseSpec?.bodyArea === input.bodyArea);
        return { spec, poseId: pose?.id || null, candidatePoseIds: [], estimatedCostUsd: .08 };
      }));
      return { id: 'preview-' + input.channels.join(','), identitySha256: 'identity', provider: input.provider || 'fal-gpt-image-2.5-flare', shots, missing: shots.filter(s => !s.poseId).length, estimatedCostUsd: shots.filter(s => !s.poseId).length * .08, issues: [] };
    };
    export const approveModelIdentity = async () => {};
    export const verifyModelMarketplaceBase = async () => ({ approved: false, issues: ['Pose requerida: Tres cuartos frontal.'] });
    export const subscribeModelBaseOperations = (modelId, next) => {
      window.__opsNext = next;
      const op = JSON.parse(sessionStorage.getItem('operation') || 'null');
      next(op ? [op] : []);
      return () => { window.__opsNext = null; };
    };
    export const scheduleModelMarketplaceSets = async request => {
      const input = { ...request, ...request.combinations[0] };
      window.__generated.push(input);
      sessionStorage.setItem('generated', JSON.stringify(window.__generated));
      const spec = modelBaseSpec(input.channel, input.category, 'adult', input.bodyArea, input.shot, channels, input.aspectRatio || '3:4');
      const op = { id: 'operation', spec, identitySha256: 'identity', status: 'generating', attemptNumber: 1, attempts: [{ number: 1, prompt: 'original', generationCostUsd: .07 }] };
      sessionStorage.setItem('operation', JSON.stringify(op));
      window.__opsNext([op]);
      return { operationIds: ['operation'] };
    };
    window.__complete = () => {
      const op = JSON.parse(sessionStorage.getItem('operation'));
      const id = 'pose-1';
      op.status = 'approved'; op.attemptNumber = 2;
      op.attempts[0].verification = { approved: false, issues: ['Fondo requerido: white.'] };
      op.attempts.push({ number: 2, generationCostUsd: .07, reviewCostUsd: .003, verification: { approved: true, issues: [] } });
      sessionStorage.setItem('operation', JSON.stringify(op));
      window.__opsNext([op]);
      window.__model = { ...window.__model, poses: [...window.__model.poses, { id, storagePath: 'fixtures/' + id + '.png', fileName: id, marketplaceBaseSpec: op.spec }] };
      window.dispatchEvent(new Event('fixture-model'));
    };

  ` }));
  await page.route('**/model-set-preview', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module">
      import React from '${reactModule}';
      import ReactDOM from '${domModule}';
      const { useState, useEffect } = React;
      import { FeedbackProvider } from '/src/features/feedback/FeedbackProvider.tsx';
      import { ModelPhotoSets } from '/src/components/models/ModelPhotoSets.tsx';
      import '/src/index.css';
      window.__generated = JSON.parse(sessionStorage.getItem('generated') || '[]');
      window.__model = { id: 'model', name: 'Modelo', clientId: 'client', identityTraits: { age: '30' }, approvedIdentity: { poseId: 'identity', sha256: 'identity' }, poses: [{ id: 'identity', fileName: 'Identidad elegida', storagePath: 'fixtures/identity.png' }] };
      const client = { id: 'client', name: 'Cliente', marketplaces: { amazon: { enabled: true }, 'tiktok-shop': { enabled: true } } };
      function Preview() { const [model, setModel] = useState(window.__model); useEffect(() => { const update = () => setModel(window.__model); window.addEventListener('fixture-model', update); return () => window.removeEventListener('fixture-model', update); }, []); return React.createElement(FeedbackProvider, null, React.createElement(ModelPhotoSets, { model, client })); }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
    </script></body></html>` }));
  await page.goto('/model-set-preview');
  await expect(page.getByText('0 / 6 tomas aprobadas')).toBeVisible();
  await expect(page.getByText(/Portada · Blanco puro · 1:1/)).toBeVisible();
  await expect(page.getByText(/Portada · Blanco puro · 3:4/)).toBeVisible();
  await expect(page.getByText('Tres cuartos frontal', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Espalda comercial', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Generar toma/ }).first().click();
  await expect(page.getByText(/Estimación inicial USD 0.080; máximo previsto USD 0.240/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__generated.length)).toBe(0);
  await page.getByRole('button', { name: 'Generar estas bases', exact: true }).click();
  await expect(page.getByText('Generando · intento 1 de 3', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Generando · intento 1 de 3', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__generated.length)).toBe(1);
  await page.evaluate(() => (window as any).__complete());
  await expect(page.getByText('1 / 6 tomas aprobadas')).toBeVisible();
  await page.getByText('Historial de intentos y costos').click();
  await expect(page.getByText('Fondo requerido: white.')).toBeVisible();
  await expect(page.getByText(/Intento 2 · generación/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__generated.map((i: any) => [i.channel, i.shot]))).toEqual([['amazon', 'front']]);
  await page.getByLabel(/Zona corporal/).selectOption('lower_body');
  await expect(page.getByText('0 / 6 tomas aprobadas')).toBeVisible();
  await expect(page.getByText(/Galería · Neutro.*Sin rostro/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/tuto-model-sets-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: '/tmp/tuto-model-sets-desktop.png', fullPage: true });
  } finally { await isolated.close(); }
});
