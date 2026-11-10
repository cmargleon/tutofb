import { useEffect, useMemo, useState } from 'react';
import { QueueRow } from './queueRows';

export const useQueueSelection = (rowsById: Record<string, QueueRow>, filteredRows: QueueRow[]) => {
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedBatchIds((current) => current.filter((batchId) => rowsById[batchId]));
  }, [rowsById]);

  const selectedRows = useMemo(
    () => selectedBatchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row)),
    [rowsById, selectedBatchIds],
  );

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedBatchIds.includes(row.id));

  const handleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredRows.map((row) => row.id));
      setSelectedBatchIds((current) => current.filter((batchId) => !filteredIds.has(batchId)));
      return;
    }

    setSelectedBatchIds((current) => Array.from(new Set([...current, ...filteredRows.map((row) => row.id)])));
  };

  const handleToggleBatch = (batchId: string) => {
    setSelectedBatchIds((current) =>
      current.includes(batchId) ? current.filter((value) => value !== batchId) : [...current, batchId],
    );
  };

  const clearSelection = () => setSelectedBatchIds([]);

  return {
    selectedBatchIds,
    selectedRows,
    allFilteredSelected,
    handleSelectAllFiltered,
    handleToggleBatch,
    clearSelection,
  };
};
