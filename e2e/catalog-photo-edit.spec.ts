import { openIsolatedBrowser } from './support/isolated-browser.mjs';
import { test, expect, chromium } from '@playwright/test';

test('edits the visible historical version with empty instructions, reports failures, and preserves regeneration', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 1000 } });
  const { page, baseURL } = isolated;
  try {
    await page.addInitScript(() => { (window as any).__photoEditFixture = true; });
    await page.goto(`${baseURL}/catalogo`);
    await page.locator('select').first().selectOption('local-client');
    await page.locator('[role="button"][title="Artículo local"]').first().click();
    await page.locator('button[title="Intento 1"]').click();
    const panel = page.locator('aside');
    await expect(panel.getByRole('tab', { name: 'Ajustar esta foto' })).toHaveAttribute('aria-selected', 'true');
    const editor = panel.getByRole('tabpanel', { name: 'Ajustar esta foto' });
    await expect(editor.getByText('Intento 1', { exact: true })).toBeVisible();
    const instructions = editor.getByRole('textbox', { name: '¿Qué quieres cambiar?' });
    await expect(instructions).toHaveValue('');
    await expect(instructions).toHaveAttribute('placeholder', 'Ej.: cambia el fondo por una pared blanca, quita el bolso o ajusta la iluminación para que sea más cálida.');
    const submit = editor.getByRole('button', { name: 'Aplicar cambio' });
    await expect(submit).toBeDisabled();
    await instructions.fill('   ');
    await expect(submit).toBeDisabled();
    await editor.getByRole('button', { name: 'Haz la iluminación más cálida' }).click();
    await expect(instructions).toHaveValue('Haz la iluminación más cálida');
    await instructions.fill('Quita el bolso');
    await page.evaluate(() => { (window as any).__photoEditError = true; });
    await submit.click();
    await expect(page.getByText('Proveedor de edición no disponible')).toBeVisible();
    await expect(instructions).toHaveValue('Quita el bolso');
    await instructions.fill('Haz la iluminación más cálida');
    await editor.getByRole('combobox', { name: 'Modelo IA' }).selectOption('fal-seedream');
    await page.evaluate(() => { (window as any).__photoEditError = false; });
    await submit.click();
    await expect(instructions).toHaveValue('');
    const request = await page.evaluate(() => (window as any).__localCalls.filter((call: any) => call.name === 'editJobPhoto').at(-1));
    expect(request.input).toEqual({ jobId: 'local-job', sourceOutputId: 'older-output', instructions: 'Haz la iluminación más cálida', provider: 'fal-seedream' });
    await page.getByRole('button', { name: 'Cerrar modal' }).click();
    await page.locator('[role="button"][title="Artículo local"]').first().click();
    await page.locator('aside').getByRole('tab', { name: 'Crear otra versión' }).click();
    await expect(page.locator('aside').getByRole('tabpanel', { name: 'Crear otra versión' }).getByText('Generamos una foto nueva desde cero', { exact: false })).toBeVisible();
    await expect(page.locator('textarea[placeholder="Prompt para regenerar esta foto..."]')).toHaveValue('Prompt original editable');
    await page.locator('aside').getByRole('button', { name: 'Generar nueva versión', exact: true }).click();
    const regeneration = await page.evaluate(() => (window as any).__localCalls.find((call: any) => call.name === 'regenerateJob'));
    expect(regeneration.input.prompt).toBe('Prompt original editable');
    expect(regeneration.input).not.toHaveProperty('instructions');
  } finally { await isolated.close(); }
});
