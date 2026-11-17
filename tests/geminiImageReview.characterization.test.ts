import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Characterization of reviewGeneratedImageWithGemini: for every prompt variant and Gemini response shape it
// records the exact request sent to Gemini (prompt text, image order, generationConfig, usage context) and the
// returned result or error. Compared against a golden captured from the pre-split code.
// Regenerate only on purpose: UPDATE_GEMINI_REVIEW_GOLDEN=1.
const require = createRequire(import.meta.url);
const goldenPath = fileURLToPath(new URL('./support/geminiImageReview.golden.json', import.meta.url));
const review = require('../functions/lib/functions/src/review/geminiImageReview.js') as
  typeof import('../functions/src/review/geminiImageReview');
const usage = require('../functions/lib/functions/src/analytics/geminiUsage.js');
const { AutomationBudgetError } = require('../functions/lib/functions/src/automation/budget.js');

const image = (label: string, mimeType = 'image/jpeg') => ({ bytes: Buffer.from(`image:${label}`), mimeType });
const digest = (base64: string) => createHash('sha1').update(base64).digest('hex').slice(0, 10);

const criteria = (passed: boolean, keys = ['identity', 'background', 'pose', 'garment', 'logo']) =>
  keys.map(key => ({ key, label: `Criterio ${key}`, passed, notes: ` nota ${key} ` }));
const productKeys = ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts', 'scene'];
const marketplaceData = { title: ' Polera ', description: '', brand: null, gender: 'mujer', garmentType: 'polera',
  primaryColor: 'rojo', sport: 7, isSportswear: 'yes' };

const photoTask = {
  id: 'task-1', itemId: 'item', productId: 'p', variantId: 'v', referencePaths: ['garments/g/front.jpg'],
  view: 'front', composition: 'model', background: 'white', bodyArea: 'upper_body', base: null, syntheticPerformer: true,
  instructions: 'Instrucciones del plan',
  destinations: [
    { channel: 'amazon', productId: 'p', variantId: 'v', position: 1, role: 'main', required: true, ruleIds: [] },
    { channel: 'shein', productId: 'p', variantId: 'v', position: 2, role: 'alternative', required: true, ruleIds: [] },
  ],
};

const baseRequest = {
  apiKey: 'test-key', model: 'gemini-test', batchId: 'batch', jobId: 'job', clientId: 'client',
  clientNameSnapshot: 'Cliente', modelId: 'model', modelNameSnapshot: 'Modelo', garmentId: 'garment',
  garmentName: 'Polera', poseId: 'pose', userUid: 'uid', requestedPromptBase: '  Prompt pedido  ',
  promptBase: 'Prompt actual', finalPrompt: 'Prompt final enviado', attemptNumber: 2, maxAttempts: 3,
  poseReference: image('pose'), garmentReference: image('garment', 'image/png'), generatedImage: image('result', 'image/png'),
};

const requests: Record<string, Record<string, unknown>> = {
  'legacy garment': { ...baseRequest },
  'legacy garment, empty prompts, identity traits': { ...baseRequest, requestedPromptBase: ' ', promptBase: '', finalPrompt: '',
    modelIdentityTraitsSnapshot: { sex: 'mujer', age: ' 30 ', skin: '', hairColor: 'negro', hairLength: 'largo', build: '' } },
  'approved try-on garment': { ...baseRequest, promptFormat: 'approved-try-on-v1' },
  'approved format on product is ignored': { ...baseRequest, promptFormat: 'approved-try-on-v1', generationKind: 'product',
    productReferences: [image('p1'), image('p2', 'image/webp')] },
  'exact automation garment': { ...baseRequest, exactAutomationPrompt: true, generationKind: 'garment',
    automation: { id: 'auto', key: 'review:job:claim', kind: 'review', generation: { id: 'job', claimToken: 'claim' } },
    productReferences: [image('pose'), image('ref1'), image('ref2')] },
  'exact automation product': { ...baseRequest, exactAutomationPrompt: true, generationKind: 'product',
    automation: { id: 'auto', key: 'review:job:claim', kind: 'review', generation: { id: 'job', claimToken: 'claim' } },
    productReferences: [image('p1')] },
  'product': { ...baseRequest, generationKind: 'product', productReferences: [image('p1'), image('p2')] },
  'photo task garment': { ...baseRequest, photoTask },
  'photo task exact automation': { ...baseRequest, photoTask, exactAutomationPrompt: true,
    productReferences: [image('pose'), image('ref1')] },
};

type Responder = (request: any) => unknown;
const text = (payload: unknown) => ({ payload: { candidates: [{ content: { parts: [{ text: '' }, { text: ` ${JSON.stringify(payload)} ` }] } }] } });
const photoValidation = (destinations: Array<[string, number, boolean]>, fidelity: unknown = true) =>
  ({ fidelity, destinations: destinations.map(([channel, position, passed]) => ({ channel, position, passed, notes: ' ok ' })) });

const responses: Record<string, Responder> = {
  'approved, all criteria pass': () => text({ verdict: 'approved', summary: ' Bien ', revisedPrompt: 'ignored',
    criteria: criteria(true, [...productKeys, 'pose']), marketplaceData }),
  'approved, one criterion fails': () => text({ verdict: 'approved', summary: '', revisedPrompt: '',
    criteria: criteria(true, productKeys).map((c, i) => (i === 2 ? { ...c, passed: false } : c)), marketplaceData: null }),
  'approved, missing product criteria': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '',
    criteria: criteria(true, ['identity', 'colors']), marketplaceData }),
  'approved, no criteria': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '', criteria: [],
    marketplaceData }),
  'rejected with revised prompt': () => text({ verdict: 'rejected', summary: 'Mal', revisedPrompt: ' Corrige el logo ',
    criteria: [null, 'x', { key: '', passed: 'yes' }, ...criteria(false)], marketplaceData }),
  'malformed fields': () => text({ verdict: 'APPROVED', summary: 3, revisedPrompt: 9, criteria: 'nope', marketplaceData: 'x' }),
  'photo: rejected verdict but destination passes': () => text({ verdict: 'rejected', summary: 'Rechazo global',
    revisedPrompt: 'Otro prompt', criteria: criteria(false),
    photoValidation: photoValidation([['amazon', 1, false], ['shein', 2, true]]), marketplaceData }),
  'photo: approved but fidelity false': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '',
    criteria: criteria(true), photoValidation: photoValidation([['amazon', 1, true], ['shein', 2, true]], false),
    marketplaceData }),
  'photo: missing destination': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '', criteria: criteria(true),
    photoValidation: photoValidation([['amazon', 1, true]]), marketplaceData }),
  'photo: duplicated destination': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '', criteria: criteria(true),
    photoValidation: photoValidation([['amazon', 1, true], ['amazon', 1, true], ['shein', 2, true]]), marketplaceData }),
  'photo: fidelity not boolean': () => text({ verdict: 'approved', summary: 'ok', revisedPrompt: '', criteria: criteria(true),
    photoValidation: photoValidation([['amazon', 1, true], ['shein', 2, true]], 'yes'), marketplaceData }),
  'empty text with SAFETY finish reason': () => ({ payload: { candidates: [{ content: { parts: [{ text: '  ' }] },
    finishReason: 'SAFETY' }], promptFeedback: { blockReason: 'SAFETY' } } }),
  'empty text with MAX_TOKENS finish reason': () => ({ payload: { candidates: [{ finishReason: 'MAX_TOKENS' }] } }),
  'no candidates, prompt blocked': () => ({ payload: { promptFeedback: { blockReason: 'OTHER' } } }),
  'no candidates, no feedback': () => ({ payload: {} }),
  'non JSON text': () => ({ payload: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } }),
  'abort error': () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
  'generic error': () => { throw new Error('HTTP 500'); },
  'non Error throw': () => { throw 'boom'; },
  'automation budget error': () => { throw new AutomationBudgetError('Sin presupuesto'); },
};

const describeCall = (call: any) => ({
  apiKey: call.apiKey,
  model: call.model,
  signal: call.signal instanceof AbortSignal ? '<signal>' : call.signal,
  context: call.context,
  generationConfig: call.body.generationConfig,
  contents: call.body.contents.map((content: any) => ({
    role: content.role,
    parts: content.parts.map((part: any) => (part.text !== undefined ? { text: part.text }
      : { mime: part.inline_data.mime_type, data: digest(part.inline_data.data) })),
  })),
});

const describeError = (error: any) => ({
  thrown: error?.constructor?.name ?? typeof error,
  name: error?.name ?? null,
  message: error?.message ?? String(error),
  reasonCode: error?.reasonCode ?? null,
  retryable: error?.retryable ?? null,
  finishReason: error?.finishReason ?? null,
  promptFeedback: error?.promptFeedback ?? null,
  rawMessage: error?.raw?.message ?? null,
});

test('geminiImageReview characterization: request sent to Gemini and parsed result for every variant', async t => {
  const results: Record<string, unknown> = {};
  let current: Responder = () => ({});
  let calls: any[] = [];
  t.mock.method(usage, 'callGeminiGenerateContent', async (call: any) => { calls.push(call); return current(call); });

  const prompts: Record<string, unknown> = {};
  for (const [requestName, request] of Object.entries(requests)) {
    for (const [responseName, responder] of Object.entries(responses)) {
      const isPhoto = Boolean(request.photoTask);
      if (responseName.startsWith('photo:') !== isPhoto && !['non JSON text', 'generic error'].includes(responseName)) {
        continue;
      }
      calls = [];
      current = responder;
      let outcome: unknown;
      try {
        outcome = { result: await review.reviewGeneratedImageWithGemini({ ...request, signal: new AbortController().signal } as any) };
      } catch (error) {
        outcome = { error: describeError(error) };
      }
      assert.equal(calls.length, 1);
      const call = describeCall(calls[0]);
      prompts[requestName] = call; // identical for every response of the same request
      const { reviewPrompt, ...rest } = (outcome as any).result ?? {};
      results[`${requestName} | ${responseName}`] = (outcome as any).result
        ? { result: { ...rest, reviewPromptIsSentPrompt: reviewPrompt === calls[0].body.contents[0].parts[0].text } }
        : outcome;
    }
  }
  results['approved try-on review prompt helper'] = review.buildApprovedTryOnReviewPrompt('Prompt aprobado');

  const ordered = { requests: prompts, outcomes: Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]])) };
  const serialized = JSON.parse(JSON.stringify(ordered));
  if (process.env.UPDATE_GEMINI_REVIEW_GOLDEN === '1' || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, `${JSON.stringify(serialized, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  for (const name of Object.keys(golden.requests)) {
    assert.deepEqual(serialized.requests[name], golden.requests[name], `request changed: ${name}`);
  }
  for (const name of Object.keys(golden.outcomes)) {
    assert.deepEqual(serialized.outcomes[name], golden.outcomes[name], `outcome changed: ${name}`);
  }
  assert.deepEqual(Object.keys(serialized.outcomes), Object.keys(golden.outcomes));
});
