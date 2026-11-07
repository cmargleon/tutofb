import { test, expect, chromium } from '@playwright/test';
import { openIsolatedBrowser } from './support/isolated-browser.mjs';

test('actual AuthProvider isolates and clears session drafts on identity switch and logout', async () => {
  const isolated = await openIsolatedBrowser(chromium, { realAuth: true });
  const { page, baseURL } = isolated;
  try {
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`${baseURL}/clients/local-client?tab=configuracion`);
    const name = page.getByRole('textbox', { name: 'Nombre del cliente' });
    await expect(name).toHaveValue('Cliente local'); await name.fill('Alice draft');
    await page.reload(); await expect(name).toHaveValue('Alice draft');
    await page.evaluate(() => (window as any).__setFixtureIdentity('bob'));
    await expect(name).toHaveValue('Cliente local');
    await name.fill('Bob draft');
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('tuto:client-draft:')).length)).toBe(1);
    await page.evaluate(() => (window as any).__setFixtureIdentity(null));
    await expect(page).toHaveURL(/login/);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('tuto:client-draft:')))).toEqual([]);
    await page.evaluate(() => (window as any).__setFixtureIdentity('disposable-browser-user'));
    await page.goto(`${baseURL}/clients/local-client?tab=configuracion`);
    await expect(name).toHaveValue('Cliente local');
  } finally { await isolated.close(); }
});

test('embedded Products reuses client-scoped catalog queries and does not execute automation', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  const { page, baseURL } = isolated;
  try {
    await page.goto(`${baseURL}/clients/local-client?tab=productos&clientId=foreign-client`);
    const products = page.getByRole('region', { name: 'Productos', exact: true });
    await expect(products.locator('#catalog-client')).toBeDisabled();
    await expect(products.locator('#catalog-client')).toHaveValue('local-client');
    await expect(products.getByText('Artículo local', { exact: true }).first()).toBeVisible();
    const queries = await page.evaluate(() => (window as any).__fixtureReads.filter((read: any) => read.kind === 'collection' && read.path === 'jobs'));
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((read: any) => read.constraints.some((condition: any) => condition.field === 'clientId' && condition.value === 'local-client'))).toBe(true);
    expect(await page.evaluate(() => (window as any).__localCalls || [])).toEqual([]);
    await page.screenshot({ path: '/tmp/tuto-client-products.png', fullPage: true });
  } finally { await isolated.close(); }
});
