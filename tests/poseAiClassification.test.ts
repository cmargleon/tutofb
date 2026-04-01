import test from 'node:test';
import assert from 'node:assert/strict';
import * as poseAiClassificationNamespace from '../shared/src/utils/poseAiClassification';

const poseAiClassificationModule =
  ((poseAiClassificationNamespace as { default?: unknown }).default as typeof import('../shared/src/utils/poseAiClassification'))
  ?? (poseAiClassificationNamespace as typeof import('../shared/src/utils/poseAiClassification'));

const {
  buildPoseAiClassification,
  buildPoseAutoCategory,
  derivePoseUsableForGarmentViews,
  formatPoseAutoCategoryLabel,
} = poseAiClassificationModule as typeof import('../shared/src/utils/poseAiClassification');

test('buildPoseAutoCategory compone categorias estables para frente y espalda', () => {
  assert.equal(buildPoseAutoCategory('front', 'full_body'), 'frente_cuerpo_completo');
  assert.equal(buildPoseAutoCategory('back_three_quarter', 'medium_body'), 'espalda_3_4_medio_cuerpo');
});

test('derivePoseUsableForGarmentViews abre 3/4 a side sin perder el match principal', () => {
  assert.deepEqual(derivePoseUsableForGarmentViews('front_three_quarter'), ['front', 'side']);
  assert.deepEqual(derivePoseUsableForGarmentViews('back'), ['back']);
  assert.deepEqual(derivePoseUsableForGarmentViews('left_profile'), ['side']);
});

test('buildPoseAiClassification genera metadata lista para Firestore y UI', () => {
  const classification = buildPoseAiClassification({
    orientationDetail: 'right_profile',
    framing: 'three_quarter_body',
    faceVisible: true,
    confidence: 0.82,
    taggedAt: new Date().toISOString(),
    reasoning: 'Perfil claro del cuerpo hacia la derecha.',
  });

  assert.equal(classification.orientationGroup, 'side');
  assert.equal(classification.autoCategory, 'perfil_derecho_tres_cuartos');
  assert.deepEqual(classification.usableForGarmentViews, ['side']);
  assert.equal(classification.taggedBy, 'gemini');
  assert.equal(classification.reasoning, 'Perfil claro del cuerpo hacia la derecha.');
});

test('formatPoseAutoCategoryLabel vuelve legible la categoria tecnica', () => {
  assert.equal(formatPoseAutoCategoryLabel('frente_3_4_cuerpo_completo'), 'Frente 3/4 Cuerpo Completo');
  assert.equal(formatPoseAutoCategoryLabel(null), 'Sin tag IA');
});
