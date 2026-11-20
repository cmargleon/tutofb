import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { groupModelCatalogPoses, modelBasePoseActiveAfterReview, modelPoseZoneAndShot } = require('../functions/lib/shared/src/modelPoseCatalog.js') as typeof import('../shared/src/modelPoseCatalog');
const { modelBaseSpec } = require('../functions/lib/shared/src/modelPhotoSets.js') as typeof import('../shared/src/modelPhotoSets');
import { modelFromBases, approvedBasesForInput } from './support/modelSetFixtures';
import type { ModelBaseOperation, Pose } from '../shared/src/types';

const fixture = () => modelFromBases(approvedBasesForInput({ clientId: 'test', marketplaces: { shein: { enabled: true }, amazon: { enabled: true } },
  articles: [{ attributes: { category: { value: 'ordinary', source: 'manual' }, audience: { value: 'adult', source: 'manual' }, bodyArea: { value: 'upper_body', source: 'manual' } } }], aspectRatio: '3:4' } as any));
const spec = modelBaseSpec('shein', 'ordinary', 'adult', 'upper_body', 'front', {});
const candidate: Pose = { id: 'candidate', storagePath: 'candidate.jpg', fileName: 'candidate.jpg', marketplaceBaseSpec: spec, active: false, createdAt: null };

test('rejected and technical-error candidates stay inactive; manual approval activates without losing other channels', () => {
  const model = fixture();
  assert.equal(modelBasePoseActiveAfterReview(candidate, []), false);
  assert.equal(modelBasePoseActiveAfterReview({ ...candidate, active: true }, []), false);
  const approval = { ...model.marketplaceBaseApprovals![0], poseId: candidate.id, storagePath: candidate.storagePath };
  assert.equal(modelBasePoseActiveAfterReview(candidate, [approval]), true);
  assert.equal(modelBasePoseActiveAfterReview(candidate, [{ ...approval, spec: { ...approval.spec, channel: 'amazon' } }]), true);
  assert.equal(modelBasePoseActiveAfterReview(candidate, [{ ...approval, requiresReverification: true }]), false);
  assert.equal(modelBasePoseActiveAfterReview(candidate, [{ ...approval, storagePath: 'replaced.jpg' }]), false);
});

test('catalogue groups approvals by channel, deduplicates each channel and retains rejection reasons and identity', () => {
  const model = fixture();
  const approved = model.poses[0];
  const source = model.marketplaceBaseApprovals!.find(a => a.poseId === approved.id)!;
  const first = { ...source, spec: { ...source.spec, channel: 'shein' as const } };
  model.marketplaceBaseApprovals = [first, first, { ...first, spec: { ...first.spec, channel: 'amazon' } }];
  model.poses = [approved, candidate, { ...candidate, id: 'error' }, { ...candidate, id: 'identity', marketplaceBaseSpec: undefined }];
  model.approvedIdentity!.poseId = 'identity';
  const operations = [{ attempts: [{ number: 1, prompt: 'original', poseId: candidate.id, generationCostUsd: .1, verification: { approved: false, poseId: candidate.id, issues: ['Fondo requerido: neutral.'] } }, { number: 2, prompt: 'retry', poseId: 'error', error: 'Gemini timeout' }] }] as ModelBaseOperation[];
  const original = structuredClone(operations);
  let groups = groupModelCatalogPoses(model, operations);
  assert.deepEqual(groups.marketplaces.map(g => g.channel), ['shein', 'amazon', 'tiktok-shop', 'mercado-libre']);
  assert.equal(groups.marketplaces.find(g => g.channel === 'shein')!.poses.length, 1);
  assert.equal(groups.marketplaces.find(g => g.channel === 'amazon')!.poses[0].id, approved.id);
  assert.deepEqual(groups.other.map(p => p.id), ['identity']);
  assert.deepEqual(groups.rejected.map(r => r.reason), ['Fondo requerido: neutral.', 'Gemini timeout']);
  // A later approval takes priority over the immutable rejection history.
  model.marketplaceBaseApprovals.push({ ...first, poseId: candidate.id, storagePath: candidate.storagePath });
  groups = groupModelCatalogPoses(model, operations);
  assert.deepEqual(groups.rejected.map(r => r.pose.id), ['error']);
  assert.deepEqual(operations, original);
  assert.equal(modelPoseZoneAndShot(candidate), 'Superior · Frente');
  assert.equal(modelPoseZoneAndShot({ ...candidate, marketplaceBaseSpec: { ...spec, bodyArea: 'lower_body', shot: 'commercial_back' } }), 'Inferior · Espalda');
  assert.equal(modelPoseZoneAndShot({ ...candidate, marketplaceBaseSpec: { ...spec, bodyArea: 'full_body', shot: 'front_three_quarter' } }), 'Completa · 3/4');
});
