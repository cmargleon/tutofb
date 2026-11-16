import { chromium } from '@playwright/test';
import { createIsolatedContext, startIsolatedFrontend } from '../e2e/support/isolated-browser.mjs';

const jobCounts = [120, 600, 1200];
const repetitions = Number(process.argv[2] || 5);
const posesPerArticle = 6;
const frontend = await startIsolatedFrontend();
const browser = await chromium.launch({ args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });

async function measure(count) {
  const context = await createIsolatedContext(browser, frontend, { viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      const stats = window.catalogPerf = { docs: 0, snapshots: 0, queryMs: 0, firstSnapshot: 0, firstGridMs: null, firstImageMs: null, initialTiles: null, storageStarted: 0, storageFinished: 0, resolvedPaths: new Set(), longTasks: [] };
      new PerformanceObserver(list => stats.longTasks.push(...list.getEntries().map(entry => [entry.startTime, entry.duration]))).observe({ type: 'longtask', buffered: true });
      new MutationObserver(() => {
        if (!stats.firstSnapshot) return;
        const tiles = document.querySelectorAll('[role="button"][title^="Artículo sintético"]');
        if (tiles.length && stats.firstGridMs === null) {
          stats.initialTiles = tiles.length;
          requestAnimationFrame(() => { stats.firstGridMs ??= performance.now() - stats.firstSnapshot; });
        }
      }).observe(document, { childList: true, subtree: true });
      document.addEventListener('load', event => {
        if (event.target instanceof HTMLImageElement && event.target.alt.startsWith('Artículo sintético')) {
          stats.firstImageMs ??= performance.now() - stats.firstSnapshot;
        }
      }, true);
    });

    await page.route('**/e2e/support/local-fixtures.mjs*', async route => {
      const response = await route.fetch();
      const source = (await response.text())
        .replace('const emit = () => callback(snapshot(reference));', `let active = true;
        const emit = () => {
          if (!active) return;
          const measured = reference.path === 'jobs';
          const start = performance.now();
          const result = snapshot(reference);
          if (measured) {
            const stats = window.catalogPerf;
            stats.firstSnapshot ||= start;
            stats.snapshots++;
            stats.docs += result.docs.length;
            stats.queryMs += performance.now() - start;
          }
          callback(result);
        };`)
        .replace('return () => listeners.delete(emit);', 'return () => { active = false; listeners.delete(emit); };')
        .replace(/export const getBlob = .*?;\n/, `const thumbnail = new Blob([
          '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="teal"/></svg>',
          '<!--', '0'.repeat(16384), '-->'
        ], { type: 'image/svg+xml' });
        export const getBlob = async () => {
          window.catalogPerf.storageStarted++;
          await new Promise(resolve => setTimeout(resolve, 25));
          window.catalogPerf.storageFinished++;
          return thumbnail;
        };\n`);
      await route.fulfill({ response, body: source + `
        records.jobs = Array.from({ length: ${count} }, (_, index) => {
          const article = Math.floor(index / ${posesPerArticle});
          const output = { ...job.currentOutput, resultImagePath: 'fixtures/full-' + index, thumbnailPath: 'fixtures/thumb-' + index };
          return { ...job, id: 'perf-' + index, garmentId: 'article-' + article, garmentName: 'Artículo sintético ' + article,
            poseId: 'pose-' + (index % ${posesPerArticle}), currentOutput: output, modelNameSnapshot: 'Modelo sintético' };
        });
        Object.assign(batch, { totalJobs: ${count}, completedJobs: ${count} });
      ` });
    });

    await page.route('**/src/features/storage/assets.ts*', async route => {
      const response = await route.fetch();
      const source = (await response.text()).replace(
        'const resolveStorageAssetUrl = async (storagePath) => {',
        'const resolveStorageAssetUrl = async (storagePath) => { if (storagePath.startsWith("fixtures/thumb-")) window.catalogPerf.resolvedPaths.add(storagePath);'
      );
      await route.fulfill({ response, body: source });
    });

    await page.goto(`${frontend.baseURL}/catalogo?clientId=local-client&batchId=local-batch`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.catalogPerf.firstGridMs !== null
      && performance.now() - window.catalogPerf.firstSnapshot >= 2000);
    return await page.evaluate(() => {
      const { firstSnapshot, longTasks, resolvedPaths, ...stats } = window.catalogPerf;
      if (!resolvedPaths.size || !stats.docs) throw new Error('Catalog instrumentation did not observe results.');
      const tasks = longTasks.filter(([start]) => start >= firstSnapshot - 16).map(([, duration]) => duration);
      return {
        ...stats,
        requestedPreviews: resolvedPaths.size,
        nodes: document.querySelectorAll('*').length,
        maxLongTaskMs: Math.max(0, ...tasks),
        longTaskCount: tasks.length,
      };
    });
  } finally {
    await context.close();
  }
}

try {
  console.log(JSON.stringify({ chromium: browser.version(), node: process.version, repetitions, cpuThrottle: 4, posesPerArticle }));
  await measure(jobCounts[0]);
  for (const count of jobCounts) {
    const samples = [];
    for (let index = 0; index < repetitions; index++) samples.push(await measure(count));
    const medians = Object.fromEntries(Object.keys(samples[0]).map(key => {
      const values = samples.map(sample => sample[key]).sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
      const median = values[Math.floor(values.length / 2)];
      return [key, median === null ? null : Math.round(median * 10) / 10];
    }));
    console.log(JSON.stringify({ jobs: count, ...medians }));
  }
} finally {
  await browser.close();
  await frontend.close();
}
