import { useEffect, useMemo, useState } from 'react';
import { Provider } from '../../../shared/src/types';
import { useQueueData } from './firebase';
import {
  buildQueueRows,
  filterQueueRows,
  getQueueClientOptions,
  getQueueProviderOptions,
  groupQueueRowsBySection,
  QueueRow,
  summarizeQueue,
} from './queueRows';

/** Re-evaluate the time windows each minute so finished batches drop out of "Recientes" without a reload. */
const useMinuteClock = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
};

export const useQueueBoard = () => {
  const { batches, jobsByBatch, loading, error } = useQueueData();
  const now = useMinuteClock();
  const [clientFilter, setClientFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');

  const rows = useMemo<QueueRow[]>(() => buildQueueRows(batches, jobsByBatch), [batches, jobsByBatch]);
  const rowsById = useMemo<Record<string, QueueRow>>(() => Object.fromEntries(rows.map((row) => [row.id, row])), [rows]);
  const clientOptions = useMemo(() => getQueueClientOptions(rows), [rows]);
  const providerOptions = useMemo(() => getQueueProviderOptions(rows), [rows]);
  const filteredRows = useMemo(
    () => filterQueueRows(rows, { clientFilter, providerFilter }),
    [clientFilter, providerFilter, rows],
  );
  const sections = useMemo(() => groupQueueRowsBySection(filteredRows, now), [filteredRows, now]);
  const summary = useMemo(() => summarizeQueue(sections), [sections]);

  return {
    loading,
    error,
    rowsById,
    sections,
    summary,
    clientOptions,
    providerOptions,
    clientFilter,
    setClientFilter,
    providerFilter,
    setProviderFilter,
    hasFilters: clientFilter !== 'all' || providerFilter !== 'all',
    clearFilters: () => {
      setClientFilter('all');
      setProviderFilter('all');
    },
  };
};
