import { useEffect, useState } from 'react';
import type { Batch, Job, JobStatus, MarketplaceExportPreview } from '../../../shared/src/types';
import { previewMarketplaceExports } from '../marketplaces/exportFirebase';
import { summarizeBatchAttention } from './attention';
import type { BatchAttention } from './attention';
import {
  ACTION_BATCH_LIMIT, countGenerationJobs, GENERATION_STATUSES, readActionBatchJobs, readRecentBatches, readRecentJobs,
} from './firebase';

export type DashboardResult<T> =
  | { status: 'loading' | 'error' | 'unavailable' }
  | { status: 'ready'; data: T };

type BatchCheck<T> = { batch: Batch; result: DashboardResult<T> };
type CountResults = Record<JobStatus, DashboardResult<number>>;

const loading = { status: 'loading' } as const;
const unavailable = { status: 'unavailable' } as const;
const loadingCounts: CountResults = { pending: loading, processing: loading, completed: loading, failed: loading };

async function read<T>(request: Promise<T>): Promise<DashboardResult<T>> {
  try {
    return { status: 'ready', data: await request };
  } catch (error) {
    console.error('Error al consultar Inicio', error);
    return { status: 'error' };
  }
}

export const useDashboard = (clientScope: string) => {
  const [revision, setRevision] = useState(0);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [counts, setCounts] = useState<CountResults>(loadingCounts);
  const [recentBatches, setRecentBatches] = useState<DashboardResult<Batch[]>>(loading);
  const [recentJobs, setRecentJobs] = useState<DashboardResult<Job[]>>(loading);
  const [attention, setAttention] = useState<DashboardResult<BatchCheck<BatchAttention>[]>>(loading);
  const [exports, setExports] = useState<DashboardResult<BatchCheck<MarketplaceExportPreview>[]>>(loading);

  useEffect(() => {
    const clientIds = JSON.parse(clientScope) as string[] | null;
    // With no assigned clients there is no operational scope to query.
    if (clientIds?.length === 0) return;
    let active = true;
    setAsOf(Date.now());
    setCounts(loadingCounts);
    setRecentBatches(loading);
    setRecentJobs(loading);
    setAttention(loading);
    setExports(loading);

    for (const status of GENERATION_STATUSES) {
      void read(countGenerationJobs(clientIds, status)).then(result => {
        if (active) setCounts(previous => ({ ...previous, [status]: result }));
      });
    }
    void read(readRecentJobs(clientIds)).then(result => { if (active) setRecentJobs(result); });

    const loadAttention = async () => {
      const batches = await read(readRecentBatches(clientIds));
      if (!active) return;
      setRecentBatches(batches);
      if (batches.status !== 'ready') {
        setAttention(batches);
        setExports(batches);
        return;
      }

      const checked = await Promise.all(batches.data.slice(0, ACTION_BATCH_LIMIT).map(async batch => {
        const jobs = await read(readActionBatchJobs(batch));
        const result = jobs.status !== 'ready' ? jobs
          : jobs.data === null ? unavailable
            : { status: 'ready' as const, data: summarizeBatchAttention(batch, jobs.data, Date.now()) };
        return { batch, result };
      }));
      if (!active) return;
      setAttention({ status: 'ready', data: checked });

      // The existing preflight validates products, channel requirements and the workbook.
      const exportChecks = await Promise.all(checked.map(async ({ batch, result }) => {
        if (result.status !== 'ready') return { batch, result };
        if (result.data.generating) return null;
        return {
          batch,
          result: await read(previewMarketplaceExports({ clientId: batch.clientId, batchIds: [batch.id!] })),
        };
      }));
      if (!active) return;
      setExports({ status: 'ready', data: exportChecks.filter(check => check !== null) });
    };

    void loadAttention();
    return () => { active = false; };
  }, [clientScope, revision]);

  return {
    counts, recentBatches, recentJobs, attention, exports, asOf,
    refresh: () => setRevision(value => value + 1),
  };
};
