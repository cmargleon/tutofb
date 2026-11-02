import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Job } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { DEFAULT_AUTOMATION_BUDGET, resolveAutomationPolicy, remainingAutomationBudget, validateAutomationBudget } = require('../shared/src/automationPolicy');
const { automationScenePatch } = require('../functions/lib/functions/src/automation/recovery.js');
const { summarizeAutomation, validateAutomationInput } = require('../functions/lib/functions/src/automation/domain.js');
const { buildAutomaticRetryPromptPatch, shouldBackstopPendingJob } = require('../functions/lib/functions/src/workers/jobWorker.helpers.js');
const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js');
const { parseDriveFolderId } = require('../functions/lib/functions/src/automation/drive.js');

test('automation resolves global, client and request precedence without bypassing global ceilings', () => {
  const global = { ...DEFAULT_AUTOMATION_BUDGET, defaultBudgetUsd: 8, maxBudgetUsd: 20, maxReviewAttempts: 3, maxOperationalRetries: 2 };
  const client = { enabled: true, defaultBudgetUsd: 6, maxReviewAttempts: 2 };
  assert.deepEqual(resolveAutomationPolicy(global, client, { budgetUsd: 4 }), { budgetUsd: 4, maxReviewAttempts: 2, maxOperationalRetries: 2, allowEstimatedCosts: false, authorizeClassification: false });
  assert.equal(resolveAutomationPolicy(global, client).budgetUsd, 6);
  assert.equal(resolveAutomationPolicy(global).budgetUsd, 8);
  assert.throws(() => resolveAutomationPolicy(global, client, { maxReviewAttempts: 3 }));
  for (const budgetUsd of [21, Infinity, NaN, -1, 0]) assert.throws(() => resolveAutomationPolicy(global, {}, { budgetUsd }));
  assert.throws(() => resolveAutomationPolicy(global, { enabled: false }));
  assert.throws(() => validateAutomationBudget({ ...global, maxOperationalRetries: 0.5 }));
  assert.equal(remainingAutomationBudget({ limitUsd: 1, reservedUsd: 0.4, spentUsd: 0.5 }), 0.1);
});

test('scene failures do not stop other pending scenes or articles; the final summary retains approved outputs', () => {
  const jobs = [
    { id: 'a0', garmentId: 'a', status: 'failed', generationAttemptCount: 3 },
    { id: 'a1', garmentId: 'a', automationManaged: true, status: 'pending' },
    { id: 'b0', garmentId: 'b', automationManaged: true, status: 'pending' },
  ] as Job[];
  assert.equal(summarizeAutomation(jobs).status, 'processing');
  assert.equal(shouldBackstopPendingJob(jobs[1]), true);
  jobs[1] = { ...jobs[1], status: 'completed', currentOutput: { id: 'o', resultImagePath: 'image.jpg', autoReview: { verdict: 'approved' } } } as Job;
  jobs[2].status = 'failed';
  const done = summarizeAutomation(jobs);
  assert.equal(done.status, 'needs_attention');
  assert.equal(done.outputImages.length, 1);
  assert.equal(done.progress.failed, 2);
});

test('manual drafts and retries retain behavior; automated retries use the exact correction once', () => {
  assert.deepEqual(automationScenePatch(undefined), {});
  const manual = { generationKind: 'product', promptBase: 'Original scene', requestedPromptBase: 'Original scene' } as Job;
  const legacy = buildAutomaticRetryPromptPatch(manual, 'Correction');
  assert.match(legacy.finalPrompt, /Original scene\nCorrection: Correction/);
  const auto = { ...manual, automationManaged: true, automationJobId: 'order', autoReviewMaxAttempts: 8 };
  assert.deepEqual(buildAutomaticRetryPromptPatch(auto, '  Complete corrected prompt  '), { promptBase: '  Complete corrected prompt  ', finalPrompt: '  Complete corrected prompt  ' });
  const patch = buildRegenerateJobPatch(auto, 'fal-seedream', 'New manual prompt');
  assert.equal(patch.automationManaged, false); assert.equal(patch.automationGate, null); assert.equal(patch.autoReviewMaxAttempts, 3);
  assert.equal((patch as any).automationJobId, undefined); // The persisted association is retained because it is never overwritten.
});

test('Drive requires explicit item mapping and validates folder URLs without trusting folder names', () => {
  assert.equal(parseDriveFolderId('https://drive.google.com/drive/folders/folder-123?usp=sharing'), 'folder-123');
  assert.throws(() => parseDriveFolderId('https://drive.google.com.evil.example/drive/folders/folder-123'));
  const base = { source: 'api', externalId: 'test', clientId: 'client', jobType: 'product' };
  assert.throws(() => validateAutomationInput({ ...base, inputImages: [{ fileName: 'item.jpg', driveFile: { folderId: 'folder', fileId: 'file' } }] }, 'user'));
  const entry = { itemId: 'article', fileName: 'reference.jpg', driveFile: { folderId: 'folder', fileId: 'file', revisionId: 'revision' } };
  assert.deepEqual(validateAutomationInput({ ...base, inputImages: [entry] }, 'user').inputImages, [entry]);
  assert.throws(() => validateAutomationInput({ ...base, inputImages: [{ ...entry, url: 'https://example.com/a.jpg' }] }, 'user'));
});

test('malformed automation configuration cannot block manual configuration or change its retry limits', () => {
  const { sanitizeSystemConfig } = require('../functions/lib/functions/src/admin/systemConfig.js');
  const config = sanitizeSystemConfig({ jobMaxRetries: 7, automationBudget: { maxBudgetUsd: -1 } });
  assert.equal(config.jobMaxRetries, 7);
  assert.equal(config.automationBudget.maxReviewAttempts, 3);
});
