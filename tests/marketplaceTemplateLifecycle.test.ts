import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../functions/node_modules/firebase-admin').initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
const { templateUsable } = require('../functions/lib/functions/src/spreadsheets/marketplaceExportService.js');

test('only released current templates are defaults; superseded templates require a historical link', () => {
  const current = { status: 'active', exportConfig: { marketplaceId: 'shein', validationStatus: 'compatible' } };
  assert.equal(templateUsable(current, 'shein'), true);
  assert.equal(templateUsable(current, 'amazon', true), false);
  const replaced = { status: 'archived', exportConfig: { ...current.exportConfig, supersededByTemplateId: 'next' } };
  assert.equal(templateUsable(replaced, 'shein'), false);
  assert.equal(templateUsable(replaced, 'shein', true), true);
  for (const validationStatus of ['needs_configuration', 'incompatible']) {
    assert.equal(templateUsable({ ...current, exportConfig: { ...current.exportConfig, validationStatus } }, 'shein', true), false);
  }
  for (const supersededByTemplateId of [undefined, null, '']) {
    assert.equal(templateUsable({ ...replaced, exportConfig: { ...replaced.exportConfig, supersededByTemplateId } }, 'shein', true), false);
  }
  assert.equal(templateUsable({ status: 'active' }, 'shein', true), false);
});
