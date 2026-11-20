import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { modelBaseSpec, buildModelBasePrompt } = require('../functions/lib/shared/src/modelPhotoSets.js');
const { modelBaseRetryPrompt, modelBaseReviewOutcome } = require('../functions/lib/functions/src/models/marketplaceSetPolicy.js');

test('marketplace retries preserve the immutable prompt, only reliable visual rejections regenerate, stop at three', () => {
  const spec = { ...modelBaseSpec('amazon', 'ordinary', 'adult', 'full_body', 'front', {}), poseRecipeId: 'full-contrapposto' };
  const original = buildModelBasePrompt(spec);
  assert.equal(modelBaseRetryPrompt(spec, []), original);
  const corrected = modelBaseRetryPrompt(spec, ['Fondo requerido: white.', 'Fondo requerido: white.']);
  assert.ok(corrected.startsWith(original)); assert.ok(corrected.endsWith(original));
  assert.equal(corrected.match(/Fondo requerido/g).length, 1);
  assert.equal(modelBaseReviewOutcome({ approved: true }, 1), 'approved');
  assert.equal(modelBaseReviewOutcome({ approved: false }, 1), 'needs_attention');
  assert.equal(modelBaseReviewOutcome({ approved: false, observation: { verified: false } }, 1), 'needs_attention');
  for (const number of [1, 2]) assert.equal(modelBaseReviewOutcome({ approved: false, observation: { verified: true } }, number), 'queued');
  assert.equal(modelBaseReviewOutcome({ approved: false, observation: { verified: true } }, 3), 'needs_attention');
});

test('real Gemini verifier records usage before parsing and treats malformed observations as errors', async t => {
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const sharp = require('../functions/node_modules/sharp');
  const bytes = await sharp({ create: { width: 30, height: 40, channels: 3, background: 'white' } }).png().toBuffer();
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'download', async () => [bytes]);
  const usage = require('../functions/lib/functions/src/analytics/geminiUsage.js');
  let payload: any = { confidence: .99, faceVisible: true, photoObservation: { background: 'white' } };
  t.mock.method(usage, 'callGeminiGenerateContent', async () => ({
    payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }, usage: { estimatedCostUsd: .004 },
  }));
  const { classifyPoseWithGemini } = require('../functions/lib/functions/src/utils/classifyPose.js');
  let tracked = 0;
  const input = { apiKey: 'test-only', model: 'fixture', pose: { id: 'fixture', fileName: 'fixture.png', storagePath: 'fixtures/base.png', marketplaceBaseSpec: modelBaseSpec('amazon', 'ordinary', 'adult', 'full_body', 'front', {}) },
    identityStoragePath: 'fixtures/identity.png', onUsage: async (cost: number) => { tracked += cost; } };
  await assert.rejects(classifyPoseWithGemini(input), /Respuesta incompleta/);
  assert.equal(tracked, .004);
  payload = { ...payload, confidence: .4, photoObservation: { concretePoseMatches: true, lookingAtCamera: true, mainPoseCompliant: true, identityCoherent: true, garmentVisible: true, accessories: false,
    pose: 'front', framing: 'full_body', background: 'white', audience: 'adult', posture: 'standing' } };
  const uncertain = await classifyPoseWithGemini(input);
  assert.equal(uncertain.photoObservation.verified, false);
  assert.equal(uncertain.photoObservation.whiteRgbVerified, true);
  assert.equal(uncertain.photoObservation.width, 30);
  assert.equal(uncertain.photoObservation.height, 40);
  assert.equal(tracked, .008);
  await admin.app().delete();
});
