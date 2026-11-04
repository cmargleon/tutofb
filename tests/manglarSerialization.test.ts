import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { auditChanges, sanitizeResult } = require('../functions/lib/functions/src/manglar/reads.js');
const { Timestamp } = require('../functions/node_modules/firebase-admin').firestore;

test('MCP health timestamps serialize as ISO and nested credentials never reach the result', () => {
  const date = new Date('2026-11-03T12:00:00.000Z');
  const result = sanitizeResult({
    checkedAt: date,
    providers: [{ checkedAt: date, OPENAI_API_KEY: 'secret', GEMINI_API_KEY: 'secret', GOOGLE_PRIVATE_KEY: 'secret', FAL_KEY: 'secret', clientSecret: 'secret', token: 'secret', totalTokens: 42 }],
    updatedAt: Timestamp.fromDate(date),
  });
  assert.equal(result.checkedAt, date.toISOString());
  assert.equal(result.updatedAt, date.toISOString());
  assert.deepEqual(result.providers, [{ checkedAt: date.toISOString(), totalTokens: 42 }]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('large bulk prompts retain every target and exact text hashes within Firestore audit limits', () => {
  const input={jobs:Array.from({length:50},(_,index)=>({jobId:`job-${index}`,provider:'fal-gpt-image-2.5-flare',prompt:'Approved prompt '.repeat(2000)}))};
  const audit=auditChanges(input);
  assert.equal(audit.summarized,true);
  assert.equal(audit.data.jobs.length,50);
  assert.equal(audit.data.jobs[49].jobId,'job-49');
  assert.equal(audit.data.jobs[0].prompt.characters,input.jobs[0].prompt.length);
  assert.match(audit.data.jobs[0].prompt.sha256,/^[a-f0-9]{64}$/);
  assert.ok(Buffer.byteLength(JSON.stringify(audit))<160000);
});
