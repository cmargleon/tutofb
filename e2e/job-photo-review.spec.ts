import { chromium, expect, test, type Page } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

async function setup(page: Page, baseURL: string) {
  await page.route('**/src/features/storage/assets.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(
      'if (usesProtectedImageEndpoint(storagePath)) {',
      `if (storagePath.startsWith('review-reference/')) {
        if (storagePath.endsWith('bad.jpg')) throw new Error('Missing source');
        return { url: '/__tuto_fixture.svg' };
      }
      if (usesProtectedImageEndpoint(storagePath)) {`,
    ) });
  });
  await page.route('**/e2e/support/local-fixtures.mjs*', async route => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace("row[field] === value", "field.split('.').reduce((item, key) => item?.[key], row) === value")
      .replace("  if (name === 'listClients')", `
        if (name === 'recordJobRejection') {
          if (input.note === 'simular error') throw new Error('Fallo simulado');
          const id = 'feedback-' + window.__localCalls.length;
          records['jobs/' + input.jobId + '/logs'].push({
            id, createdAt: stamp, humanFeedback: { ...input, authorDisplayName: 'Operador local' },
          });
          listeners.forEach(emit => emit());
          return { data: { feedbackId: id } };
        }
        if (name === 'regenerateJob') return { data: { success: true, jobId: input.jobId } };
        if (name === 'listClients')`);
    await route.fulfill({ response, body: source + `
      const current = { ...job.currentOutput, id: 'current', generationAttempt: 3, createdAt: stamp };
      const previous = { ...current, id: 'approved', generationAttempt: 2 };
      const earlier = { ...current, id: 'earlier', generationAttempt: 1 };
      Object.assign(job, { promptBase: 'Preserva la identidad del producto', garmentReferencePaths: ['reference.jpg', 'bad.jpg'],
        currentOutput: current, userSelectedOutput: previous, userSelectedOutputId: previous.id });
      records['jobs/local-job/outputs'] = [current, previous, earlier];
      records['jobs/local-job/logs'] = [];
      Object.assign(records.jobs.find(item => item.id === 'local-detail-job'), {
        garmentReferencePaths: window.__onlyReference ? ['reference.jpg'] : [],
      });
    ` });
  });
  await page.goto(`${baseURL}/catalogo?clientId=local-client&batchId=local-batch`);
  await page.locator('[role="button"][title="Artículo local"]').first().click();
}

test('compares existing photos, pans independently and explicitly sends the edited correction', async () => {
  const browser = await openIsolatedBrowser(chromium, { viewport: { width: 1280, height: 900 } });
  try {
    const { page, baseURL } = browser;
    await setup(page, baseURL);
    const trigger = page.getByRole('button', { name: 'Comparar y revisar fotos' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Comparar y revisar fotos' });
    await expect(dialog.getByText('Aprobado manualmente')).toBeVisible();
    const reference = dialog.getByRole('combobox', { name: 'Foto de referencia', exact: true });
    await reference.selectOption('bad.jpg', { timeout: 5000 });
    await expect(dialog.getByText('No pudimos cargar esta imagen.')).toBeVisible();
    await reference.selectOption('reference.jpg', { timeout: 5000 });
    await expect(dialog.getByRole('img', { name: 'Referencia original 1' })).toBeVisible();

    const zoom = dialog.getByRole('slider', { name: /Zoom de todas/ });
    await zoom.press('End', { timeout: 5000 });
    await expect(zoom).toHaveValue('300');
    const originalPane = dialog.getByRole('region', { name: /Desplazar: Referencia/ });
    const currentPane = dialog.getByRole('region', { name: /Desplazar: Resultado actual/ });
    const originalLeft = await originalPane.evaluate(el => el.scrollLeft);
    const currentLeft = await currentPane.evaluate(el => el.scrollLeft);
    await originalPane.press('ArrowRight', { timeout: 5000 });
    await expect.poll(() => originalPane.evaluate(el => el.scrollLeft)).toBeGreaterThan(originalLeft);
    expect(await currentPane.evaluate(el => el.scrollLeft)).toBe(currentLeft);
    await dialog.getByLabel('Sincronizar zoom').uncheck();
    await expect(dialog.getByRole('slider')).toHaveCount(3);
    await dialog.getByRole('combobox', { name: 'Intento anterior', exact: true }).selectOption('earlier');
    await expect(dialog.getByText(/Aprobado: Intento 2/)).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Resultado que quieres revisar' }).selectOption('earlier');

    await dialog.getByLabel('Color incorrecto').check();
    await dialog.getByLabel('Logo o texto incorrecto').check();
    await dialog.getByLabel('Nota opcional').fill('simular error');
    await dialog.getByRole('button', { name: 'Guardar motivos', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'No pudimos guardar el rechazo' })).toBeVisible();
    await dialog.getByLabel('Nota opcional').fill('Logo al revés.');
    await dialog.getByRole('button', { name: 'Guardar motivos', exact: true }).click();
    const log = dialog.getByText('Rechazos registrados (1)');
    await expect(log).toBeVisible();
    await log.click();
    await expect(dialog.getByText('Logo al revés.', { exact: true })).toBeVisible();
    const calls = () => page.evaluate(() => ((window as any).__localCalls || [])
      .filter(({ name }: { name: string }) => ['recordJobRejection', 'regenerateJob', 'selectJobOutput'].includes(name)));
    expect((await calls()).map((call: any) => call.name)).toEqual(['recordJobRejection', 'recordJobRejection']);
    expect((await calls())[1].input.outputId).toBe('earlier');
    await dialog.getByRole('button', { name: 'Preparar corrección con estos motivos' }).click();
    const correction = dialog.getByLabel('Corrección del siguiente intento');
    await expect(correction).toHaveValue(/Logo al revés/);
    await correction.fill('Reproduce el logo tal como aparece en la referencia.');
    expect(await calls()).toHaveLength(2);
    await dialog.getByRole('button', { name: 'Regenerar con esta corrección' }).click();
    await expect.poll(async () => (await calls()).length).toBe(3);
    expect((await calls())[2].input.correction).toEqual({ feedbackId: expect.any(String), text: 'Reproduce el logo tal como aparece en la referencia.' });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('button', { name: 'Cerrar modal', exact: true })).toBeVisible();
  } finally { await browser.close(); }
});

for (const onlyReference of [true, false]) {
  test(`mobile comparison handles ${onlyReference ? 'one' : 'no'} reference without previous attempts`, async () => {
    const browser = await openIsolatedBrowser(chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const { page, baseURL } = browser;
      if (onlyReference) await page.addInitScript(() => { (window as any).__onlyReference = true; });
      await setup(page, baseURL);
      await page.getByRole('button', { name: 'Imagen siguiente', exact: true }).click();
      await page.getByRole('button', { name: 'Comparar y revisar fotos' }).click();
      const dialog = page.getByRole('dialog', { name: 'Comparar y revisar fotos' });
      await expect(dialog.getByText('No hay intentos anteriores.')).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Foto de referencia', exact: true })).toHaveCount(0);
      if (onlyReference) await expect(dialog.getByRole('img', { name: 'Referencia original' })).toBeVisible();
      else await expect(dialog.getByText('No hay una foto de referencia disponible.')).toBeVisible();
      const gallery = dialog.getByRole('region', { name: 'Fotos de la comparación' });
      const dimensions = await gallery.evaluate(el => ({ visible: el.clientWidth, all: el.scrollWidth, panel: el.firstElementChild!.getBoundingClientRect().width }));
      expect(dimensions.all).toBeGreaterThan(dimensions.visible);
      expect(dimensions.panel).toBeGreaterThan(dimensions.visible * 0.75);
    } finally { await browser.close(); }
  });
}
