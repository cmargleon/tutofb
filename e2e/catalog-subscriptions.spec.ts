import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { test, expect, chromium, type Page } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

// Keep the owned phase-0 frontend and network firewall; instrument only its
// in-memory Firestore double. Retain cancelled callbacks to force late delivery.
async function instrumentSubscriptions(page: Page) {
  await page.route('**/e2e/support/local-fixtures.mjs*', async (route) => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace(/export const orderBy = [^;]+;/,
        "export const orderBy = (field, direction) => ({ orderField: field, direction });")
      .replace('const docs = rows.map(snapshotDoc);', `
        const order = reference.constraints?.find(value => value.orderField);
        if (order) {
          const sortValue = row => row[order.orderField]?.toMillis?.() ?? row[order.orderField];
          rows = [...rows].sort((a, b) => {
            const left = sortValue(a);
            const right = sortValue(b);
            return (left < right ? -1 : left > right ? 1 : 0) * (order.direction === 'asc' ? 1 : -1);
          });
        }
        const docs = rows.map(snapshotDoc);`)
      .replace("  if (name === 'listClients')", `  if (name === 'selectJobOutput') {
          const selectedJob = records.jobs.find(item => item.id === input.jobId);
          const output = records['jobs/' + input.jobId + '/outputs'].find(item => item.id === input.outputId);
          Object.assign(selectedJob, { userSelectedOutputId: output.id, userSelectedOutput: output });
          listeners.forEach(emit => emit());
          return { data: { success: true } };
        }
        if (name === 'listClients')`)
      .replace(/export const onSnapshot = [\s\S]*?(?=export const getDocs)/, `
        window.__catalogListeners = [];
        export const onSnapshot = (reference, callback, onError) => {
          const entry = { reference, callback, onError, active: true };
          window.__catalogListeners.push(entry);
          const emit = () => { if (entry.active) callback(snapshot(reference)); };
          listeners.add(emit);
          const heldPaths = window.__catalogHoldPaths || [];
          const batchId = reference.constraints?.find(value => value.field === 'batchId')?.value;
          if (!heldPaths.includes(reference.path) && !heldPaths.includes('jobs/' + batchId)) queueMicrotask(emit);
          return () => { entry.active = false; listeners.delete(emit); };
        };
      `);
    await route.fulfill({ response, body: source + `
      records.clients.push({ ...client, id: 'another-client', name: 'Otro cliente' });
      records.batches.push({ ...batch, id: 'batch-b', createdAt: Timestamp.fromDate(new Date(now.getTime() + 1000)) },
        { ...batch, id: 'foreign-batch', clientId: 'another-client' });
      records.jobs.push({ ...job, id: 'job-b', batchId: 'batch-b', garmentId: 'garment-b', garmentName: 'Artículo B' },
        { ...job, id: 'foreign-job', batchId: 'foreign-batch', clientId: 'another-client', garmentId: 'foreign-garment', garmentName: 'Artículo de otro cliente' },
        { ...job, id: 'pending-b', batchId: 'batch-b', status: 'pending', currentOutput: null, garmentId: 'pending-b', garmentName: 'Pendiente B' },
        { ...job, id: 'pending-old', status: 'pending', garmentId: 'pending-old', garmentName: 'Pendiente anterior', createdAt: Timestamp.fromDate(new Date(now.getTime() - 2000)) },
        { ...job, id: 'pending-new', status: 'processing', garmentId: 'pending-new', garmentName: 'Pendiente nuevo', createdAt: Timestamp.fromDate(new Date(now.getTime() + 2000)) });
      window.__addCatalogArticle = (article, poses, timeOffset, status = 'completed') => {
        for (let pose = 0; pose < poses; pose++) {
          const id = article + '-' + pose;
          records.jobs.push({ ...job, id, garmentId: article, garmentName: article, status,
            createdAt: Timestamp.fromDate(new Date(now.getTime() + timeOffset)),
            modelNameSnapshot: 'Modelo',
            currentOutput: status === 'completed' ? { ...job.currentOutput, resultImagePath: location.origin + '/__tuto_fixture.svg?pose=' + encodeURIComponent(id) } : null });
        }
        listeners.forEach(emit => emit());
      };
      if (window.__catalogLargeBatch) {
        for (let index = 0; index < 80; index++) window.__addCatalogArticle('Sintético ' + index, 6, -3000 - index);
        records['jobs/Sintético 79-5/outputs'] = [{
          ...job.currentOutput, id: 'historical-output', createdAt: stamp, resultImagePath: 'fixtures/history.svg',
          autoReview: { verdict: 'approved' },
        }];
      }
    ` });
  });
}

async function openCatalog(path = '?clientId=local-client&batchId=local-batch', holdPaths: string[] = [], largeBatch = false) {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 1000 } });
  const { page, baseURL } = isolated;
  await page.addInitScript(({ holdPaths, largeBatch }) => {
    (window as any).__catalogHoldPaths = holdPaths;
    (window as any).__catalogLargeBatch = largeBatch;
  }, { holdPaths, largeBatch });
  await instrumentSubscriptions(page);
  await page.goto(`${baseURL}/catalogo${path}`);
  await page.waitForLoadState('networkidle');
  return { ...isolated, close: async () => {
    await page.unrouteAll({ behavior: 'wait' });
    await isolated.context.unrouteAll({ behavior: 'wait' });
    await isolated.close();
  } };
}

test('typed catalog helpers preserve queries, ID precedence, null, errors and unsubscribe', async () => {
  const isolated = await openCatalog();
  try {
    const result = await isolated.page.evaluate(async () => {
      const modulePath = '/src/features/catalog/firebase.ts';
      const api = await import(/* @vite-ignore */ modulePath);
      const events: any = { batch: [], jobs: [], job: [], errors: [] };
      const start = (window as any).__catalogListeners.length;
      const subscriptions = [
        api.subscribeToCatalogBatch('probe-batch', (data: any) => events.batch.push(data), (error: Error) => events.errors.push(error.message)),
        api.subscribeToCatalogBatchJobs('probe-client', 'probe-batch', 'asc', (data: any) => events.jobs.push(data), (error: Error) => events.errors.push(error.message)),
        api.subscribeToCatalogJob('probe-job', (data: any) => events.job.push(data), (error: Error) => events.errors.push(error.message)),
      ];
      // Let initial missing/empty snapshots settle, then assert explicit payloads.
      await Promise.resolve(); await Promise.resolve();
      events.batch = []; events.jobs = []; events.job = [];
      const entries = (window as any).__catalogListeners.slice(start).filter((entry: any) => !entry.reference.path.startsWith('users/')).sort((a: any, b: any) => { const rank = (ref: any) => ref.path === 'batches/probe-batch' ? 0 : ref.path === 'jobs' ? 1 : 2; return rank(a.reference) - rank(b.reference); });
      const document = { id: 'snapshot-id', exists: () => true, data: () => ({ id: 'stored-id', status: 'pending' }) };
      entries[0].callback(document);
      entries[1].callback({ docs: [document] });
      entries[2].callback(document);
      entries[0].callback({ exists: () => false });
      entries[2].callback({ exists: () => false });
      const failure = new Error('listener failure');
      entries.forEach((entry: any) => entry.onError(failure));
      const before = JSON.stringify(events);
      subscriptions.forEach((unsubscribe: () => void) => unsubscribe());
      // Both data and error callbacks deliberately fire after unsubscribe.
      entries.forEach((entry: any, i: number) => {
        entry.callback(i === 1 ? { docs: [document] } : document);
        entry.onError(new Error('late failure'));
      });
      return { events, references: entries.map((entry: any) => entry.reference),
        cancelled: entries.every((entry: any) => !entry.active), unchanged: before === JSON.stringify(events) };
    });
    expect(result.events).toEqual({ batch: [{ id: 'snapshot-id', status: 'pending' }, null],
      jobs: [[{ id: 'stored-id', status: 'pending' }]], job: [{ id: 'stored-id', status: 'pending' }, null],
      errors: ['listener failure', 'listener failure', 'listener failure'] });
    expect(result.references).toEqual([
      { path: 'batches/probe-batch', kind: 'doc' },
      { path: 'jobs', kind: 'collection', constraints: [
        { field: 'clientId', op: '==', value: 'probe-client' },
        { field: 'batchId', op: '==', value: 'probe-batch' },
        { field: 'status', op: 'in', value: ['completed', 'failed', 'pending', 'processing'] },
        { orderField: 'createdAt', direction: 'asc' },
      ] },
      { path: 'jobs/probe-job', kind: 'doc' },
    ]);
    expect(result.cancelled).toBe(true);
    expect(result.unchanged).toBe(true);
  } finally { await isolated.close(); }
});

test('URL-only valid batch resolves its client and keeps the requested batch', async () => {
  const isolated = await openCatalog('?batchId=local-batch');
  try {
    const { page } = isolated;
    await expect(page.locator('#catalog-client')).toHaveValue('local-client');
    await expect(page.locator('select').nth(1)).toHaveValue('local-batch');
    await expect(page.locator('[role="button"][title="Artículo local"]')).toHaveCount(2);
    expect(new URL(page.url()).searchParams.get('batchId')).toBe('local-batch');
  } finally { await isolated.close(); }
});

for (const [batchId, message] of [
  ['missing-batch', 'El lote solicitado no está disponible.'],
  ['foreign-batch', 'El lote solicitado pertenece a otro cliente.'],
] as const) {
  test(`URL batch validation: ${batchId}`, async () => {
    const isolated = await openCatalog(`?clientId=local-client&batchId=${batchId}`);
    try {
      await expect(isolated.page.getByText(message, { exact: true })).toBeVisible();
      expect(new URL(isolated.page.url()).searchParams.get('batchId')).toBe(batchId);
      expect(new URL(isolated.page.url()).searchParams.get('clientId')).toBe('local-client');
    } finally { await isolated.close(); }
  });
}

test('rapid A → B and order changes dispose listeners and reject late A data/errors', async () => {
  const isolated = await openCatalog('?clientId=local-client&batchId=local-batch', ['batches/local-batch', 'jobs/local-batch']);
  try {
    const { page } = isolated;
    await expect.poll(() => page.evaluate(() => (window as any).__catalogListeners.some((entry: any) => entry.active
      && entry.reference.path === 'jobs' && entry.reference.constraints.some((value: any) => value.value === 'local-batch')))).toBe(true);
    // Navigate before A's document/jobs have delivered their first snapshot.
    await page.evaluate(() => {
      history.pushState({}, '', '?batchId=batch-b');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#catalog-client')).toHaveValue('local-client');
    await expect(page.locator('select').nth(1)).toHaveValue('batch-b');
    await expect(page.locator('[title="Pendiente B"]')).toHaveCount(1);
    await page.evaluate(() => {
      for (const entry of (window as any).__catalogListeners) {
        if (entry.reference.path === 'batches/local-batch') {
          if (entry.active) throw new Error('A batch listener still active');
          entry.callback({ id: 'local-batch', exists: () => true, data: () => ({ clientId: 'wrong-client' }) });
        }
        if (entry.reference.path === 'jobs'
          && entry.reference.constraints.some((value: any) => value.value === 'local-batch')) {
          if (entry.active) throw new Error('A jobs listener still active');
          entry.callback({ docs: [{ id: 'late-a', data: () => ({ garmentId: 'late-a', garmentName: 'Late A', status: 'pending' }) }] });
        }
      }
    });
    await expect(page.locator('[title="Artículo B"]')).toHaveCount(1);
    await expect(page.getByText('Late A', { exact: true })).toHaveCount(0);
    await expect(page.locator('[title="Pendiente B"]')).toHaveCount(1);
    await page.evaluate(() => {
      for (const entry of (window as any).__catalogListeners) {
        if (entry.reference.path === 'batches/local-batch' || entry.reference.path === 'jobs'
          && entry.reference.constraints.some((value: any) => value.value === 'local-batch')) {
          entry.onError(new Error('late A failure'));
        }
      }
    });
    await expect(page.locator('[title="Pendiente B"]')).toHaveCount(1);
    await expect(page.getByText('No se pudo cargar el lote solicitado.', { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('clientId')).toBe('local-client');
    expect(new URL(page.url()).searchParams.get('batchId')).toBe('batch-b');

    // Return to A with automatic delivery to exercise the actual visual order.
    await page.evaluate(() => { (window as any).__catalogHoldPaths = []; });
    await page.locator('select').nth(1).selectOption('local-batch');
    const thumbnails = page.locator('[role="button"][title]');
    await expect(thumbnails.first()).toHaveAttribute('title', 'Pendiente nuevo');
    await page.locator('select').nth(3).selectOption('asc');
    await expect(thumbnails.first()).toHaveAttribute('title', 'Pendiente anterior');
    const jobListeners = await page.evaluate(() => (window as any).__catalogListeners.filter((entry: any) =>
      entry.reference.path === 'jobs'
    ).map((entry: any) => ({ active: entry.active, direction: entry.reference.constraints.find((value: any) => value.orderField).direction }))
    );
    expect(jobListeners.filter((entry: any) => entry.active)).toEqual([{ active: true, direction: 'asc' }]);
    expect(jobListeners.slice(0, -1).every((entry: any) => !entry.active && entry.direction === 'desc')).toBe(true);

    await page.evaluate(() => {
      history.pushState({}, '', '?clientId=another-client&batchId=foreign-batch');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('[title="Artículo de otro cliente"]')).toHaveCount(1);
    await expect(thumbnails).toHaveCount(1);
    const activeScopes = await page.evaluate(() => (window as any).__catalogListeners
      .filter((entry: any) => entry.active && entry.reference.path === 'jobs')
      .map((entry: any) => entry.reference.constraints.find((value: any) => value.field === 'clientId').value));
    expect(activeScopes).toEqual(['another-client']);
  } finally { await isolated.close(); }
});

test('lightbox open, next, close and selection changes dispose the active job subscription', async () => {
  const isolated = await openCatalog();
  try {
    const { page } = isolated;
    await page.locator('[role="button"][title="Artículo local"]').first().click();
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__catalogListeners.some((entry: any) => entry.reference.path === 'jobs/local-job' && entry.active))).toBe(true);
    await page.getByRole('button', { name: 'Imagen siguiente', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__catalogListeners.some((entry: any) => entry.reference.path === 'jobs/local-detail-job' && entry.active))).toBe(true);
    expect(await page.evaluate(() => (window as any).__catalogListeners.filter((entry: any) => entry.reference.path === 'jobs/local-job').every((entry: any) => !entry.active))).toBe(true);
    await page.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toHaveCount(0);
    await page.locator('[role="button"][title="Artículo local"]').first().click();
    await page.locator('select').nth(1).selectOption('batch-b');
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__catalogListeners.filter((entry: any) => entry.reference.kind === 'doc' && entry.reference.path.startsWith('jobs/')).every((entry: any) => !entry.active))).toBe(true);
    await page.locator('[role="button"][title="Artículo B"]').click();
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const entries = (window as any).__catalogListeners;
      // Leave B visible through its live fallback, so a stale A update is observable.
      entries.filter((entry: any) => entry.reference.path === 'jobs' && entry.active).forEach((entry: any) => entry.callback({ docs: [] }));
      entries.filter((entry: any) => entry.reference.kind === 'doc' && entry.reference.path.startsWith('jobs/') && !entry.active).forEach((entry: any) => {
        entry.onError(new Error('late lightbox A error'));
        entry.callback({ id: 'late-a', exists: () => true, data: () => ({ garmentName: 'Late A', status: 'pending' }) });
      });
    });
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
    await expect(page.locator('img[alt="Artículo B"]').first()).toBeVisible();
  } finally { await isolated.close(); }
});

for (const failure of ['missing', 'error'] as const) {
  test(`lightbox ${failure} clears only the live fallback, silently`, async () => {
    const isolated = await openCatalog();
    try {
      const { page } = isolated;
      await page.locator('[role="button"][title="Artículo local"]').first().click();
      await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
      // With an indexed job present, missing/error live data must keep the modal.
      await page.evaluate((failure) => {
        const entry = (window as any).__catalogListeners.find((entry: any) => entry.reference.path === 'jobs/local-job' && entry.active);
        if (failure === 'error') entry.onError(new Error('lightbox read failed'));
        else entry.callback({ exists: () => false });
      }, failure);
      await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
      // Restore live data, then remove all indexed jobs; the live fallback remains.
      await page.evaluate(() => {
        const entries = (window as any).__catalogListeners;
        entries.find((entry: any) => entry.reference.path === 'jobs/local-job' && entry.active).callback({
          id: 'local-job', exists: () => true, data: () => ({ batchId: 'local-batch', clientId: 'local-client', garmentId: 'local-garment', garmentName: 'Live fallback', status: 'pending', provider: 'fal-gpt-image-2' }),
        });
        entries.filter((entry: any) => entry.reference.path === 'jobs' && entry.active).forEach((entry: any) => entry.callback({ docs: [] }));
      });
      await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
      await page.evaluate((failure) => {
        const entry = (window as any).__catalogListeners.find((entry: any) => entry.reference.path === 'jobs/local-job' && entry.active);
        if (failure === 'error') entry.onError(new Error('lightbox read failed'));
        else entry.callback({ exists: () => false });
      }, failure);
      await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toHaveCount(0);
      await expect(page.getByText('lightbox read failed', { exact: true })).toHaveCount(0);
    } finally { await isolated.close(); }
  });
}

test('large batch defers offscreen galleries and keeps review anchored by job when new results arrive', async () => {
  const isolated = await openCatalog(undefined, [], true);
  try {
    const { page } = isolated;
    await expect(page.getByText('484 jobs visibles').first()).toBeVisible();
    const farArticle = page.getByRole('button', { name: 'Sintético 79 (6)', exact: true });
    await expect(farArticle).toHaveCount(1);
    await expect(page.locator('[role="button"][title="Sintético 79"]')).toHaveCount(0);
    expect(await page.locator('[role="button"][title^="Sintético "]').count()).toBeLessThan(60);

    // Download all six poses while the gallery is still deferred.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      farArticle.locator('..').getByRole('button', { name: 'Descargar', exact: true }).evaluate((button: HTMLButtonElement) => button.click()),
    ]);
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    expect(Object.values(zip.files).filter((entry) => !entry.dir)).toHaveLength(6);
    await expect(page.locator('[role="button"][title="Sintético 79"]')).toHaveCount(0);

    await page.locator('[role="button"][title="Artículo local"]').last().click();
    const next = page.getByRole('button', { name: 'Imagen siguiente', exact: true });
    await next.click();
    const activeReviewJob = () => page.evaluate(() => (window as any).__catalogListeners
      .find((entry: any) => entry.active && entry.reference.kind === 'doc' && entry.reference.path.startsWith('jobs/'))?.reference.path);
    await expect.poll(activeReviewJob).toBe('jobs/pending-old');
    await page.evaluate(() => (window as any).__addCatalogArticle('Resultado nuevo', 1, 5000));
    await expect(page.getByText('485 jobs visibles').first()).toBeAttached();
    await expect.poll(activeReviewJob).toBe('jobs/pending-old');
    await next.click();
    await expect.poll(activeReviewJob).toBe('jobs/Sintético 0-0');

    await page.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    await farArticle.scrollIntoViewIfNeeded();
    await expect(page.locator('[role="button"][title="Sintético 79"]')).toHaveCount(6);
    await page.locator('[role="button"][title="Sintético 79"]').last().click();
    await expect.poll(activeReviewJob).toBe('jobs/Sintético 79-5');
    await expect(next).toHaveCount(0);
    const historicalOutput = page.getByLabel('Salida aprobada por Gemini', { exact: true });
    await historicalOutput.click();
    await expect.poll(() => page.evaluate(() => (window as any).__localCalls.filter((entry: any) => entry.name === 'selectJobOutput')))
      .toEqual([{ name: 'selectJobOutput', input: { jobId: 'Sintético 79-5', outputId: 'historical-output' } }]);
    await page.getByRole('button', { name: 'Cerrar modal', exact: true }).click();
    await page.locator('[role="button"][title="Sintético 79"]').last().click();
    await expect(page.getByLabel('Salida aprobada por Gemini y seleccionada', { exact: true })).toBeVisible();
  } finally { await isolated.close(); }
});
