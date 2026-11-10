// Temporary screenshot helper (scratch, deleted after use).
import { chromium } from '@playwright/test';
import { openIsolatedBrowser } from './isolated-browser.mjs';
const out = process.argv[2]; const tag = process.argv[3] || 'x';
const routes = (process.argv[4] || '/,/clients/lista,/clients/local-client?tab=marketplaces,/generate,/catalogo,/cola,/automation,/configuracion').split(',');
const widths = (process.argv[5] || '1440').split(',').map(Number);
const iso = await openIsolatedBrowser(chromium, { viewport: { width: 1440, height: 900 } });
const errors = [];
iso.page.on('pageerror', e => errors.push(e.message));
iso.page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  for (const w of widths) {
    await iso.page.setViewportSize({ width: w, height: 900 });
    for (const r of routes) {
      await iso.page.goto(r); await iso.page.waitForTimeout(1200);
      const name = `${tag}-${w}-${r.replace(/[^a-z0-9]+/gi, '_')}.png`;
      await iso.page.screenshot({ path: `${out}/${name}`, fullPage: false, animations: 'disabled' });
      const sw = await iso.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      console.log(name, 'overflow', sw);
    }
  }
} finally { console.log('ERRORS', JSON.stringify(errors.slice(0, 20))); await iso.close(); }
