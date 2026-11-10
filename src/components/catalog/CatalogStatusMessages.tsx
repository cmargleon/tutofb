import React from 'react';
import { Images } from 'lucide-react';
import { LoadingBlock } from '../ui';
import { Batch } from '../../../shared/src/types';

export const CatalogStatusMessages: React.FC<{
  selectedClientId: string;
  selectedBatchId: string;
  selectedBatch: Batch | null;
  selectedBatchIsGenerating: boolean;
  loading: boolean;
  error: string | null;
  batchLinkError: string | null;
  garmentGroupsCount: number;
}> = ({
  selectedClientId,
  selectedBatchId,
  selectedBatch,
  selectedBatchIsGenerating,
  loading,
  error,
  batchLinkError,
  garmentGroupsCount,
}) => (
  <>
    {!selectedClientId && (
      <div className="text-center py-16 text-gray-400">
        <Images className="w-12 h-12 mx-auto mb-3 opacity-40" />
        <p>Selecciona un cliente para ver su catálogo</p>
      </div>
    )}

    {selectedClientId && loading && (
      <div className="flex items-center justify-center py-16">
        <LoadingBlock />
      </div>
    )}

    {!loading && (error || batchLinkError) && (
      <div className="text-center py-16 text-red-500 text-sm">{error || batchLinkError}</div>
    )}

    {selectedClientId && !loading && !error && garmentGroupsCount === 0 && (
      selectedBatchIsGenerating ? (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <LoadingBlock
            message={`Todavía no hay fotos aprobadas para mostrar. El lote lleva ${selectedBatch?.completedJobs ?? 0} de ${selectedBatch?.totalJobs ?? 0} jobs completados.`}
          />
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <p>{selectedBatchId ? 'No hay imágenes completadas para ese lote' : 'Este cliente todavía no tiene lotes.'}</p>
        </div>
      )
    )}
  </>
);
