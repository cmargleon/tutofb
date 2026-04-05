import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { HttpsError } from 'firebase-functions/v2/https';
import { Client, Model } from '../shared/src/types';

const require = createRequire(import.meta.url);
const createBatchHelpers = require('../functions/lib/functions/src/callables/createGenerationBatch.helpers.js');

const {
  assertModelOwnershipAndPoses,
  buildJobDraft,
  getCompatibleGarmentPoseCombinations,
  resolveJobPromptCase,
  resolveGarmentPhotoForPose,
  validateCreateGenerationBatchInput,
} = createBatchHelpers as {
  assertModelOwnershipAndPoses: typeof import('../functions/src/callables/createGenerationBatch.helpers').assertModelOwnershipAndPoses;
  buildJobDraft: typeof import('../functions/src/callables/createGenerationBatch.helpers').buildJobDraft;
  getCompatibleGarmentPoseCombinations: typeof import('../functions/src/callables/createGenerationBatch.helpers').getCompatibleGarmentPoseCombinations;
  resolveJobPromptCase: typeof import('../functions/src/callables/createGenerationBatch.helpers').resolveJobPromptCase;
  resolveGarmentPhotoForPose: typeof import('../functions/src/callables/createGenerationBatch.helpers').resolveGarmentPhotoForPose;
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

const defaultPromptCases = {
  full_outfit: `GARMENT TYPE RULE - CASE A - FULL OUTFIT:
- Apply the complete outfit exactly as shown
- Do not modify, replace, or invent any part`,
  top_only: `GARMENT TYPE RULE - CASE B - TOP ONLY:
- Apply the top exactly as shown
- For the bottom: ALWAYS use plain black leggings
- Leggings must be simple, with no logos, textures, or patterns
- Never generate bottom garments outside this fallback rule`,
  bottom_only: `GARMENT TYPE RULE - CASE C - BOTTOM ONLY:
- Apply the bottom exactly as shown
- For the top: ALWAYS use a plain white fitted bodysuit
- The bodysuit must have no logos, textures, or patterns
- Never generate top garments outside this fallback rule`,
} as const;

const baseTemplateFields = {
  spreadsheetTemplateId: 'template-1',
  spreadsheetCategoryId: 'category-1',
};

const buildProductDraft = (garmentId: string, garmentName: string) => ({
  garmentId,
  garmentName,
  categoryId: 'category-1',
  categoryName: 'Categoría test',
  rows: [
    {
      id: `row-${garmentId}`,
      values: {
        supplier_code: `${garmentId}-sku`,
      },
    },
  ],
});

test('validateCreateGenerationBatchInput usa datos reales del wizard y limpia el prompt', () => {
  const validated = validateCreateGenerationBatchInput(
    {
      ...baseTemplateFields,
      clientId: 'client-1',
      modelId: 'model-1',
      poseIds: ['pose-1', 'pose-1', 'pose-2'],
      garments: [
        {
          id: 'gar-1',
          name: 'Vestido Azul',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
          isMultiAngle: true,
          sourceType: 'subfolder',
          originalFileNames: ['front.jpg', 'back.jpg'],
          originalPhotoCount: 2,
          photos: [
            {
              id: 'gar-1-front',
              fileName: 'front.jpg',
              storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
              sourceIndex: 0,
              view: 'front',
              classifiedBy: 'gemini',
            },
            {
              id: 'gar-1-back',
              fileName: 'back.jpg',
              storagePath: 'garments/drafts/user-1/draft-1/gar-1/back.jpg',
              sourceIndex: 1,
              view: 'back',
              classifiedBy: 'gemini',
            },
          ],
        },
      ],
      productDrafts: [buildProductDraft('gar-1', 'Vestido Azul')],
      provider: 'fal-banana-pro',
      promptBase: ' Prompt real ',
      imageConfig: {
        provider: 'fal-banana-pro',
        aspectRatio: '9:16',
        resolution: '2K',
      },
    },
    'user-1',
    10,
  );

  assert.equal(validated.provider, 'fal-banana-pro');
  assert.equal(validated.aspectRatio, '9:16');
  assert.equal(validated.imageConfig.provider, 'fal-banana-pro');
  assert.equal(validated.imageConfig.resolution, '2K');
  assert.equal(validated.promptBase, 'Prompt real');
  assert.deepEqual(validated.poseIds, ['pose-1', 'pose-2']);
  assert.equal(validated.totalJobs, 2);
  assert.equal(validated.garments[0]?.photos?.length, 2);
  assert.equal(validated.garments[0]?.garmentBodyArea, null);
});

test('validateCreateGenerationBatchInput conserva provider y calcula jobs por pose-prenda', () => {
  const validated = validateCreateGenerationBatchInput(
    {
      ...baseTemplateFields,
      clientId: 'client-1',
      modelId: 'model-1',
      poseIds: ['pose-1', 'pose-2'],
      garments: [
        {
          id: 'gar-1',
          name: 'Vestido Azul',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1.jpg',
          isMultiAngle: false,
        },
      ],
      productDrafts: [buildProductDraft('gar-1', 'Vestido Azul')],
      provider: 'openai-gpt-image-1.5',
      promptBase: 'Prompt lote',
      imageConfig: {
        provider: 'openai-gpt-image-1.5',
        size: '1024x1536',
        quality: 'high',
      },
    },
    'user-1',
    20,
  );

  assert.equal(validated.provider, 'openai-gpt-image-1.5');
  assert.equal(validated.aspectRatio, '2:3');
  assert.equal(validated.totalJobs, 2);
});

test('validateCreateGenerationBatchInput rechaza provider inválido', () => {
  assert.throws(
    () =>
      validateCreateGenerationBatchInput(
        {
          ...baseTemplateFields,
          clientId: 'client-1',
          modelId: 'model-1',
          poseIds: ['pose-1'],
          garments: [
            {
              id: 'gar-1',
              name: 'Vestido Azul',
              storagePath: 'garments/drafts/user-1/draft-1/gar-1.jpg',
              isMultiAngle: false,
            },
          ],
          productDrafts: [buildProductDraft('gar-1', 'Vestido Azul')],
          provider: 'otro-provider' as any,
          promptBase: 'Prompt lote',
          imageConfig: {
            provider: 'fal-seedream',
            imageSize: 'portrait_4_3',
          },
        },
        'user-1',
        20,
      ),
    /proveedor no compatible/i,
  );
});

test('validateCreateGenerationBatchInput rechaza prendas fuera del draft del usuario', () => {
  assert.throws(
    () =>
      validateCreateGenerationBatchInput(
        {
          ...baseTemplateFields,
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
          productDrafts: [buildProductDraft('gar-1', 'Vestido Azul')],
          provider: 'fal-seedream',
          promptBase: '',
          imageConfig: {
            provider: 'fal-seedream',
            imageSize: 'portrait_4_3',
          },
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

test('resolveGarmentPhotoForPose prioriza la vista principal y cae a front si hace falta', () => {
  const selectedFrontThreeQuarter = resolveGarmentPhotoForPose(
    {
      id: 'gar-1',
      name: 'Vestido Azul',
      storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
      isMultiAngle: true,
      photos: [
        {
          id: 'gar-1-front',
          fileName: 'front.jpg',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
          sourceIndex: 0,
          view: 'front',
          classifiedBy: 'gemini',
        },
        {
          id: 'gar-1-side',
          fileName: 'side.jpg',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1/side.jpg',
          sourceIndex: 1,
          view: 'side',
          classifiedBy: 'gemini',
        },
      ],
    },
    {
      id: 'pose-front-34',
      fileName: 'pose-front-34.jpg',
      aiClassification: {
        orientationGroup: 'front',
        orientationDetail: 'front_three_quarter',
        framing: 'full_body',
        bodyFocus: 'full_body',
        faceVisible: true,
        autoCategory: 'frente_3_4_cuerpo_completo',
        usableForGarmentViews: ['front', 'side'],
        confidence: 0.9,
        taggedBy: 'gemini',
        taggedAt: new Date(),
        version: 2,
      },
    },
  );

  assert.equal(selectedFrontThreeQuarter.id, 'gar-1-front');

  const selectedFallback = resolveGarmentPhotoForPose(
    {
      id: 'gar-1',
      name: 'Vestido Azul',
      storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
      isMultiAngle: true,
      photos: [
        {
          id: 'gar-1-front',
          fileName: 'front.jpg',
          storagePath: 'garments/drafts/user-1/draft-1/gar-1/front.jpg',
          sourceIndex: 0,
          view: 'front',
          classifiedBy: 'gemini',
        },
      ],
    },
    {
      id: 'pose-back',
      fileName: 'pose-back.jpg',
      aiClassification: {
        orientationGroup: 'back',
        orientationDetail: 'back',
        framing: 'full_body',
        bodyFocus: 'full_body',
        faceVisible: false,
        autoCategory: 'espalda_cuerpo_completo',
        usableForGarmentViews: ['back'],
        confidence: 0.9,
        taggedBy: 'gemini',
        taggedAt: new Date(),
        version: 2,
      },
    },
  );

  assert.equal(selectedFallback.id, 'gar-1-front');
});

test('buildJobDraft usa single_view para el matching nuevo y deja el job en pending', () => {
  const draft = buildJobDraft(
    {
      garmentIsMultiAngle: true,
      garmentReferenceImageType: 'single_view',
      promptCaseKey: 'top_only',
      promptCaseText: defaultPromptCases.top_only,
    },
    'openai-gpt-image-1.5',
    '',
  );

  assert.equal(draft.provider, 'openai-gpt-image-1.5');
  assert.equal(draft.status, 'pending');
  assert.equal(draft.promptCaseKey, 'top_only');
  assert.equal(draft.promptCaseText, defaultPromptCases.top_only);
  assert.match(draft.finalPrompt, /plain black leggings/i);
  assert.doesNotMatch(draft.finalPrompt, /multiples angulos/i);
  assert.doesNotMatch(draft.finalPrompt, /Instrucciones de fondo/i);
  assert.doesNotMatch(draft.finalPrompt, /Evitar en el fondo/i);
});

test('buildJobDraft mantiene la nota de multiangulo en jobs legacy compuestos', () => {
  const draft = buildJobDraft(
    {
      garmentIsMultiAngle: true,
      garmentReferenceImageType: 'multi_angle_composite',
    },
    'openai-gpt-image-1.5',
    '',
  );

  assert.match(draft.finalPrompt, /multiples angulos/i);
});

test('resolveJobPromptCase usa el fallback por defecto cuando la configuración no trae override', () => {
  const resolved = resolveJobPromptCase('lower_body', {
    full_outfit: 'custom A',
    top_only: 'custom B',
    bottom_only: null,
  });

  assert.deepEqual(resolved, {
    promptCaseKey: 'bottom_only',
    promptCaseText: defaultPromptCases.bottom_only,
  });
});

test('getCompatibleGarmentPoseCombinations omite la pose de espalda para prendas solo-front y la mantiene para prendas front-back', () => {
  const combinations = getCompatibleGarmentPoseCombinations(
    [
      {
        id: 'gar-front-back',
        name: 'Multicolor',
        storagePath: 'garments/drafts/user-1/draft-1/gar-front-back/front.jpg',
        isMultiAngle: true,
        garmentBodyArea: 'upper_body',
        photos: [
          {
            id: 'gar-front-back-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-front-back/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
          {
            id: 'gar-front-back-back',
            fileName: 'back.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-front-back/back.jpg',
            sourceIndex: 1,
            view: 'back',
            classifiedBy: 'gemini',
          },
        ],
      },
      {
        id: 'gar-front-only',
        name: 'Frente Solo',
        storagePath: 'garments/drafts/user-1/draft-1/gar-front-only/front.jpg',
        isMultiAngle: false,
        garmentBodyArea: 'upper_body',
        photos: [
          {
            id: 'gar-front-only-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-front-only/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'assumed_single_front',
          },
        ],
      },
    ],
    [
      {
        id: 'pose-front-medium',
        fileName: 'pose-front-medium.jpg',
        storagePath: 'models/client-1/model-1/poses/front-medium.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front_three_quarter',
          framing: 'medium_body',
          bodyFocus: 'upper_body',
          faceVisible: true,
          autoCategory: 'frente_3_4_medio_cuerpo',
          usableForGarmentViews: ['front', 'side'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
      {
        id: 'pose-back',
        fileName: 'pose-back.jpg',
        storagePath: 'models/client-1/model-1/poses/back.jpg',
        aiClassification: {
          orientationGroup: 'back',
          orientationDetail: 'back',
          framing: 'three_quarter_body',
          bodyFocus: 'full_body',
          faceVisible: false,
          autoCategory: 'espalda_tres_cuartos',
          usableForGarmentViews: ['back'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
    ],
  );

  assert.deepEqual(
    combinations.map(({ garment, pose }) => `${garment.id}:${pose.id}`),
    [
      'gar-front-back:pose-front-medium',
      'gar-front-back:pose-back',
      'gar-front-only:pose-front-medium',
    ],
  );
});

test('getCompatibleGarmentPoseCombinations no mezcla poses de tren inferior con prendas upper_body', () => {
  const combinations = getCompatibleGarmentPoseCombinations(
    [
      {
        id: 'gar-bottom',
        name: 'Pantalón Negro',
        storagePath: 'garments/drafts/user-1/draft-1/gar-bottom/front.jpg',
        isMultiAngle: true,
        garmentBodyArea: 'lower_body',
        photos: [
          {
            id: 'gar-bottom-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-bottom/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
          {
            id: 'gar-bottom-back',
            fileName: 'back.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-bottom/back.jpg',
            sourceIndex: 1,
            view: 'back',
            classifiedBy: 'gemini',
          },
        ],
      },
      {
        id: 'gar-top',
        name: 'Blusa Blanca',
        storagePath: 'garments/drafts/user-1/draft-1/gar-top/front.jpg',
        isMultiAngle: true,
        garmentBodyArea: 'upper_body',
        photos: [
          {
            id: 'gar-top-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-top/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
          {
            id: 'gar-top-back',
            fileName: 'back.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-top/back.jpg',
            sourceIndex: 1,
            view: 'back',
            classifiedBy: 'gemini',
          },
        ],
      },
    ],
    [
      {
        id: 'pose-lower-front',
        fileName: 'pose-lower-front.jpg',
        storagePath: 'models/client-1/model-1/poses/lower-front.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'lower_body',
          bodyFocus: 'lower_body',
          faceVisible: false,
          autoCategory: 'frente_tren_inferior',
          usableForGarmentViews: ['front'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
      {
        id: 'pose-upper-front',
        fileName: 'pose-upper-front.jpg',
        storagePath: 'models/client-1/model-1/poses/upper-front.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'medium_body',
          bodyFocus: 'upper_body',
          faceVisible: true,
          autoCategory: 'frente_medio_cuerpo',
          usableForGarmentViews: ['front'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
    ],
  );

  assert.deepEqual(
    combinations.map(({ garment, pose }) => `${garment.id}:${pose.id}`),
    ['gar-bottom:pose-lower-front', 'gar-top:pose-upper-front'],
  );
});
