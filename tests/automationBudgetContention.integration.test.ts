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

  // Concurrent settlements: unknown outcomes keep the whole hold; recorded ones release the unused difference.
  await Promise.all(reserved.map((outcome, index) =>
    settleAutomationOperation(automationId, outcome.value, index % 2 ? null : 0.03)));
  job = (await db.collection('automationJobs').doc(automationId).get()).data();
  assert.ok(Math.abs(job.budget.reservedUsd) < 1e-6, String(job.budget.reservedUsd));
  assert.ok(Math.abs(job.budget.spentUsd - (13 * 0.03 + 12 * 0.04)) < 1e-6, 'Solo los resultados registrados liberan la diferencia');
  assert.ok(Math.abs(job.budget.uncertainUsd - 12 * 0.04) < 1e-6);
  // Duplicate concurrent deliveries must not settle twice.
  await Promise.all(reserved.map(outcome => settleAutomationOperation(automationId, outcome.value, 0)));
  assert.deepEqual((await db.collection('automationJobs').doc(automationId).get()).data().budget, job.budget);
  assert.ok(Math.abs(job.budget.recordedUsd - 13 * 0.03) < 1e-6);
  assert.ok(job.budget.spentUsd + job.budget.reservedUsd <= job.budget.limitUsd + 1e-6);
  await assert.rejects(reserveAutomationOperation(automationId, 'review:late', 'review', 0.04), /detenido/);
});

test('reserva → costo menor permite otra llamada; timeout conserva exposición e idempotencia (emulador)', { skip: !enabled }, async () => {
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-manglar-automation' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { reserveAutomationOperation, settleAutomationOperation } = require('../functions/lib/functions/src/automation/budget.js');
  const clientId = `settlement-${randomUUID()}`, automationId = `automation-${randomUUID()}`;
  await db.collection('clients').doc(clientId).set({ status: 'active' });
  const ref = db.collection('automationJobs').doc(automationId);
  await ref.set({ clientId, createdByUid: 'uid', jobType: 'garment',
    effectivePolicy: { allowEstimatedCosts: true, authorizeClassification: true, maxReviewAttempts: 3, maxOperationalRetries: 2 },
    budget: { limitUsd: 0.55, reservedUsd: 0, spentUsd: 0, recordedUsd: 0, uncertainUsd: 0 } });
  const first = await reserveAutomationOperation(automationId, 'first', 'generation', 0.5);
  await settleAutomationOperation(automationId, first, 0.03);
  const second = await reserveAutomationOperation(automationId, 'second', 'generation', 0.5);
  await Promise.all(Array.from({ length: 10 }, () => settleAutomationOperation(automationId, second, null)));
  // A later delivery must never "correct" an ambiguous timeout to zero automatically.
  await settleAutomationOperation(automationId, second, 0);
  const budget = (await ref.get()).data().budget;
  assert.ok(Math.abs(budget.reservedUsd) < 1e-6);
  assert.ok(Math.abs(budget.spentUsd - 0.53) < 1e-6);
  assert.ok(Math.abs(budget.recordedUsd - 0.03) < 1e-6);
  assert.ok(Math.abs(budget.uncertainUsd - 0.5) < 1e-6);
});
