import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../functions/node_modules/firebase-admin').initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
const { MANGLAR_MCP_TOOLS } = require('../functions/lib/functions/src/automation/mcp.js');
const { MANGLAR_OPERATIONS, findOperation } = require('../functions/lib/functions/src/manglar/operations.js');
const { operationSchema } = require('../functions/lib/functions/src/manglar/registry.js');
const { validateSchema } = require('../functions/lib/functions/src/manglar/schema.js');

const resolve = (root: any, node: any): any => node.$ref ? resolve(root, root.$defs[node.$ref.split('/').at(-1)]) : node;

test('MCP union branches independently expose the complete callable envelope to clients', () => {
  for (const tool of MANGLAR_MCP_TOOLS.filter((tool: any) => tool.inputSchema.oneOf)) {
    const root = tool.inputSchema;
    for (const entry of root.oneOf) {
      const branch = resolve(root, entry);
      const action = resolve(root, branch.properties.action).const;
      const operation = findOperation(tool.name.slice('manglar_'.length), action);
      assert.equal(branch.type, 'object');
      assert.equal(branch.additionalProperties, false);
      assert.deepEqual(Object.keys(branch.properties).sort(), ['action', 'authorization', 'data', 'idempotencyKey']);
      assert.ok(branch.required.includes('action') && branch.required.includes('data'));
      if (operation.risk === 'write') assert.ok(branch.required.includes('idempotencyKey'));
      if (['paid', 'critical', 'destructive'].includes(operation.risk)) assert.ok(branch.required.includes('authorization'));
      const authorization = resolve(root, branch.properties.authorization);
      assert.ok(authorization.properties.operationId && authorization.properties.confirmationToken && authorization.properties.confirmedBudgetUsd);
    }
  }
});

test('new app workflows have explicit contracts and risk controls in MCP', () => {
  const expected: Record<string, string> = {
    'clients.marketplace': 'critical', 'models.setActive': 'write', 'models.verifyPhotoBases': 'paid',
    'system.modelMarketplaceRules': 'read', 'system.saveModelMarketplaceRule': 'critical',
    'wizard.previewMarketplacePlan': 'read', 'wizard.createMarketplaceBatch': 'paid',
    'models.scheduleSets': 'paid', 'models.baseStatus': 'read', 'models.previewSets': 'read', 'models.approveIdentity': 'write', 'models.verifyBase': 'paid', 'models.generateBase': 'paid',
    'catalog.editPhoto': 'paid', 'catalog.recordRejection': 'write', 'catalog.acknowledgeFailures': 'write',
    'catalog.saveMasterProduct': 'write', 'catalog.publishMarketplaceImages': 'critical',
    'spreadsheets.setStatus': 'write', 'spreadsheets.previewMarketplace': 'read', 'spreadsheets.analyzeMarketplace': 'paid',
    'spreadsheets.downloadMarketplace': 'paid', 'spreadsheets.configureMarketplaceTemplate': 'critical', 'spreadsheets.archiveMarketplaceTemplate': 'critical',
  };
  for (const [key, risk] of Object.entries(expected)) {
    const [domain, action] = key.split('.');
    assert.equal(findOperation(domain, action).risk, risk, key);
    assert.equal(operationSchema(findOperation(domain, action)).additionalProperties, false);
  }
  assert.equal(new Set(MANGLAR_OPERATIONS.map((op: any) => `${op.domain}.${op.action}`)).size, MANGLAR_OPERATIONS.length);
});

test('current contracts expose contacts, organizer settings, gender prompts and selected channels', () => {
  const schema = (domain: string, action: string) => operationSchema(findOperation(domain, action));
  const client = schema('clients', 'save');
  assert.ok(client.properties.contacts && client.properties.expected.properties.contacts);
  assert.ok(!client.required.includes('name'), 'contact-only edits must remain possible');
  const system = schema('system', 'update');
  for (const key of ['automationRules', 'organizerWatcherEnabled', 'organizerAutoGenerationEnabled', 'systemPromptMale', 'systemPromptFemale']) assert.ok(system.properties[key], key);
  const automation = schema('clients', 'automation');
  assert.ok(automation.properties.automation.properties.organizerGeneration);
  assert.ok(schema('automation', 'prepare').properties.selectedChannels);
  const legacy = MANGLAR_MCP_TOOLS.find((tool: any) => tool.name === 'manglar_prepare_plan');
  assert.ok(legacy.inputSchema.properties.request.properties.selectedChannels);
  const read = MANGLAR_MCP_TOOLS.find((tool: any) => tool.name === 'manglar_organizer_read');
  const manage = MANGLAR_MCP_TOOLS.find((tool: any) => tool.name === 'manglar_organizer_manage');
  assert.ok(read.inputSchema.properties.action.enum.includes('workflow'));
  assert.ok(read.inputSchema.properties.action.enum.includes('catalogAlerts'));
  assert.match(read.description, /Sin ficha comercial/);
  assert.match(manage.description, /Sin ficha comercial/);
  assert.ok(read.inputSchema.properties.action.enum.includes('thumbnail'));
  assert.ok(!read.inputSchema.properties.action.enum.includes('draft'));
  assert.ok(manage.inputSchema.properties.action.enum.includes('draft'));
  assert.ok(manage.inputSchema.properties.mode.enum.includes('generate'));
});

test('cached export previews cannot request paid Gemini analysis', () => {
  const schema = operationSchema(findOperation('spreadsheets', 'previewMarketplace'));
  const scope = { clientId: 'client', batchIds: ['batch'] };
  validateSchema(scope, schema);
  for (const flag of ['analyzeAutofill', 'retryFailedAutofill'])
    assert.throws(() => validateSchema({ ...scope, [flag]: true }, schema), { code: 'invalid-argument' });
});

test('queued sets are admin-only, budgeted, and bind exact request identity', () => {
  for (const action of ['scheduleSets', 'baseStatus']) assert.deepEqual(findOperation('models', action).roles, ['admin']);
  const schema = operationSchema(findOperation('models', 'scheduleSets'));
  for (const key of ['modelId', 'requestId', 'approvedPreviewId', 'combinations']) assert.ok(schema.required.includes(key));
  const { actionHash } = require('../functions/lib/functions/src/manglar/execution.js');
  const data = { modelId: 'model', requestId: 'stable', approvedPreviewId: 'preview', combinations: [{ channel: 'shein', shot: 'front' }] };
  assert.equal(actionHash('models', 'scheduleSets', data), actionHash('models', 'scheduleSets', { ...data }));
  assert.notEqual(actionHash('models', 'scheduleSets', data), actionHash('models', 'scheduleSets', { ...data, requestId: 'different' }));
  assert.match(findOperation('models', 'generateBase').description, /toma suelta/);
  assert.match(findOperation('clients', 'automation').description, /preset.modelId/);
});

test('paid export analysis exposes retryFailedAutofill while cached previews reject it', () => {
  const schema = operationSchema(findOperation('spreadsheets', 'analyzeMarketplace'));
  validateSchema({ clientId: 'client', batchIds: ['batch'], retryFailedAutofill: true }, schema);
  assert.match(findOperation('spreadsheets', 'downloadMarketplace').description, /authorizePublicImages:true/);
});
