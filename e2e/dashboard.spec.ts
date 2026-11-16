import { chromium, expect, test } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

const assigned = { mode: 'assigned', clientIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'local-client'] };
const link = '/catalogo?clientId=local-client&batchId=local-batch';

for (const scenario of [
  { role: 'admin', clients: assigned, waiting: 56, health: true, manage: true },
  { role: 'operador', clients: assigned, waiting: 55, health: false, manage: true },
  { role: 'revisor', clients: assigned, waiting: 55, health: false, manage: false },
  { role: 'revisor', clients: { mode: 'global' }, waiting: 56, health: true, manage: false },
]) {
  test(`Inicio aplica el alcance de ${scenario.role} (${scenario.clients.mode})`, async () => {
    const browser = await openIsolatedBrowser(chromium, { realAuth: true });
    const { page } = browser;
    try {
      await page.addInitScript(({ role, clientAccess }) => {
        Object.assign(window, { __dashboardFixture: { role, clientAccess } });
      }, { role: scenario.role, clientAccess: scenario.clients });
      await page.goto('/');
      const total = page.getByRole('region', { name: 'Totales de generación' });
      await expect(total.getByText(String(scenario.waiting), { exact: true })).toBeVisible();
      await expect(total.getByText('0', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Estado del sistema' })).toHaveCount(scenario.health ? 1 : 0);

      const review = page.getByRole('article', { name: 'Pendiente de revisión' });
      await expect(review.getByText('1', { exact: true })).toBeVisible();
      await expect(review.getByRole('link')).toHaveAttribute('href', link);
      const incidents = page.getByRole('article', { name: 'Bloqueado o con incidencias' });
      await expect(incidents.getByText('3', { exact: true })).toBeVisible();
      await expect(incidents.getByRole('link', { name: scenario.manage ? /Gestionar lote/ : /Ver lote/ })).toHaveAttribute('href', link);
      const exports = page.getByRole('article', { name: 'Listo para exportar' });
      await expect(exports.getByText('1', { exact: true })).toBeVisible();
      await expect(exports.getByRole('link', { name: /Ver lote y exportar/ })).toHaveAttribute('href', link);
      await exports.getByText('Lotes para comprobar (1)').click();
      await expect(exports.getByText(/Falta SKU de la variante/)).toBeVisible();

      if (scenario.waiting === 55) {
        await expect(page.getByText('Otro cliente', { exact: true })).toHaveCount(0);
      }
      if (scenario.role === 'revisor' && scenario.clients.mode === 'assigned') {
        await review.getByRole('link').click();
        await expect(page).toHaveURL(new RegExp('/catalogo\\?clientId=local-client&batchId=local-batch'));
        await expect(page.getByRole('button', { name: 'Exportar a marketplaces' })).toBeVisible();
        await page.locator('[role="button"][title="Foto pendiente de revisión"]').click();
        await page.getByRole('button', { name: 'Salida 1' }).click();
        const approvals = await page.evaluate(() =>
          (window as unknown as { __localCalls: { name: string; input: object }[] }).__localCalls.filter(call => call.name === 'selectJobOutput'));
        expect(approvals).toEqual([{ name: 'selectJobOutput', input: { jobId: 'review', outputId: 'local-output' } }]);
        await page.goBack();
        await expect(review.getByText('0', { exact: true })).toBeVisible();
      }
    } finally {
      await browser.close();
    }
  });
}

test('Inicio distingue carga, errores y lotes sin cobertura completa', async () => {
  const browser = await openIsolatedBrowser(chromium, { realAuth: true });
  const { page } = browser;
  try {
    await page.addInitScript(() => {
      let release: () => void = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      Object.assign(window, {
        __dashboardFixture: { role: 'operador', clientAccess: { mode: 'global' }, oversized: true },
        __dashboardReadGate: gate,
        __releaseDashboardReads: release,
        __dashboardCountError: 'completed',
        __dashboardExportError: 'local-batch',
      });
    });
    await page.goto('/');
    const review = page.getByRole('article', { name: 'Pendiente de revisión' });
    await expect(review.getByText('Cargando…')).toBeVisible();
    await expect(review.getByText('0', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __releaseDashboardReads: () => void }).__releaseDashboardReads());
    await expect(review.getByText('No disponible')).toBeVisible();
    await expect(review.getByText(/1 por revisar/)).toBeVisible();
    await expect(page.getByRole('article', { name: 'Listo para exportar' }).getByText('Error de consulta', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Totales de generación' }).getByText('Error de consulta')).toBeVisible();
    await expect(page.getByText('La revisión de lotes quedó incompleta.')).toBeVisible();
    await page.evaluate(() => Object.assign(window, { __dashboardCountError: null, __dashboardExportError: null }));
    await page.getByRole('button', { name: 'Actualizar Inicio' }).click();
    await expect(page.getByRole('article', { name: 'Listo para exportar' }).getByText('No disponible', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Totales de generación' }).getByText('Error de consulta')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('Inicio no consulta cifras para una cuenta sin clientes asignados', async () => {
  const browser = await openIsolatedBrowser(chromium, { realAuth: true });
  const { page } = browser;
  try {
    await page.addInitScript(() => Object.assign(window, { __dashboardFixture: { role: 'operador', clientAccess: { mode: 'assigned', clientIds: [] } } }));
    await page.goto('/');
    await expect(page.getByText('Sin clientes asignados')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Totales de generación' })).toHaveCount(0);
    const operationalReads = await page.evaluate(() =>
      (window as unknown as { __fixtureReads: { path: string }[] }).__fixtureReads.filter(({ path }) => path === 'jobs' || path === 'batches'));
    expect(operationalReads).toEqual([]);
  } finally {
    await browser.close();
  }
});
