import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { requireLoopback, createIsolatedContext, openIsolatedBrowser } from './isolated-browser.mjs';

test('external override is rejected before browser launch, navigation or login', async () => {
  const previous = process.env.PLAYWRIGHT_BASE_URL;
  let launched = false;
  process.env.PLAYWRIGHT_BASE_URL = 'https://example.invalid';
  try {
    await assert.rejects(openIsolatedBrowser({ launch: async () => { launched = true; } }), /BLOCKED before login\/navigation/);
    assert.equal(launched, false);
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BASE_URL;
    else process.env.PLAYWRIGHT_BASE_URL = previous;
  }
});

test('reject non-loopback, deceptive hosts and credentials without reflecting input', () => {
  for (const input of ['https://example.invalid', 'http://127.0.0.1.example.invalid', 'file:///tmp/login', 'http://user:pass@127.0.0.1']) {
    assert.throws(() => requireLoopback(input), /BLOCKED before login\/navigation/);
  }
  assert.equal(requireLoopback('http://127.0.0.1:3000').hostname, '127.0.0.1');
});

test('loopback alone cannot authorize a context', async () => {
  const server = createServer((_, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"mode":"local-doubles","nonce":"wrong"}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let contextCreated = false;
  try {
    await assert.rejects(createIsolatedContext({ newContext: async () => { contextCreated = true; } }, {
      baseURL: `http://127.0.0.1:${server.address().port}`, nonce: 'owned-server-proof',
    }), /frontend isolation proof missing/);
    assert.equal(contextCreated, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('manual contexts block external HTTP, websocket, popups and redirects', async () => {
  const isolated = await openIsolatedBrowser(chromium);
  try {
    const { page, context, baseURL } = isolated;
    await page.goto(`${baseURL}/configuracion`);
    const transport = await context.newPage(); // about:blank has no fixture CSP; test the context firewall itself.
    const failed = [];
    context.on('requestfailed', request => failed.push(request.url()));
    assert.equal(await transport.evaluate(async () => {
      try { await fetch('https://example.invalid/login'); return false; } catch { return true; }
    }), true);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert(failed.some(url => url === 'https://example.invalid/login'));
    assert.equal(await transport.evaluate(() => new Promise(resolve => {
      const socket = new WebSocket('wss://example.invalid'); socket.onclose = () => resolve(true);
    })), true);
    const [popup] = await Promise.all([
      page.waitForEvent('popup'), page.evaluate(() => { window.open('about:blank'); }),
    ]);
    await assert.rejects(popup.goto('https://example.invalid/login'), /ERR_BLOCKED_BY_CLIENT/);
    await assert.rejects(page.goto(`${baseURL}/__tuto_external_redirect`), /ERR_BLOCKED_BY_CLIENT/);
  } finally { await isolated.close(); }
});
