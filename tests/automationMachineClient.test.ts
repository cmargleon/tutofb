import test from 'node:test';
import assert from 'node:assert/strict';

test('trusted HTTP client obtains token automatically, renews once on 401 and never exposes credentials', async () => {
  const { ManglarAutomationClient, POLLING_POLICY } = await import('../scripts/manglar-work-client.mjs');
  let tokens = 0, requests = 0, secretsRead = 0;
  const client = new ManglarAutomationClient({ getClientSecret: async () => { secretsRead++; return 'test-only-secret'; }, fetchImpl: async (url: string, options: any) => {
    if (url.endsWith('/token')) {
      tokens++; assert.equal(options.body.get('grant_type'), 'client_credentials');
      return Response.json({ access_token: `test-${tokens}`, token_type: 'Bearer', expires_in: 900 });
    }
    requests++;
    if (requests === 1) return Response.json({}, { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer test-2');
    return Response.json({ jobId: 'job', status: 'pending' });
  } });
  assert.equal((await client.getJob('job')).jobId, 'job');
  await client.getJob('job');
  assert.equal(tokens, 2); assert.equal(secretsRead, 2);
  assert.deepEqual(POLLING_POLICY, { initialIntervalSeconds: 20, initialWindowSeconds: 300, subsequentIntervalSeconds: 60, timeoutSeconds: 1800 });
  assert.equal(JSON.stringify(client).includes('test-only-secret'), false);
  assert.throws(() => new ManglarAutomationClient({ baseUrl: 'https://evil.example', getClientSecret: async () => 'secret' }));
});


test('parallel uploads share one automatic credential renewal', async () => {
  const { ManglarAutomationClient } = await import('../scripts/manglar-work-client.mjs');
  let renewals = 0;
  const client = new ManglarAutomationClient({ getClientSecret: async () => 'test-only-secret', fetchImpl: async (url: string) => {
    if (url.endsWith('/token')) { renewals++; return Response.json({ access_token: 'test', token_type: 'Bearer', expires_in: 900 }); }
    return Response.json({ storagePath: 'test/input.jpg' });
  } });
  await Promise.all(Array.from({ length: 20 }, () => client.upload(Buffer.from('test'))));
  assert.equal(renewals, 1);
});


test('job polling uses 20 seconds for five minutes then 60, and renews credentials during monitoring', async () => {
  const { ManglarAutomationClient } = await import('../scripts/manglar-work-client.mjs');
  const start = Date.now();
  let elapsed = 0, tokens = 0;
  const polls: number[] = [];
  const initial = { jobId: 'job', status: 'pending', createdAt: new Date(start).toISOString() };
  const client = new ManglarAutomationClient({ getClientSecret: async () => 'test-secret', fetchImpl: async (url: string) => {
    if (url.endsWith('/token')) { tokens++; return Response.json({ access_token: `test-${tokens}`, token_type: 'Bearer', expires_in: 1 }); }
    polls.push(elapsed);
    return Response.json({ ...initial, status: elapsed >= 960 ? 'completed' : 'processing' });
  } });
  const result = await client.waitForJob(initial, { now: () => start + elapsed * 1000, sleep: async (ms: number) => { elapsed += ms / 1000; } });
  assert.equal(result.status, 'completed');
  assert.deepEqual(polls.slice(0, 15), Array.from({ length: 15 }, (_, i) => (i + 1) * 20));
  assert.deepEqual(polls.slice(15), Array.from({ length: 11 }, (_, i) => 360 + i * 60));
  assert.ok(tokens > 1);
});

test('polling preserves creation deadline on resume, stops at 30 minutes, and never creates/retries jobs', async () => {
  const { ManglarAutomationClient, AutomationPollingTimeout, getPollingPlan } = await import('../scripts/manglar-work-client.mjs');
  const start = Date.now();
  const initial = { jobId: 'job', status: 'processing', createdAt: new Date(start).toISOString() };
  let elapsed = 1740, reads = 0;
  const client = new ManglarAutomationClient({ getClientSecret: async () => 'test-secret', fetchImpl: async (url: string) => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'test', token_type: 'Bearer', expires_in: 900 });
    assert.ok(url.endsWith('/jobs/job')); reads++; return Response.json(initial);
  } });
  assert.equal(getPollingPlan(initial, start + 299_999).delaySeconds, 20);
  assert.equal(getPollingPlan(initial, start + 300_000).delaySeconds, 60);
  assert.equal(getPollingPlan(initial, start + 1790_000).delaySeconds, 10);
  await assert.rejects(client.waitForJob(initial, { now: () => start + elapsed * 1000, sleep: async (ms: number) => { elapsed += ms / 1000; } }), (error: any) => error instanceof AutomationPollingTimeout && error.jobId === 'job' && error.lastStatus === 'processing');
  assert.equal(elapsed, 1800); assert.equal(reads, 0);
});

test('all terminal states stop immediately even after deadline; cancellation stops polling', async () => {
  const { ManglarAutomationClient } = await import('../scripts/manglar-work-client.mjs');
  const client = new ManglarAutomationClient({ getClientSecret: async () => { throw new Error('must not authenticate'); } });
  for (const status of ['completed', 'failed', 'needs_attention']) {
    const job = { jobId: 'job', status, createdAt: new Date(0).toISOString() };
    assert.equal(await client.waitForJob(job), job);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.waitForJob({ jobId: 'job', status: 'pending', createdAt: new Date().toISOString() }, { signal: controller.signal }), { name: 'AbortError' });
});
