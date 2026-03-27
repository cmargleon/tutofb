import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldBackstopPendingJob } = require('../functions/lib/functions/src/workers/jobWorker.helpers.js') as {
  shouldBackstopPendingJob: typeof import('../functions/src/workers/jobWorker.helpers').shouldBackstopPendingJob;
};

test('shouldBackstopPendingJob recupera pendientes huerfanos', () => {
  assert.equal(
    shouldBackstopPendingJob({
      status: 'pending',
      retryNotBefore: null,
      claimToken: null,
    }),
    true,
  );
});

test('shouldBackstopPendingJob ignora retries diferidos y claims activos', () => {
  assert.equal(
    shouldBackstopPendingJob({
      status: 'pending',
      retryNotBefore: new Date(),
      claimToken: null,
    }),
    false,
  );

  assert.equal(
    shouldBackstopPendingJob({
      status: 'pending',
      retryNotBefore: null,
      claimToken: 'claim-1',
    }),
    false,
  );

  assert.equal(
    shouldBackstopPendingJob({
      status: 'processing',
      retryNotBefore: null,
      claimToken: null,
    }),
    false,
  );
});
