import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('marketplace rules: navigation, isolated drafts, save/reload, conflict recovery and mobile layout', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 1100 } });
  const { page, baseURL } = isolated;
  try {
    await page.route('**/src/features/models/marketplaceRules/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      let listeners = new Set();
      let rules = JSON.parse(sessionStorage.getItem('test-marketplace-rules') || '{}');
      export const subscribeModelMarketplaceRules = (next, error) => { listeners.add(next); queueMicrotask(() => next(rules)); return () => listeners.delete(next); };
      export const saveModelMarketplaceRule = async input => {
        (window.__rulesWrites ||= []).push(input);
        if (window.__conflictRuleSave) {
          rules = { ...rules, [input.marketplaceId]: { ...input.rule, revision: input.expectedRevision + 1, aspectRatio: '1:1' } };
          sessionStorage.setItem('test-marketplace-rules', JSON.stringify(rules)); listeners.forEach(next => next(rules));
          throw new Error('Otra persona modificó estas reglas. Recarga los valores guardados antes de continuar.');
        }
        if ((rules[input.marketplaceId]?.revision || 0) !== input.expectedRevision) throw new Error('Revisión desactualizada');
        const rule = { ...input.rule, revision: input.expectedRevision + 1 };
        rules = { ...rules, [input.marketplaceId]: rule };
        sessionStorage.setItem('test-marketplace-rules', JSON.stringify(rules)); listeners.forEach(next => next(rules));
        return { rule };
      };
    ` }));
    await page.goto(`${baseURL}/models/reglas-marketplace`);
    await expect(page.getByRole('heading', { name: 'Reglas Marketplace', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reglas Marketplace', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Amazon' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Guardar reglas' })).toBeDisabled();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('client');
    await expect(page.getByLabel('Exigir frontal de pie, ojos abiertos, boca cerrada y brazos a los lados · Portada')).toBeChecked();
    await page.getByText('Variaciones del catálogo · 0 habilitadas', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Frente completa', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Frente completa', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Frente completa', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('details').screenshot({ path: '/tmp/tuto-pose-chips-rules-selected.png' });
    await page.getByLabel('Relación de aspecto').selectOption('4:3');
    await test.step('Editar fondo de portada', async () => { await page.getByRole('combobox', { name: 'Fondo · Portada', exact: true }).selectOption('neutral'); });
    await page.getByRole('tab', { name: 'TikTok Shop' }).click();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('1:1');
    await page.getByRole('tab', { name: 'Amazon' }).click();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('4:3');
    await expect(page.getByRole('combobox', { name: 'Fondo · Portada', exact: true })).toHaveValue('neutral');
    await page.getByRole('button', { name: 'Guardar reglas' }).click();
    await expect(page.getByText('Versión 1', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__rulesWrites[0])).toMatchObject({ marketplaceId: 'amazon', expectedRevision: 0, rule: { aspectRatio: '4:3', main: { background: 'neutral' }, allowedPoseRecipeIds: ['full-front'] } });
    await page.reload();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('4:3');
    await page.getByText('Variaciones del catálogo · 1 habilitadas', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Frente completa', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Frente completa', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar reglas' }).click();
    await expect(page.getByText('Versión 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Variaciones del catálogo · 0 habilitadas', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Rostro · Portada', exact: true }).selectOption('hidden');
    await expect(page.getByRole('combobox', { name: 'Encuadre · Portada', exact: true })).toHaveValue('lower_body');
    await page.getByRole('button', { name: 'Descartar cambios' }).click();
    await expect(page.getByRole('combobox', { name: 'Rostro · Portada', exact: true })).toHaveValue('auto');
    await page.getByLabel('Relación de aspecto').selectOption('3:4');
    await page.evaluate(() => { (window as any).__conflictRuleSave = true; });
    await page.getByRole('button', { name: 'Guardar reglas' }).click();
    await expect(page.getByText(/Otra persona modificó estas reglas/).first()).toBeVisible();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('3:4');
    await page.getByRole('button', { name: 'Descartar cambios' }).click();
    await expect(page.getByLabel('Relación de aspecto')).toHaveValue('1:1');
    while (await page.getByRole('button', { name: 'Cerrar notificación' }).count()) await page.getByRole('button', { name: 'Cerrar notificación' }).first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByLabel('Relación de aspecto')).toBeVisible();
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/tuto-marketplace-rules-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Reglas Marketplace', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/tuto-marketplace-rules-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
    await page.getByText('Variaciones del catálogo · 0 habilitadas', { exact: true }).click();
    await page.getByRole('button', { name: 'Frente completa', exact: true }).click();
    await expect.poll(() => page.getByRole('button', { name: 'Diagonal de frente', exact: true }).evaluate(element => getComputedStyle(element).color)).toBe('rgb(191, 199, 224)');
    await page.locator('details').screenshot({ path: '/tmp/tuto-pose-chips-rules-dark.png' });
  } finally { await isolated.close(); }
});
