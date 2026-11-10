import React from 'react';
import { Batch, Client } from '../../../shared/src/types';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { CatalogSortOrder } from '../../features/catalog/useCatalogJobs';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const SORT_ORDER_OPTIONS: Array<{ value: CatalogSortOrder; label: string }> = [
  { value: 'desc', label: 'Más nuevos primero' },
  { value: 'asc', label: 'Más antiguos primero' },
];

export const CatalogFilters: React.FC<{
  client?: Client;
  clients: Client[];
  selectedClientId: string;
  selectedBatchId: string;
  batchOptions: Array<Batch & { id: string }>;
  pageSize: number;
  sortOrder: CatalogSortOrder;
  onClientChange: (value: string) => void;
  onBatchChange: (value: string) => void;
  onPageSizeChange: (value: number) => void;
  onSortOrderChange: (value: CatalogSortOrder) => void;
}> = ({
  client,
  clients,
  selectedClientId,
  selectedBatchId,
  batchOptions,
  pageSize,
  sortOrder,
  onClientChange,
  onBatchChange,
  onPageSizeChange,
  onSortOrderChange,
}) => (
  <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,22rem)_10rem_14rem]">
    <label className="block">
      <span className="tuto-label mb-1.5 block">Cliente</span>
      <select
        id="catalog-client"
        disabled={Boolean(client)}
        value={selectedClientId}
        onChange={(e) => onClientChange(e.target.value)}
        className="tuto-field"
      >
        <option value="">Selecciona un cliente...</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>

    <label className="block">
      <span className="tuto-label mb-1.5 block">Lote</span>
      <select
        value={selectedBatchId}
        onChange={(e) => onBatchChange(e.target.value)}
        disabled={!selectedClientId || batchOptions.length === 0}
        className="tuto-field"
      >
        {client && <option value="">Todos los lotes del cliente</option>}
        {batchOptions.length === 0 ? (
          <option value="">Sin lotes disponibles</option>
        ) : (
          batchOptions.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {formatDateTimeLong(batch.createdAt)} · {batch.id}
            </option>
          ))
        )}
      </select>
    </label>

    <label className="block">
      <span className="tuto-label mb-1.5 block">Jobs por página</span>
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        disabled={!selectedClientId}
        className="tuto-field"
      >
        {PAGE_SIZE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>

    <label className="block">
      <span className="tuto-label mb-1.5 block">Orden por fecha</span>
      <select
        value={sortOrder}
        onChange={(e) => onSortOrderChange(e.target.value as CatalogSortOrder)}
        disabled={!selectedClientId}
        className="tuto-field"
      >
        {SORT_ORDER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  </div>
);
