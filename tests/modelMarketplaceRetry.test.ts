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
  let submitted: any;
  t.mock.method(usage, 'callGeminiGenerateContent', async (request: any) => { submitted = request; return ({
    payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }, usage: { estimatedCostUsd: .004 },
  }); });
  const { classifyPoseWithGemini } = require('../functions/lib/functions/src/utils/classifyPose.js');
  let tracked = 0;
  const input = { apiKey: 'test-only', model: 'fixture', pose: { id: 'fixture', fileName: 'fixture.png', storagePath: 'fixtures/base.png', marketplaceBaseSpec: modelBaseSpec('amazon', 'ordinary', 'adult', 'full_body', 'front', {}) },
    identityStoragePath: 'fixtures/identity.png', performer: 'synthetic', onUsage: async (cost: number) => { tracked += cost; } };
  await assert.rejects(classifyPoseWithGemini(input), /Respuesta incompleta/);
  assert.equal(tracked, .004);
  payload = { ...payload, confidence: .4, photoObservation: { concretePoseMatches: true, lookingAtCamera: true, mainPoseCompliant: true, identityCoherent: true, garmentVisible: true, accessories: false,
    pose: 'front', framing: 'full_body', background: 'white', backgroundTone: 'white', backgroundMatches: true, backgroundEvidence: 'Uniform white backdrop', audience: 'adult', posture: 'standing' } };
  const uncertain = await classifyPoseWithGemini(input);
  assert.equal(uncertain.photoObservation.verified, false);
  assert.equal(uncertain.photoObservation.whiteRgbVerified, true);
  assert.equal(uncertain.photoObservation.width, 30);
  assert.equal(uncertain.photoObservation.height, 40);
  assert.equal(tracked, .008);
  const { baseObservationIssues } = require('../functions/lib/shared/src/modelPhotoSets.js');
  input.pose.marketplaceBaseSpec = { ...modelBaseSpec('shein', 'ordinary', 'adult', 'full_body', 'front', {}), backgroundTone: 'light_gray' };
  payload.confidence = .99;
  payload.photoObservation.backgroundMatches = false;
  const rejected = await classifyPoseWithGemini(input);
  assert.ok(submitted.body.contents[0].parts[0].text.includes('Light gray neutral seamless paper backdrop'));
  assert.ok(submitted.body.contents[0].parts[0].text.includes('never against the identity background'));
  assert.ok(baseObservationIssues(input.pose.marketplaceBaseSpec, rejected.photoObservation).includes('Fondo requerido: gris claro neutro; observado: blanco.'));
  payload.photoObservation = { ...payload.photoObservation, background: 'neutral', backgroundTone: 'light_gray', backgroundMatches: true, backgroundEvidence: 'Light gray seamless backdrop visibly darker than white.' };
  const accepted = await classifyPoseWithGemini(input);
  assert.deepEqual(baseObservationIssues(input.pose.marketplaceBaseSpec, accepted.photoObservation), []);
  await admin.app().delete();
});
