import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { HttpsError } from 'firebase-functions/v2/https';
import { Client, Model } from '../shared/src/types';
const require = createRequire(import.meta.url);
const createBatchHelpers = require('../functions/lib/functions/src/callables/createGenerationBatch.helpers.js');

const { assertModelOwnershipAndPoses, buildJobDraft, validateCreateGenerationBatchInput } = createBatchHelpers as {
  assertModelOwnershipAndPoses: typeof import('../functions/src/callables/createGenerationBatch.helpers').assertModelOwnershipAndPoses;
  buildJobDraft: typeof import('../functions/src/callables/createGenerationBatch.helpers').buildJobDraft;
  validateCreateGenerationBatchInput: typeof import('../functions/src/callables/createGenerationBatch.helpers').validateCreateGenerationBatchInput;
};

const baseModel: Model = {
  id: 'model-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  name: 'Modelo Uno',
  poses: [
    { id: 'pose-1', storagePath: 'models/client-1/model-1/poses/a.jpg', fileName: 'a.jpg', createdAt: new Date() },
    { id: 'pose-2', storagePath: 'models/client-1/model-1/poses/b.jpg', fileName: 'b.jpg', createdAt: new Date() },
  ],
  poseCount: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUid: 'admin',
};

test('validateCreateGenerationBatchInput usa datos reales del wizard y normaliza fondo', () => {
  const validated = validateCreateGenerationBatchInput(
    {
      clientId: 'client-1',
      modelId: 'model-1',
      poseIds: ['pose-1', 'pose-1', 'pose-2'],
      garments: [
        {
          id: 'gar-1',
          name: 'Vestido Azul',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1.jpg',
          isMultiAngle: true,
          sourceType: 'subfolder',
          originalFileNames: ['front.jpg', 'back.jpg'],
        },
      ],
      provider: 'fal-banana-pro',
      promptBase: ' Prompt real ',
      aspectRatio: '9:16',
      backgroundConfig: {
        mode: 'white',
        scene: 'bosque',
        lighting: 'clear_soft_daylight',
        bokehStrength: 80,
        dominantColor: 'black',
        prominence: 'editorial',
        contrast: 'high',
        realism: 'catalogo_realista',
        separation: 'maximum',
        avoidExtraPeople: true,
        avoidDistractingProps: true,
        avoidTextSignage: true,
        customDetail: '  ',
      },
    },
    'user-1',
    10,
  );

  assert.equal(validated.provider, 'fal-banana-pro');
  assert.equal(validated.aspectRatio, '9:16');
  assert.equal(validated.promptBase, 'Prompt real');
  assert.deepEqual(validated.poseIds, ['pose-1', 'pose-2']);
  assert.equal(validated.backgroundConfig.mode, 'white');
  assert.equal(validated.backgroundConfig.scene, 'none');
  assert.equal(validated.backgroundConfig.bokehStrength, 0);
  assert.equal(validated.totalJobs, 2);
});

test('validateCreateGenerationBatchInput rechaza prendas fuera del draft del usuario', () => {
  assert.throws(
    () =>
      validateCreateGenerationBatchInput(
        {
          clientId: 'client-1',
          modelId: 'model-1',
          poseIds: ['pose-1'],
          garments: [
            {
              id: 'gar-1',
              name: 'Vestido Azul',
              storagePath: 'garments/drafts/otro-uid/draft-1/gar-1.jpg',
              isMultiAngle: false,
            },
          ],
          provider: 'fal-seedream',
          promptBase: '',
          aspectRatio: '3:4',
          backgroundConfig: undefined as never,
        },
        'user-1',
        10,
      ),
    (error) =>
      (error instanceof HttpsError && error.code === 'permission-denied')
      || (error instanceof Error && /no pertenece al usuario autenticado/i.test(error.message)),
  );
});

test('assertModelOwnershipAndPoses rechaza poses ajenas o modelos de otro cliente', () => {
  const client: Client = {
    id: 'client-1',
    name: 'Cliente Uno',
    createdAt: new Date(),
    updatedAt: new Date(),
    batchCount: 0,
    lastBatchCreatedAt: null,
    createdByUid: 'admin',
  };

  assert.throws(
    () => assertModelOwnershipAndPoses(client, { ...baseModel, clientId: 'client-2' }, ['pose-1']),
    /no pertenece al cliente/i,
  );

  assert.throws(
    () => assertModelOwnershipAndPoses(client, baseModel, ['pose-3']),
    /no pertenece al modelo/i,
  );
});

test('buildJobDraft prepara el prompt final para multiangulo y deja el job en pending', () => {
  const draft = buildJobDraft(
    {
      backgroundConfig: {
        mode: 'white',
        scene: 'none',
        lighting: 'clear_soft_daylight',
        bokehStrength: 0,
        dominantColor: 'white',
        prominence: 'minimal',
        contrast: 'soft',
        realism: 'catalogo_realista',
        separation: 'strong',
        avoidExtraPeople: true,
        avoidDistractingProps: true,
        avoidTextSignage: true,
        customDetail: '',
      },
      garmentIsMultiAngle: true,
    },
    'openai-gpt-image-1.5',
    '',
  );

  assert.equal(draft.provider, 'openai-gpt-image-1.5');
  assert.equal(draft.status, 'pending');
  assert.match(draft.finalPrompt, /multiples angulos/i);
});
