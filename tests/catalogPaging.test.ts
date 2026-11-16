import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Job } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { buildCatalogPage, carveCatalogPage, catalogCreatedAtKey } = require('../src/features/catalog/catalogPaging.ts') as typeof import('../src/features/catalog/catalogPaging');

const ts = (seconds: number, nanoseconds = 0) => ({ seconds, nanoseconds });
const done = { currentOutput: { resultImagePath: 'generated/x.png' } };
const job = (id: string, garmentId: string, createdAt: unknown, extra: Partial<Job> = {}): Job =>
  ({ id, garmentId, garmentName: `Prenda ${garmentId}`, createdAt, status: 'completed', ...done, ...extra } as unknown as Job);

/** A batch with `garments` articles × `poses` jobs, interleaved like Firestore's document-id tie order. */
const batch = (name: string, seconds: number, garments: number, poses: number, extra: (g: number, p: number) => Partial<Job> = () => ({})) =>
  Array.from({ length: poses }, (_, p) => Array.from({ length: garments }, (_, g) => job(`${name}-g${g}-p${p}`, `${name}-g${g}`, ts(seconds), extra(g, p)))).flat();

/** Firestore double: pages a fixed ordered list with startAfter(cursor) and counts reads. */
const source = (all: Job[]) => {
  const stats = { reads: 0, queries: 0 };
  const fetchChunk = async (cursor: string | null, limit: number) => {
    stats.queries += 1;
    const from = cursor === null ? 0 : all.findIndex((entry) => entry.id === cursor) + 1;
    const jobs = all.slice(from, from + limit);
    stats.reads += jobs.length;
    return { jobs, cursor: jobs.at(-1)?.id ?? cursor, exhausted: jobs.length < limit };
  };
  return { fetchChunk, stats };
};

const walk = async (all: Job[], pageSize: number) => {
  const { fetchChunk, stats } = source(all);
  // First page mirrors the live head: limit(pageSize + 1).
  const head = await fetchChunk(null, pageSize + 1);
  let page = await buildCatalogPage({ buffer: head.jobs, cursor: head.cursor, exhausted: head.jobs.length <= pageSize }, pageSize, fetchChunk);
  const pages = [page.jobs];
  while (page.hasMore) {
    page = await buildCatalogPage(page.next, pageSize, fetchChunk);
    pages.push(page.jobs);
  }
  return { pages, stats };
};

const garmentPages = (pages: Job[][]) => {
  const seen = new Map<string, number>();
  pages.forEach((jobs, index) => jobs.forEach((entry) => {
    const previous = seen.get(entry.garmentId);
    assert.ok(previous === undefined || previous === index, `${entry.garmentId} appears on pages ${previous} and ${index}`);
    seen.set(entry.garmentId, index);
  }));
  return seen;
};

test('timestamp keys keep nanosecond precision', () => {
  assert.notEqual(catalogCreatedAtKey(ts(10, 1)), catalogCreatedAtKey(ts(10, 2)));
  assert.equal(catalogCreatedAtKey(ts(10, 5)), catalogCreatedAtKey({ seconds: 10, nanoseconds: 5, toMillis: () => 0 }));
});

test('an article interleaved inside a batch is never split across pages', async () => {
  const all = [...batch('a', 300, 7, 4), ...batch('b', 200, 5, 3), ...batch('c', 100, 9, 2)];
  const { pages } = await walk(all, 10);
  const seen = garmentPages(pages);
  assert.equal(seen.size, 21, 'every article is shown');
  assert.equal(pages.flat().length, all.length, 'every job is shown exactly once');
  assert.equal(new Set(pages.flat().map((entry) => entry.id)).size, all.length);
  pages.slice(0, -1).forEach((jobs) => assert.ok(jobs.length >= 10, 'pages before the last are never short'));
  pages.slice(0, -1).forEach((jobs) => assert.ok(jobs.length < 10 + 4, 'a page overshoots by less than one article'));
});

test('non-renderable jobs do not make pages short while more results exist', async () => {
  const all = batch('a', 300, 30, 2, (g) => g % 3 === 0 ? { currentOutput: null, status: 'completed' } as Partial<Job> : {});
  const { pages } = await walk(all, 10);
  garmentPages(pages);
  pages.slice(0, -1).forEach((jobs) => assert.ok(jobs.length >= 10, `page has ${jobs.length}`));
  assert.ok(pages.flat().every((entry) => entry.currentOutput), 'non-renderable jobs are filtered');
  assert.equal(pages.flat().length, 40);
});

test('failed jobs count as renderable', () => {
  const slice = carveCatalogPage([job('f', 'g', ts(1), { status: 'failed', currentOutput: null } as Partial<Job>)], true, 5);
  assert.deepEqual(slice?.jobs.map((entry) => entry.id), ['f']);
});

test('an article larger than the page stays whole on one page', async () => {
  const all = [...batch('big', 300, 1, 30), ...batch('small', 200, 4, 2)];
  const { pages } = await walk(all, 25);
  garmentPages(pages);
  assert.equal(pages[0].length, 30);
});

test('the buffer is reused: sequential browsing reads each document once', async () => {
  const all = Array.from({ length: 40 }, (_, index) => batch(`b${index}`, 1000 - index, 2, 3)).flat();
  const { pages, stats } = await walk(all, 25);
  garmentPages(pages);
  assert.equal(pages.flat().length, all.length);
  // Old paging read pageSize + 1 per page (the lookahead was read again on the next page).
  const oldReads = Math.ceil(all.length / 25) * 26;
  assert.ok(stats.reads <= all.length + 25, `reads ${stats.reads} for ${all.length} jobs`);
  assert.ok(stats.reads <= oldReads, `reads ${stats.reads} vs old ${oldReads}`);
});

test('a large batch at the cut is read once and served across several pages', async () => {
  const all = [...batch('small', 300, 2, 3), ...batch('huge', 200, 60, 6), ...batch('tail', 100, 2, 2)];
  const { fetchChunk, stats } = source(all);
  const head = await fetchChunk(null, 26);
  const first = await buildCatalogPage({ buffer: head.jobs, cursor: head.cursor, exhausted: false }, 25, fetchChunk);
  const readsForFirst = stats.reads;
  assert.ok(readsForFirst > 360, 'closing an article of the huge batch needs its whole tie group');
  const second = await buildCatalogPage(first.next, 25, fetchChunk);
  assert.equal(stats.reads, readsForFirst, 'the next page comes from the buffer');
  garmentPages([first.jobs, second.jobs]);
});

test('carve waits for more documents while the last article may continue', () => {
  const open = [job('1', 'g1', ts(5)), job('2', 'g2', ts(5))];
  assert.equal(carveCatalogPage(open, false, 1), null, 'the only timestamp seen may still continue');
  const closed = carveCatalogPage([...open, job('3', 'g3', ts(4))], false, 1);
  assert.deepEqual(closed?.jobs.map((entry) => entry.id), ['1']);
  assert.deepEqual(closed?.rest.map((entry) => entry.id), ['2', '3']);
});

test('an empty catalog yields one empty page without more', async () => {
  const { pages } = await walk([], 25);
  assert.deepEqual(pages, [[]]);
});

test('ascending and descending orders both keep articles whole', async () => {
  const desc = [...batch('a', 300, 6, 5), ...batch('b', 200, 6, 5), ...batch('c', 100, 6, 5)];
  const asc = [...desc].reverse();
  for (const all of [desc, asc]) {
    const { pages } = await walk(all, 25);
    garmentPages(pages);
    assert.equal(pages.flat().length, 90);
  }
});
