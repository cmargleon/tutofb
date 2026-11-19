import test from 'node:test';
import assert from 'node:assert/strict';
import type { Job } from '../shared/src/types';
import { groupJobsByMarketplace } from '../src/features/catalog/catalogMarketplaces';

type Destination = { channel: string; position: number; role?: 'main' | 'alternative' };
const job = (id: string, destinations?: Destination[], validations?: Array<{ channel: string; position: number; passed: boolean; notes: string }>): Job => ({
  id,
  garmentId: 'g1',
  status: 'completed',
  photoTask: destinations ? { destinations: destinations.map(d => ({ role: 'alternative', ...d })) } : undefined,
  currentOutput: validations ? { photoValidation: { fidelity: true, destinations: validations } } : null,
} as unknown as Job);

test('legacy jobs without marketplace destinations keep the flat grid', () => {
  assert.equal(groupJobsByMarketplace([job('a'), job('b')]), null);
});

test('jobs split into one section per marketplace, ordered by registry and photo position', () => {
  const sections = groupJobsByMarketplace([
    job('tk2', [{ channel: 'tiktok-shop', position: 2 }]),
    job('sh2', [{ channel: 'shein', position: 2 }]),
    job('sh1', [{ channel: 'shein', position: 1, role: 'main' }]),
    job('tk1', [{ channel: 'tiktok-shop', position: 1, role: 'main' }]),
    job('legacy'),
  ])!;
  assert.deepEqual(sections.map(s => s.label), ['SHEIN', 'TikTok Shop', 'Sin marketplace asignado']);
  assert.deepEqual(sections[0].slots.map(s => [s.job.id, s.position, s.role]), [['sh1', 1, 'main'], ['sh2', 2, 'alternative']]);
  assert.deepEqual(sections[1].slots.map(s => s.job.id), ['tk1', 'tk2']);
});

test('a shared photo shows in every marketplace with that marketplace validation only', () => {
  const sections = groupJobsByMarketplace([
    job('shared', [{ channel: 'shein', position: 1 }, { channel: 'tiktok-shop', position: 3 }], [
      { channel: 'shein', position: 1, passed: true, notes: '' },
      { channel: 'tiktok-shop', position: 3, passed: false, notes: 'No es cuadrada' },
    ]),
  ])!;
  assert.deepEqual(sections.map(s => [s.channel, s.slots[0].position, s.slots[0].passed, s.slots[0].notes]), [
    ['shein', 1, true, ''],
    ['tiktok-shop', 3, false, 'No es cuadrada'],
  ]);
});
