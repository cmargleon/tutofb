import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

// Real presentation and routing; Firebase is replaced only inside the isolated test server.
test('Tuto shell preserves navigation, theme preference and accessible mobile drawer', async () => {
  const isolated = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 1000 } });
  const { page } = isolated;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    // The isolation helper deliberately blocks sockets. Vite can report its HMR
    // transport; keep all application errors as failures.
    if (message.type() === 'error' && !message.text().startsWith('[vite] failed to connect to websocket.')) errors.push(message.text());
  });
  try {
    await page.goto('/clients/lista');
    await expect(page.locator('html')).toHaveClass('theme-light');
    await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cliente local', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/tuto-ui-clients-desktop.png', fullPage: true, animations: 'disabled' });

    await page.getByRole('button', { name: 'Colapsar menú lateral' }).click();
    await expect(page.locator('.app-shell')).toHaveClass(/app-shell--collapsed/);
    await expect(page.getByRole('button', { name: 'Clientes', exact: true })).toHaveAccessibleName('Clientes');
    await page.getByRole('button', { name: 'Expandir menú lateral' }).click();
    await page.getByRole('link', { name: 'Cliente local', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Ubicación actual' })).toContainText('Clientes / Ficha del cliente');
    await expect(page.getByRole('button', { name: 'Clientes', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Marketplaces', exact: true }).click();
    await expect(page.getByRole('switch')).toHaveCount(4);
    await page.getByRole('button', { name: 'Configurar', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'País o región' })).toBeVisible();
    await page.screenshot({ path: '/tmp/tuto-ui-client-marketplaces-desktop.png', fullPage: true, animations: 'disabled' });

    await page.getByRole('button', { name: 'Cambiar a tema oscuro' }).click();
    await expect(page.locator('html')).toHaveClass('theme-dark');
    await page.reload();
    await expect(page.locator('html')).toHaveClass('theme-dark');
    await expect(page.getByRole('switch')).toHaveCount(4);
    await page.screenshot({ path: '/tmp/tuto-ui-client-dark.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Cambiar a tema claro' }).click();

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('aside')).toHaveAttribute('inert', '');
      const trigger = page.getByRole('button', { name: 'Abrir menú lateral' });
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: 'Menú principal' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Tuto · Inicio' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(drawer.getByRole('button', { name: 'Cerrar sesión' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(drawer.getByRole('link', { name: 'Tuto · Inicio' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/tuto-ui-client-${width}.png`, fullPage: true, animations: 'disabled' });
      await trigger.click();
      await page.getByRole('link', { name: 'Lista de Clientes', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Menú principal' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/tuto-ui-clients-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('link', { name: 'Cliente local', exact: true }).click();
      await page.getByRole('button', { name: 'Marketplaces', exact: true }).click();
    }
    expect(errors).toEqual([]);
    // Read-only inspection must never start production work or save a channel.
    const calls = await page.evaluate(() => (window as any).__localCalls || []);
    expect(calls.every((call: { name: string }) => call.name === 'listClients')).toBe(true);
  } finally { await isolated.close(); }
});
