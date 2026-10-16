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
      provider: 'fal-gpt-image-2',
      promptBase: 'Prompt lote',
      imageConfig: {
        provider: 'fal-gpt-image-2',
        imageSize: { width: 1024, height: 1536 },
        outputFormat: 'png',
        quality: 'high',
      },
    },
    'user-1',
    20,
  );

  assert.equal(validated.provider, 'fal-gpt-image-2');
  assert.equal(validated.aspectRatio, '2:3');
  assert.equal(validated.totalJobs, 2);
});

test('validateCreateGenerationBatchInput conserva accesorios de carga y tipo mochila', () => {
  const validated = validateCreateGenerationBatchInput(
    {
      clientId: 'client-1',
      modelId: 'model-1',
      outputMode: 'photos_only',
      poseIds: ['pose-1'],
      garments: [
        {
          id: 'gar-backpack',
          name: 'Mochila negra',
          storagePath: 'garments/drafts/user-1/draft-1/gar-backpack/front.jpg',
          isMultiAngle: false,
          garmentBodyArea: 'carry_accessory',
          garmentAccessoryType: 'backpack',
          photos: [
            {
              id: 'gar-backpack-front',
              fileName: 'front.jpg',
              storagePath: 'garments/drafts/user-1/draft-1/gar-backpack/front.jpg',
              sourceIndex: 0,
              view: 'front',
              classifiedBy: 'gemini',
            },
          ],
        },
      ],
      productDrafts: [],
      provider: 'fal-seedream',
      promptBase: 'Prompt',
    },
    'user-1',
    10,
  );

  assert.equal(validated.garments[0]?.garmentBodyArea, 'carry_accessory');
  assert.equal(validated.garments[0]?.garmentAccessoryType, 'backpack');
});

test('validateCreateGenerationBatchInput conserva configuración de GPT Image 2', () => {
  const validated = validateCreateGenerationBatchInput(
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
      provider: 'fal-gpt-image-2',
      promptBase: 'Prompt lote',
      imageConfig: {
        provider: 'fal-gpt-image-2',
        imageSize: { width: 1280, height: 720 },
        quality: 'high',
        outputFormat: 'webp',
      },
    },
    'user-1',
    20,
  );

  assert.equal(validated.provider, 'fal-gpt-image-2');
  assert.equal(validated.aspectRatio, '16:9');
  assert.equal(validated.imageConfig.provider, 'fal-gpt-image-2');
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
    'fal-gpt-image-2',
    '',
  );

  assert.equal(draft.provider, 'fal-gpt-image-2');
  assert.equal(draft.status, 'pending');
  assert.equal(draft.promptCaseKey, 'top_only');
  assert.equal(draft.promptCaseText, defaultPromptCases.top_only);
  assert.match(draft.finalPrompt, /plain black leggings/i);
  assert.match(draft.finalPrompt, /INTERNAL GARMENT DETAILS \(CRITICAL\)/);
  assert.match(draft.finalPrompt, /internal label|inside of the garment/i);
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
    'fal-gpt-image-2',
    '',
  );

  assert.match(draft.finalPrompt, /multiples angulos/i);
});

test('buildJobDraft no duplica la regla de etiquetas internas si el prompt base ya la incluye', () => {
  const marker = 'INTERNAL GARMENT DETAILS (CRITICAL)';
  const draft = buildJobDraft(
    {
      garmentIsMultiAngle: false,
      garmentReferenceImageType: 'single_view',
    },
    'fal-gpt-image-2',
    `Prompt custom\n\n${marker}\n\n- Keep inside labels hidden.`,
  );

  const markerCount = draft.finalPrompt.split(marker).length - 1;
  assert.equal(markerCount, 1);
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

test('getCompatibleGarmentPoseCombinations aplica matching estricto para calzado y accesorios de rostro', () => {
  const combinations = getCompatibleGarmentPoseCombinations(
    [
      {
        id: 'gar-shoes',
        name: 'Tenis Blanco',
        storagePath: 'garments/drafts/user-1/draft-1/gar-shoes/front.jpg',
        isMultiAngle: true,
        garmentBodyArea: 'footwear',
        photos: [
          {
            id: 'gar-shoes-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-shoes/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
        ],
      },
      {
        id: 'gar-glasses',
        name: 'Lentes',
        storagePath: 'garments/drafts/user-1/draft-1/gar-glasses/front.jpg',
        isMultiAngle: true,
        garmentBodyArea: 'head_accessory',
        photos: [
          {
            id: 'gar-glasses-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-glasses/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
        ],
      },
    ],
    [
      {
        id: 'pose-feet-front',
        fileName: 'pose-feet-front.jpg',
        storagePath: 'models/client-1/model-1/poses/feet-front.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'feet_closeup',
          bodyFocus: 'feet',
          faceVisible: false,
          autoCategory: 'frente_primer_plano_pies',
          usableForGarmentViews: ['front'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
      {
        id: 'pose-full-front',
        fileName: 'pose-full-front.jpg',
        storagePath: 'models/client-1/model-1/poses/full-front.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'full_body',
          bodyFocus: 'full_body',
          faceVisible: true,
          autoCategory: 'frente_cuerpo_completo',
          usableForGarmentViews: ['front'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 2,
        },
      },
      {
        id: 'pose-portrait-front',
        fileName: 'pose-portrait-front.jpg',
        storagePath: 'models/client-1/model-1/poses/portrait-front.jpg',
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
      {
        id: 'pose-untagged',
        fileName: 'pose-untagged.jpg',
        storagePath: 'models/client-1/model-1/poses/untagged.jpg',
        aiClassification: null,
      },
    ],
  );

  assert.deepEqual(
    combinations.map(({ garment, pose }) => `${garment.id}:${pose.id}`),
    ['gar-shoes:pose-feet-front', 'gar-glasses:pose-portrait-front'],
  );
});

test('getCompatibleGarmentPoseCombinations permite mochila frontal de producto solo en poses de espalda', () => {
  const combinations = getCompatibleGarmentPoseCombinations(
    [
      {
        id: 'gar-backpack',
        name: 'Mochila Negra',
        storagePath: 'garments/drafts/user-1/draft-1/gar-backpack/front.jpg',
        isMultiAngle: false,
        garmentBodyArea: 'carry_accessory',
        garmentAccessoryType: 'backpack',
        photos: [
          {
            id: 'gar-backpack-front',
            fileName: 'front.jpg',
            storagePath: 'garments/drafts/user-1/draft-1/gar-backpack/front.jpg',
            sourceIndex: 0,
            view: 'front',
            classifiedBy: 'gemini',
          },
        ],
      },
    ],
    [
      {
        id: 'pose-back-upper',
        fileName: 'pose-back-upper.jpg',
        storagePath: 'models/client-1/model-1/poses/back-upper.jpg',
        aiClassification: {
          orientationGroup: 'back',
          orientationDetail: 'back',
          framing: 'medium_body',
          bodyFocus: 'upper_body',
          faceVisible: false,
          autoCategory: 'espalda_medio_cuerpo',
          usableForGarmentViews: ['back'],
          accessoryDisplaySlots: ['back', 'shoulder'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 3,
        },
      },
      {
        id: 'pose-front-face',
        fileName: 'pose-front-face.jpg',
        storagePath: 'models/client-1/model-1/poses/front-face.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'medium_body',
          bodyFocus: 'upper_body',
          faceVisible: true,
          autoCategory: 'frente_medio_cuerpo',
          usableForGarmentViews: ['front'],
          accessoryDisplaySlots: ['shoulder', 'front_torso'],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 3,
        },
      },
      {
        id: 'pose-shoes',
        fileName: 'pose-shoes.jpg',
        storagePath: 'models/client-1/model-1/poses/shoes.jpg',
        aiClassification: {
          orientationGroup: 'front',
          orientationDetail: 'front',
          framing: 'feet_closeup',
          bodyFocus: 'feet',
          faceVisible: false,
          autoCategory: 'frente_primer_plano_pies',
          usableForGarmentViews: ['front'],
          accessoryDisplaySlots: [],
          confidence: 0.95,
          taggedBy: 'gemini',
          taggedAt: new Date(),
          version: 3,
        },
      },
    ],
  );

  assert.deepEqual(
    combinations.map(({ garment, pose }) => `${garment.id}:${pose.id}`),
    ['gar-backpack:pose-back-upper'],
  );
});
