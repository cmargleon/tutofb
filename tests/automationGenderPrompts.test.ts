import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AutomationJob, Client, CreateGenerationBatchRequest, Model } from '../shared/src/types';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-gender-prompts', storageBucket: 'demo-gender-prompts.appspot.com' });
const { dispatchGarment } = require('../functions/lib/functions/src/automation/pipelines.js') as typeof import('../functions/src/automation/pipelines');
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const system = require('../functions/lib/functions/src/admin/systemConfig.js');
const batches = require('../functions/lib/functions/src/callables/createGenerationBatch.js');

test('automation composes each garment prompt using the actual selected model and preserves prompt overrides', async (t) => {
  for (const scenario of ['mixed', 'explicit-model', 'unknown-sex', 'empty'] as const) await t.test(scenario, async (sub) => {
    const models = ['male', 'female'].map(sex => ({ id: sex, clientId: 'client', name: sex,
      identityTraits: { sex: scenario === 'unknown-sex' ? null : sex },
      poses: [{ id: 'front', fileName: 'front.jpg', storagePath: 'models/front.jpg', aiClassification: {
        usableForGarmentViews: ['front'], orientationGroup: 'front', framing: 'full_body', bodyFocus: 'full_body',
      } }],
    } as Model));
    const options = (scenario === 'mixed' ? models : [models[0]]).map(model => ({ modelId: model.id!,
      gender: scenario === 'mixed' ? model.id as 'male' | 'female' : null, poseIds: ['front'],
    }));
    const inputImages = options.map((option, i) => ({ itemId: `item-${i}`, fileName: `${i}.jpg`, storagePath: `garments/${i}.jpg` }));
    const job = { id: 'automation', clientId: 'client', createdByUid: 'operator', leaseToken: 'lease',
      inputImages, classificationCache: {}, analysisCache: {},
    } as AutomationJob;
    inputImages.forEach((image, i) => {
      const key = createHash('sha256').update(JSON.stringify([image.itemId, [[image.storagePath, null]]])).digest('hex');
      job.classificationCache![key] = { id: image.itemId, name: image.fileName, storagePath: image.storagePath,
        isMultiAngle: false, sourceType: 'single', garmentBodyArea: 'upper_body', photos: [{ id: 'photo',
          fileName: image.fileName, storagePath: image.storagePath, sourceIndex: 0, view: 'front', classifiedBy: 'gemini',
        }],
      };
      job.analysisCache![key] = { garmentGender: i === 0 && scenario === 'mixed' ? 'male' : 'female', garmentGenderConfidence: 0.99 } as any;
    });
    const ref = { update: async () => {} };
    sub.mock.method(firestore, 'getAppFirestore', () => ({
      collection: () => ({ doc: () => ref }),
      getAll: async () => options.map(option => ({ data: () => models.find(model => model.id === option.modelId) })),
      runTransaction: async (callback: any) => callback({
        get: async () => ({ data: () => ({ leaseToken: 'lease', status: 'importing' }) }), update() {},
      }),
    }));
    const config = system.sanitizeSystemConfig({ systemPromptOverride: 'Global base instructions',
      systemPromptMale: scenario === 'empty' ? null : 'Male instructions',
      systemPromptFemale: scenario === 'empty' ? null : 'Female instructions',
    });
    sub.mock.method(system, 'getSystemConfigCached', async () => config);
    let requests: CreateGenerationBatchRequest[] = [];
    sub.mock.method(batches, 'createGenerationBatchesCore', async (data: CreateGenerationBatchRequest[]) => { requests = data; });
    const preset = { prompt: scenario === 'explicit-model' ? 'Preset base instructions' : '' };
    await dispatchGarment(job, { id: 'client' } as Client, preset, options);
    assert.equal(requests.length, options.length);
    for (const request of requests) {
      assert.equal(request.promptFormat, 'approved-try-on-v1');
      const prompt = request.approvedPrompts![0].text;
      assert.ok(prompt.includes(scenario === 'explicit-model' ? 'Preset base instructions' : 'Global base instructions'));
      if (scenario === 'unknown-sex' || scenario === 'empty') {
        assert.doesNotMatch(prompt, /Male instructions|Female instructions/);
      } else {
        const expected = request.modelId === 'male' ? 'Male instructions' : 'Female instructions';
        assert.equal(prompt.split(expected).length - 1, 1);
        assert.ok(!prompt.includes(request.modelId === 'male' ? 'Female instructions' : 'Male instructions'));
      }
    }
  });
});
