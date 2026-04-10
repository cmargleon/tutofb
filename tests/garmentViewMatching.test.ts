import test from 'node:test';
import assert from 'node:assert/strict';
import { GarmentView, PoseAiClassification, PoseBodyFocus } from '../shared/src/types';
import * as garmentViewMatchingNamespace from '../shared/src/utils/garmentViewMatching';

const garmentViewMatchingModule =
  ((garmentViewMatchingNamespace as { default?: unknown }).default as typeof import('../shared/src/utils/garmentViewMatching'))
  ?? (garmentViewMatchingNamespace as typeof import('../shared/src/utils/garmentViewMatching'));

const {
  countCompatibleGarmentsForPose,
  countCompatiblePoseMatchesForGarments,
  getSuggestedPoseIdsForGarments,
  selectBestGarmentPhotoForPose,
} =
  garmentViewMatchingModule as typeof import('../shared/src/utils/garmentViewMatching');

const buildAiClassification = (
  usableForGarmentViews: GarmentView[],
  bodyFocus: PoseBodyFocus = 'full_body',
  faceVisible = true,
): PoseAiClassification => ({
  orientationGroup: 'front',
  orientationDetail: 'front',
  framing: 'full_body',
  bodyFocus,
  faceVisible,
  autoCategory: 'frente_cuerpo_completo',
  usableForGarmentViews,
  confidence: 0.9,
  taggedBy: 'gemini',
  taggedAt: new Date(),
  version: 2,
});

test('getSuggestedPoseIdsForGarments arma una union util para el lote y no solo la interseccion', () => {
  const suggested = getSuggestedPoseIdsForGarments(
    [
      {
        id: 'pose-front',
        aiClassification: buildAiClassification(['front']),
      },
      {
        id: 'pose-back',
        aiClassification: buildAiClassification(['back']),
      },
      {
        id: 'pose-front-side',
        aiClassification: buildAiClassification(['front', 'side']),
      },
      {
        id: 'pose-untagged',
        aiClassification: null,
      },
    ],
    [
      { availableViews: ['front', 'back'] },
      { availableViews: ['front', 'side'] },
    ],
  );

  assert.deepEqual(suggested, ['pose-front', 'pose-back', 'pose-front-side']);
});

test('selectBestGarmentPhotoForPose respeta el orden de usableForGarmentViews y luego cae a front', () => {
  const photos = [
    { id: 'front-photo', view: 'front', sourceIndex: 0 },
    { id: 'side-photo', view: 'side', sourceIndex: 1 },
  ] as const;

  const frontPreferred = selectBestGarmentPhotoForPose(
    buildAiClassification(['front', 'side']),
    photos,
  );
  assert.equal(frontPreferred?.id, 'front-photo');

  const fallbackToFront = selectBestGarmentPhotoForPose(
    buildAiClassification(['back']),
    photos,
  );
  assert.equal(fallbackToFront?.id, 'front-photo');
});

test('countCompatiblePoseMatchesForGarments cuenta solo las combinaciones pose-prenda realmente generables', () => {
  const count = countCompatiblePoseMatchesForGarments(
    [
      { id: 'pose-front', aiClassification: buildAiClassification(['front']) },
      { id: 'pose-back', aiClassification: buildAiClassification(['back']) },
      { id: 'pose-front-side', aiClassification: buildAiClassification(['front', 'side']) },
    ],
    [
      { availableViews: ['front', 'back'] },
      { availableViews: ['front'] },
    ],
  );

  assert.equal(count, 5);
});

test('countCompatibleGarmentsForPose deja claro cuantas prendas del lote usan una pose dada', () => {
  const count = countCompatibleGarmentsForPose(
    buildAiClassification(['back']),
    [
      { availableViews: ['front', 'back'] },
      { availableViews: ['front'] },
      { availableViews: ['front', 'side'] },
    ],
  );

  assert.equal(count, 1);
});

test('getSuggestedPoseIdsForGarments restringe poses de tren inferior a prendas lower_body compatibles', () => {
  const suggested = getSuggestedPoseIdsForGarments(
    [
      {
        id: 'pose-lower-front',
        aiClassification: buildAiClassification(['front'], 'lower_body'),
      },
      {
        id: 'pose-upper-front',
        aiClassification: buildAiClassification(['front'], 'upper_body'),
      },
    ],
    [
      { availableViews: ['front'], garmentBodyArea: 'lower_body' as const },
      { availableViews: ['front'], garmentBodyArea: 'upper_body' as const },
    ],
  );

  assert.deepEqual(suggested, ['pose-lower-front', 'pose-upper-front']);
  assert.equal(
    countCompatibleGarmentsForPose(
      buildAiClassification(['front'], 'lower_body'),
      [{ availableViews: ['front'], garmentBodyArea: 'upper_body' as const }],
    ),
    0,
  );
});

test('getSuggestedPoseIdsForGarments restringe accesorios de cabeza a poses con rostro visible', () => {
  const suggested = getSuggestedPoseIdsForGarments(
    [
      {
        id: 'pose-portrait-front',
        aiClassification: buildAiClassification(['front'], 'upper_body', true),
      },
      {
        id: 'pose-full-back',
        aiClassification: buildAiClassification(['back'], 'full_body', false),
      },
      {
        id: 'pose-lower-front',
        aiClassification: buildAiClassification(['front'], 'lower_body', false),
      },
    ],
    [
      { availableViews: ['front'], garmentBodyArea: 'head_accessory' as const },
      { availableViews: ['back'], garmentBodyArea: 'head_accessory' as const },
    ],
  );

  assert.deepEqual(suggested, ['pose-portrait-front']);
  assert.equal(
    countCompatibleGarmentsForPose(
      buildAiClassification(['front'], 'full_body', false),
      [{ availableViews: ['front'], garmentBodyArea: 'head_accessory' as const }],
    ),
    0,
  );
});

test('countCompatibleGarmentsForPose permite close-ups de pies para calzado', () => {
  const count = countCompatibleGarmentsForPose(
    buildAiClassification(['front', 'side'], 'feet', false),
    [
      { availableViews: ['front'], garmentBodyArea: 'footwear' as const },
      { availableViews: ['side'], garmentBodyArea: 'footwear' as const },
      { availableViews: ['front'], garmentBodyArea: 'upper_body' as const },
    ],
  );

  assert.equal(count, 2);
});
