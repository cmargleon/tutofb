import type { Job } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import * as marketplacesNamespace from '../../../shared/src/marketplaces';

// Same interop as catalogView.ts: under `node --test` (tsx) shared/ loads as CommonJS.
const { MARKETPLACES } =
  ((marketplacesNamespace as { default?: unknown }).default as typeof import('../../../shared/src/marketplaces'))
  ?? (marketplacesNamespace as typeof import('../../../shared/src/marketplaces'));

export interface CatalogMarketplaceSlot {
  job: Job;
  /** 1-based photo position inside the marketplace listing. */
  position: number;
  role: 'main' | 'alternative';
  /** Validation of the current photo against this marketplace only; null while not validated. */
  passed: boolean | null;
  notes: string;
}

export interface CatalogMarketplaceSection {
  /** null groups jobs that were not planned for any marketplace. */
  channel: MarketplaceId | null;
  label: string;
  slots: CatalogMarketplaceSlot[];
}

const currentOutput = (job: Job) => job.userSelectedOutput || job.retainedApprovedOutput || job.currentOutput || null;

/**
 * Splits a garment's jobs into one section per marketplace, ordered by the photo position each
 * marketplace expects. Returns null when no job carries marketplace destinations (legacy batches),
 * so callers can keep the flat grid.
 */
export const groupJobsByMarketplace = (jobs: Job[]): CatalogMarketplaceSection[] | null => {
  if (!jobs.some(job => job.photoTask?.destinations?.length)) return null;

  const byChannel = new Map<MarketplaceId | null, CatalogMarketplaceSlot[]>();
  const push = (channel: MarketplaceId | null, slot: CatalogMarketplaceSlot) => {
    const slots = byChannel.get(channel) ?? [];
    slots.push(slot);
    byChannel.set(channel, slots);
  };

  jobs.forEach((job, index) => {
    const destinations = job.photoTask?.destinations ?? [];
    if (!destinations.length) {
      push(null, { job, position: index + 1, role: 'alternative', passed: null, notes: '' });
      return;
    }
    const validations = currentOutput(job)?.photoValidation?.destinations ?? [];
    const seen = new Set<string>();
    destinations.forEach(destination => {
      const key = `${destination.channel}:${destination.position}`;
      if (seen.has(key)) return;
      seen.add(key);
      const validation = validations.find(item => item.channel === destination.channel && item.position === destination.position);
      push(destination.channel, {
        job,
        position: destination.position,
        role: destination.role,
        passed: validation ? validation.passed : null,
        notes: validation?.notes ?? '',
      });
    });
  });

  const order = MARKETPLACES.map(item => item.id as MarketplaceId);
  const rank = (channel: MarketplaceId | null) => (channel === null ? Number.MAX_SAFE_INTEGER : order.indexOf(channel));
  return Array.from(byChannel.entries())
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([channel, slots]) => ({
      channel,
      label: channel === null ? 'Sin marketplace asignado' : MARKETPLACES.find(item => item.id === channel)?.name ?? channel,
      slots: [...slots].sort((left, right) => left.position - right.position),
    }));
};
