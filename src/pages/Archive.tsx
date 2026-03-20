import React, { useState, useEffect } from 'react';
import { PageHeader, EmptyState, LoadingBlock } from '../components/ui';
import { Archive as ArchiveIcon, FolderOpen, AlertCircle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useArchiveClients } from '../features/archive/useArchiveClients';
import { useArchiveBatches } from '../features/archive/useArchiveBatches';
import { useArchiveBatch } from '../features/archive/useArchiveBatch';
import { JobBatchCarousel } from '../components/evaluation/JobBatchCarousel';
import { downloadBatchImages } from '../features/evaluation/downloadBatchImages';

export const Archive: React.FC = () => {
  const { clients, loading: clientsLoading } = useArchiveClients();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // When clients load, select the first one if none selected
  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      setSelectedClientId(clients[0].id!);
    } else if (clients.length > 0 && selectedClientId) {
      // Check if selected client still exists
      if (!clients.find(c => c.id === selectedClientId)) {
        setSelectedClientId(clients[0].id!);
      }
    }
  }, [clients, selectedClientId]);

  // When client changes, reset batch selection
  useEffect(() => {
    setSelectedBatchId(null);
  }, [selectedClientId]);

  const { 
    batches, 
    loading: batchesLoading, 
    currentPage, 
    hasNextPage, 
    totalItems,
    totalPages,
    nextPage, 
    prevPage 
  } = useArchiveBatches(selectedClientId, 20);

  // When batches load for a new page/client, select the first one if none selected
  useEffect(() => {
    if (batches.length > 0 && !selectedBatchId) {
      setSelectedBatchId(batches[0].id!);
    } else if (batches.length > 0 && selectedBatchId) {
      // If the selected batch is no longer in the current page of batches, select the first one
      if (!batches.find(b => b.id === selectedBatchId)) {
        setSelectedBatchId(batches[0].id!);
      }
    }
  }, [batches, selectedBatchId]);

  const { batch, jobs, loading: batchLoading, error: batchError } = useArchiveBatch(selectedBatchId);

  const handleDownloadAll = async () => {
    if (!batch || jobs.length === 0) return;
    try {
      await downloadBatchImages(batch, jobs);
    } catch (error: any) {
      alert(error.message || 'Error al descargar las imágenes');
    }
  };

  if (clientsLoading) {
    return <LoadingBlock message="Cargando archivo..." />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Archivo"
        description="Aquí se consulta el historial de trabajos realizados por cliente. La evaluación activa queda reservada solo al lote en curso."
        icon={ArchiveIcon}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-6 h-6" />}
          title="Todavía no hay trabajos archivados"
          description="Cuando generes el primer lote, aparecerá aquí de inmediato organizado por cliente."
        />
      ) : (
        <div className="space-y-6">
          {/* Toolbar */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
              <select
                className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedClientId || ''}
                onChange={(e) => setSelectedClientId(e.target.value)}
              >
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[300px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Trabajo realizado</label>
              <div className="flex items-center space-x-2">
                <select
                  className="flex-1 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                  value={selectedBatchId || ''}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  disabled={batchesLoading || batches.length === 0}
                >
                  {batches.length === 0 ? (
                    <option value="">No hay lotes</option>
                  ) : (
                    batches.map(b => {
                      const dateStr = b.createdAt?.toMillis 
                        ? new Date(b.createdAt.toMillis()).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
                        : 'Fecha desconocida';
                      return (
                        <option key={b.id} value={b.id}>
                          Trabajo {b.id?.slice(0, 8)} · {dateStr} · {(b.completedJobs || 0)} imágenes · {b.modelNameSnapshot}
                        </option>
                      );
                    })
                  )}
                </select>
                
                {/* Pagination Controls */}
                <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={prevPage}
                    disabled={currentPage === 0 || batchesLoading}
                    className="p-1.5 rounded text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all"
                    title="Lotes anteriores"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-xs font-medium text-gray-500 px-2">
                    Pág. {currentPage + 1}{totalPages > 0 ? ` de ${totalPages}` : ''}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={!hasNextPage || batchesLoading}
                    className="p-1.5 rounded text-gray-600 hover:bg-white hover:shadow-sm disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:shadow-none transition-all"
                    title="Lotes siguientes"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Batch Content */}
          {batches.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="w-6 h-6" />}
              title="No hay lotes para este cliente"
              description="Este cliente aún no tiene trabajos generados."
            />
          ) : batchLoading ? (
            <LoadingBlock message="Cargando detalle del lote..." />
          ) : batchError ? (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-r-lg">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">{batchError}</p>
                </div>
              </div>
            </div>
          ) : batch && jobs.length > 0 ? (
            <div className="space-y-6">
              {/* Batch Summary */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{batch.clientNameSnapshot}</h2>
                  <p className="text-gray-500">
                    Trabajo {batch.id?.slice(0, 8)} · {batch.modelNameSnapshot} · {batch.totalJobs} resultados · {batch.createdAt?.toMillis ? new Date(batch.createdAt.toMillis()).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                  </p>
                </div>
                
                <button
                  onClick={handleDownloadAll}
                  disabled={!jobs.some(j => j.status === 'completed' && j.currentOutput?.resultImagePath)}
                  className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Guardar todas las imágenes
                </button>
              </div>

              {/* Jobs Carousel */}
              <JobBatchCarousel batch={batch} jobs={jobs} />

              {totalItems > 0 && (
                <div className="text-xs text-gray-500">
                  {totalItems} lote{totalItems === 1 ? '' : 's'} archivado{totalItems === 1 ? '' : 's'} para este cliente.
                </div>
              )}
            </div>
          ) : batch && jobs.length === 0 ? (
            <EmptyState
              icon={<AlertCircle className="w-6 h-6" />}
              title="No hay prendas para este trabajo"
              description="Este lote archivado no tiene un agrupado de prendas disponible en este momento."
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
