import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const CatalogPaginationControls: React.FC<{
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => Promise<void> | void;
}> = ({ hasPreviousPage, hasNextPage, onPreviousPage, onNextPage }) => (
  <div className="flex items-center gap-2 self-start sm:self-auto">
    <button
      type="button"
      onClick={onPreviousPage}
      disabled={!hasPreviousPage}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ChevronLeft className="h-4 w-4" />
      Anterior
    </button>
    <button
      type="button"
      onClick={() => void onNextPage()}
      disabled={!hasNextPage}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Siguiente
      <ChevronRight className="h-4 w-4" />
    </button>
  </div>
);

export const CatalogPageSummary: React.FC<{
  className: string;
  selectedBatchLabel: string;
  pageLabel: string;
  isClientScoped: boolean;
  garmentGroupsCount: number;
  visibleJobsCount: number;
  paginationControls: React.ReactNode;
}> = ({ className, selectedBatchLabel, pageLabel, isClientScoped, garmentGroupsCount, visibleJobsCount, paginationControls }) => (
  <div className={className}>
    <div className="text-sm text-gray-500">
      <span>{selectedBatchLabel}</span>
      <span className="mx-2">·</span>
      <span>{pageLabel}</span>
      <span className="mx-2">·</span>
      <span>{isClientScoped ? `${garmentGroupsCount} artículos en esta página · ${visibleJobsCount} trabajos de imagen visibles` : `${visibleJobsCount} jobs visibles`}</span>
    </div>
    {paginationControls}
  </div>
);
