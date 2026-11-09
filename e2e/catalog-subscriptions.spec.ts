import { test, expect, chromium, type Page } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

// Keep the owned phase-0 frontend and network firewall; instrument only its
// in-memory Firestore double. Retain cancelled callbacks to force late delivery.
async function instrumentSubscriptions(page: Page) {
  await page.route('**/e2e/support/local-fixtures.mjs*', async (route) => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace('export const orderBy = () => ({});',
        "export const orderBy = (field, direction) => ({ orderField: field, direction });")
      .replace('const docs = rows.map(snapshotDoc);', `
        const order = reference.constraints?.find(value => value.orderField);
        if (order) rows = [...rows].sort((a, b) => (a[order.orderField].toMillis() - b[order.orderField].toMillis()) * (order.direction === 'asc' ? 1 : -1));
        const docs = rows.map(snapshotDoc);`)
      .replace(/export const onSnapshot = [\s\S]*?(?=export const getDocs)/, `
        window.__catalogListeners = [];
        export const onSnapshot = (reference, callback, onError) => {
          const entry = { reference, callback, onError, active: true };
          window.__catalogListeners.push(entry);
          const emit = () => { if (entry.active) callback(snapshot(reference)); };
          listeners.add(emit);
          if (!(window.__catalogHoldPaths || []).includes(reference.path)
            || reference.kind !== 'doc' && reference.constraints.some(value => value.field === 'status')) queueMicrotask(emit);
          return () => { entry.active = false; listeners.delete(emit); };
        };
      `);
    await route.fulfill({ response, body: source + `
      records.batches.push({ ...batch, id: 'batch-b', createdAt: Timestamp.fromDate(new Date(now.getTime() + 1000)) },
        { ...batch, id: 'foreign-batch', clientId: 'another-client' });
      records.jobs.push({ ...job, id: 'job-b', batchId: 'batch-b', garmentId: 'garment-b', garmentName: 'Artículo B' },
        { ...job, id: 'pending-old', status: 'pending', garmentId: 'pending-old', garmentName: 'Pendiente anterior', createdAt: Timestamp.fromDate(new Date(now.getTime() - 2000)) },
        { ...job, id: 'pending-new', status: 'processing', garmentId: 'pending-new', garmentName: 'Pendiente nuevo', createdAt: Timestamp.fromDate(new Date(now.getTime() + 2000)) });
    ` });
  });
}

async function openCatalog(path = '?clientId=local-client&batchId=local-batch', holdPaths: string[] = []) {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 1000 } });
  const { page, baseURL } = isolated;
  await page.addInitScript((paths) => { (window as any).__catalogHoldPaths = paths; }, holdPaths);
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
        api.subscribeToCatalogBatchJobs('probe-batch', 'asc', (data: any) => events.jobs.push(data), (error: Error) => events.errors.push(error.message)),
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
        { field: 'batchId', op: '==', value: 'probe-batch' }, { orderField: 'createdAt', direction: 'asc' },
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
  const isolated = await openCatalog('?batchId=local-batch', ['batches/local-batch', 'jobs']);
  try {
    const { page } = isolated;
    await expect.poll(() => page.evaluate(() => (window as any).__catalogListeners.some((entry: any) => entry.reference.path === 'batches/local-batch'))).toBe(true);
    // Navigate before A's document/jobs have delivered their first snapshot.
    await page.evaluate(() => {
      history.pushState({}, '', '?batchId=batch-b');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('#catalog-client')).toHaveValue('local-client');
    await expect(page.locator('select').nth(1)).toHaveValue('batch-b');
    await page.evaluate(() => {
      const entry = (window as any).__catalogListeners.find((entry: any) => entry.active && entry.reference.path === 'jobs'
        && !entry.reference.constraints.some((value: any) => value.field === 'status')
        && entry.reference.constraints.some((value: any) => value.value === 'batch-b'));
      entry.callback({ docs: [{ id: 'pending-b', data: () => ({ batchId: 'batch-b', garmentId: 'pending-b', garmentName: 'Pendiente B', status: 'pending' }) }] });
    });
    await expect(page.locator('[title="Pendiente B"]')).toHaveCount(1);
    await page.evaluate(() => {
      for (const entry of (window as any).__catalogListeners) {
        if (entry.reference.path === 'batches/local-batch') {
          if (entry.active) throw new Error('A batch listener still active');
          entry.callback({ id: 'local-batch', exists: () => true, data: () => ({ clientId: 'wrong-client' }) });
        }
        if (entry.reference.path === 'jobs' && !entry.reference.constraints.some((value: any) => value.field === 'status')
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
          && !entry.reference.constraints.some((value: any) => value.field === 'status')
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
      entry.reference.path === 'jobs' && !entry.reference.constraints.some((value: any) => value.field === 'status')
    ).map((entry: any) => ({ active: entry.active, direction: entry.reference.constraints.find((value: any) => value.orderField).direction }))
    );
    expect(jobListeners.filter((entry: any) => entry.active)).toEqual([{ active: true, direction: 'asc' }]);
    expect(jobListeners.slice(0, -1).every((entry: any) => !entry.active && entry.direction === 'desc')).toBe(true);
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
