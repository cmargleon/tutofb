import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST;

// Regression: 33 workers of one organizer automation job reserving budget at once failed with
// "10 ABORTED: cross-transaction contention" and burned their retries without generating.
test('reservas concurrentes del mismo trabajo: ninguna aborta por contención y ninguna excede limitUsd (emulador)', { skip: !enabled }, async () => {
  const admin = require('../functions/node_modules/firebase-admin');
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { reserveAutomationOperation, settleAutomationOperation, AutomationBudgetError } = require('../functions/lib/functions/src/automation/budget.js');
  const clientId = `contention-${randomUUID()}`;
  const automationId = `automation-${randomUUID()}`;
  await db.collection('clients').doc(clientId).set({ name: 'Contention', status: 'active' });
  await db.collection('automationJobs').doc(automationId).set({ clientId, createdByUid: 'uid', jobType: 'garment',
    effectivePolicy: { allowEstimatedCosts: true, authorizeClassification: true, maxReviewAttempts: 3, maxOperationalRetries: 2 },
    budget: { limitUsd: 1, reservedUsd: 0, spentUsd: 0, recordedUsd: 0 } });

  const outcomes = await Promise.allSettled(Array.from({ length: 40 }, (_, index) =>
    reserveAutomationOperation(automationId, `review:${index}`, 'review', 0.04)));
  const unexpected = outcomes.filter(outcome => outcome.status === 'rejected' && !(outcome.reason instanceof AutomationBudgetError));
  assert.deepEqual(unexpected.map(outcome => String((outcome as PromiseRejectedResult).reason)), [], 'Sin errores de contención');
  const reserved = outcomes.filter((outcome): outcome is PromiseFulfilledResult<string> => outcome.status === 'fulfilled');
  assert.equal(reserved.length, 25, 'Todas las que caben en USD 1 a 0,04 terminan');
  let job = (await db.collection('automationJobs').doc(automationId).get()).data();
  assert.ok(Math.abs(job.budget.reservedUsd - 1) < 1e-6, String(job.budget.reservedUsd));
  assert.equal((await db.collection('automationJobs').doc(automationId).collection('operations').get()).size, 25);
  assert.equal(job.spendingPaused, true);

  // Concurrent settlements: unknown outcomes keep the whole hold; recorded ones charge the max(hold, recorded).
  await Promise.all(reserved.map((outcome, index) =>
    settleAutomationOperation(automationId, outcome.value, index % 2 ? null : 0.03)));
  job = (await db.collection('automationJobs').doc(automationId).get()).data();
  assert.ok(Math.abs(job.budget.reservedUsd) < 1e-6, String(job.budget.reservedUsd));
  assert.ok(Math.abs(job.budget.spentUsd - 1) < 1e-6, 'Los resultados inciertos no liberan dinero');
  assert.ok(Math.abs(job.budget.recordedUsd - 13 * 0.03) < 1e-6);
  assert.ok(job.budget.spentUsd + job.budget.reservedUsd <= job.budget.limitUsd + 1e-6);
  await assert.rejects(reserveAutomationOperation(automationId, 'review:late', 'review', 0.04), /detenido/);
});
