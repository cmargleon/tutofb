import { useMemo, useState } from 'react';
import { Batch, Provider } from '../../../shared/src/types';
import { useQueueData } from './firebase';
import {
  buildQueueRows,
  filterQueueRows,
  getQueueClientOptions,
  getQueueProviderOptions,
  groupQueueRowsByStage,
  KanbanStage,
  QueueRow,
  sumQueueTotals,
} from './queueRows';

export const useQueueBoard = () => {
  const { batches, jobsByBatch, loading, error } = useQueueData();
  const [clientFilter, setClientFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Batch['status']>('all');

  const rows = useMemo<QueueRow[]>(() => buildQueueRows(batches, jobsByBatch), [batches, jobsByBatch]);

  const rowsById = useMemo<Record<string, QueueRow>>(
    () => Object.fromEntries(rows.map((row) => [row.id, row])),
    [rows],
  );

  const clientOptions = useMemo(() => getQueueClientOptions(rows), [rows]);

  const providerOptions = useMemo(() => getQueueProviderOptions(rows), [rows]);

  const filteredRows = useMemo(
    () => filterQueueRows(rows, { clientFilter, providerFilter, statusFilter }),
    [clientFilter, providerFilter, rows, statusFilter],
  );

  const rowsByStage = useMemo<Record<KanbanStage, QueueRow[]>>(
    () => groupQueueRowsByStage(filteredRows),
    [filteredRows],
  );

  const totals = useMemo(() => sumQueueTotals(filteredRows), [filteredRows]);

  const clearFilters = () => {
    setClientFilter('all');
    setProviderFilter('all');
    setStatusFilter('all');
  };

  return {
    loading,
    error,
    rowsById,
    clientOptions,
    providerOptions,
    filteredRows,
    rowsByStage,
    totals,
    clientFilter,
    setClientFilter,
    providerFilter,
    setProviderFilter,
    statusFilter,
    setStatusFilter,
    clearFilters,
  };
};
