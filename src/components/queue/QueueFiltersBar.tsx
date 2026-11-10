import React from 'react';
import { Filter } from 'lucide-react';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { Batch, Provider } from '../../../shared/src/types';

export const QueueFiltersBar: React.FC<{
  clientFilter: string;
  providerFilter: 'all' | Provider;
  statusFilter: 'all' | Batch['status'];
  clientOptions: string[];
  providerOptions: Provider[];
  onClientFilterChange: (value: string) => void;
  onProviderFilterChange: (value: 'all' | Provider) => void;
  onStatusFilterChange: (value: 'all' | Batch['status']) => void;
  onClearFilters: () => void;
}> = ({
  clientFilter,
  providerFilter,
  statusFilter,
  clientOptions,
  providerOptions,
  onClientFilterChange,
  onProviderFilterChange,
  onStatusFilterChange,
  onClearFilters,
}) => (
  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Filtros</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">Cola operativa en tiempo real</h2>
    </div>

    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
        <Filter className="h-4 w-4" />
        Cliente
        <select
          value={clientFilter}
          onChange={(event) => onClientFilterChange(event.target.value)}
          className="bg-transparent text-slate-900 outline-none"
        >
          <option value="all">Todos</option>
          {clientOptions.map((client) => (
            <option key={client} value={client}>
              {client}
            </option>
          ))}
        </select>
      </label>

      <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
        <span className="mr-2">Proveedor</span>
        <select
          value={providerFilter}
          onChange={(event) => onProviderFilterChange(event.target.value as 'all' | Provider)}
          className="bg-transparent text-slate-900 outline-none"
        >
          <option value="all">Todos</option>
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
      </label>

      <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
        <span className="mr-2">Estado</span>
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as 'all' | Batch['status'])}
          className="bg-transparent text-slate-900 outline-none"
        >
          <option value="all">Todos</option>
          <option value="pending">Pendiente</option>
          <option value="processing">Procesando</option>
          <option value="partial_failed">Parcial fallido</option>
          <option value="failed">Fallido</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onClearFilters}
        className="rounded-2xl border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
      >
        Limpiar filtros
      </button>
    </div>
  </div>
);
