import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const config = require('../functions/lib/functions/src/admin/systemConfig.js');
const organizer = require('../functions/lib/functions/src/organizer/productWorkflow.js');
const { createProductGenerationBatchCore } = require('../functions/lib/functions/src/callables/createProductGenerationBatch.js');
const { createDefaultProductScenes } = require('../functions/lib/shared/src/productGeneration.js');

test('batch creation freezes pack quantity from Excel commerce, linked wizard and explicit manual data without changing saved scenes', async (t) => {
  const originalDb = firestore.getAppFirestore;
  const originalConfig = config.getSystemConfigCached;
  const originalOrigin = organizer.resolveOrganizerBatchOrigin;
  t.after(() => {
    firestore.getAppFirestore = originalDb;
    config.getSystemConfigCached = originalConfig;
    organizer.resolveOrganizerBatchOrigin = originalOrigin;
  });
  for (const mode of ['excel', 'linked-wizard', 'manual', 'ambiguous', 'custom', 'unit']) {
    const docs = new Map<string, any>([
      ['clients/client', { name: 'JISHOP', active: true }],
      ['users/user', { displayName: 'Operator' }],
      ['automationJobs/intake', { leaseToken: 'lease', status: 'importing' }],
      ['automationJobs/intake/organizerCommerce/item', { source: { variants: [
        { values: { pack: '4' } }, ...(mode === 'ambiguous' ? [{ values: { pack: '6' } }] : []),
      ] } }],
      ['organizers/client/products/variant', { pack: '4' }],
    ]);
    let nextId = 0;
    const snapshot = (path: string) => ({ exists: docs.has(path), data: () => docs.get(path), get: (key: string) => docs.get(path)?.[key] });
    const doc = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path),
      collection: (name: string) => collection(`${path}/${name}`) });
    const collection = (path: string): any => ({ doc: (id = `new-${++nextId}`) => doc(`${path}/${id}`) });
    const tx = { get: async (ref: any) => snapshot(ref.path), create: (ref: any, value: any) => docs.set(ref.path, value), update: () => {} };
    firestore.getAppFirestore = () => ({ collection, doc, runTransaction: (fn: any) => fn(tx) });
    config.getSystemConfigCached = async () => ({ batchMaxJobs: 30, jobMaxRetries: 2, disabledProviders: [] });
    organizer.resolveOrganizerBatchOrigin = async () => mode === 'linked-wizard' ? { itemId: 'item', variantId: 'variant', baseProductId: 'base' } : undefined;
    const scenes = createDefaultProductScenes().filter((s: any) => ['clean', 'hero', 'human_use_1'].includes(s.type));
    if (mode === 'custom') scenes[0].prompt = 'Client scene with one product';
    const frozen = structuredClone(scenes);
    const automated = ['excel', 'ambiguous'].includes(mode);
    const result = await createProductGenerationBatchCore({ clientId: 'client', requestId: mode,
      provider: 'fal-gpt-image-2.5-flare', prompt: 'Commercial photo', scenes,
      items: [{ id: 'item', name: 'JST-O02-PACK4', packCount: mode === 'unit' ? 1 : 4,
        referencePaths: ['garments/drafts/user/draft/front.jpg'] }],
    }, 'user', automated ? { id: 'intake', leaseToken: 'lease' } : undefined);
    const jobs = [...docs.entries()].filter(([path]) => path.startsWith('jobs/')).map(([, value]) => value);
    assert.equal(jobs.length, 3);
    assert.deepEqual(docs.get(`batches/${result.batchId}`).productScenes, frozen);
    for (const job of jobs) {
      const untouched = ['ambiguous', 'unit'].includes(mode) || mode === 'custom' && job.productScene === 'clean';
      if (untouched) {
        assert.equal(job.productQuantity, undefined);
        assert.equal(job.requestedPromptBase, `Commercial photo\n${scenes.find((s: any) => s.type === job.productScene).prompt}`);
      } else {
        assert.equal(job.productQuantity.packCount, 4);
        assert.equal(job.productQuantity.scope, job.productScene === 'human_use_1' ? 'use' : 'display');
        assert.match(job.finalPrompt, job.productScene === 'human_use_1' ? /one unit/ : /exactly 4 identical units/);
      }
    }
    // An idempotent call returns the existing batch; no stored job text is regenerated.
    if (automated) {
      const before = structuredClone(jobs.map(j => j.finalPrompt));
      await createProductGenerationBatchCore({ clientId: 'client', requestId: mode, provider: 'fal-gpt-image-2.5-flare', prompt: 'Changed', scenes,
        items: [{ id: 'item', name: 'Mug', referencePaths: ['garments/drafts/user/draft/front.jpg'] }],
      }, 'user', { id: 'intake', leaseToken: 'lease' });
      assert.deepEqual(jobs.map(j => j.finalPrompt), before);
    }
  }
});
