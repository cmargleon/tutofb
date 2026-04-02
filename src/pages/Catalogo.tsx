import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { LoadingBlock } from '../components/ui';
import { subscribeToClients } from '../features/clients/firebase';
import { useCatalogJobs } from '../features/catalog/useCatalogJobs';
import { Batch, Client, Job } from '../../shared/src/types';
import { resolveApprovedJobOutput } from '../../shared/src/domain';
import { formatDateTimeLong } from '../../shared/src/utils/dateUtils';
import { CatalogGarmentSection } from '../components/catalog/CatalogGarmentSection';
import { CatalogLightbox } from '../components/catalog/CatalogLightbox';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const Catalogo: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(25);
  const [lightbox, setLightbox] = useState<{ garmentIndex: number; jobIndex: number; jobId: string } | null>(null);

  const {
    batches,
    jobs,
    garmentGroups,
    loading,
    error,
    currentPage,
    totalPages,
    hasPreviousPage,
    hasNextPage,
    goToPreviousPage,
    goToNextPage,
  } = useCatalogJobs({
    clientId: selectedClientId || null,
    batchId: selectedBatchId || null,
    pageSize,
  });

  const lightboxIndexByJobId = useMemo(() => {
    const map = new Map<string, { garmentIndex: number; jobIndex: number }>();
    garmentGroups.forEach((group, garmentIndex) => {
      group.jobs.forEach((job, jobIndex) => {
        if (job.id) map.set(job.id, { garmentIndex, jobIndex });
      });
    });
    return map;
  }, [garmentGroups]);

  const batchOptions = useMemo(
    () => batches.filter((batch): batch is Batch & { id: string } => Boolean(batch.id)),
    [batches],
  );

  const selectedBatchLabel = useMemo(() => {
    if (!selectedBatchId) return 'Todos los lotes';
    const found = batchOptions.find((b) => b.id === selectedBatchId);
    return found ? `${formatDateTimeLong(found.createdAt)} · ${found.id}` : selectedBatchId;
  }, [batchOptions, selectedBatchId]);

  useEffect(() => {
    const unsub = subscribeToClients((c) => setClients(c), () => {});
    return unsub;
  }, []);

  useEffect(() => { setSelectedBatchId(''); }, [selectedClientId]);
  useEffect(() => { setLightbox(null); }, [currentPage, pageSize, selectedBatchId, selectedClientId]);

  const openLightboxForJob = useCallback((job: Job) => {
    if (!job.id || !resolveApprovedJobOutput(job)?.resultImagePath) return;
    const indexes = lightboxIndexByJobId.get(job.id);
    if (!indexes) return;
    setLightbox({ jobId: job.id, ...indexes });
  }, [lightboxIndexByJobId]);

  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  const previousLightboxTarget = useMemo(() => {
    if (!lightbox) return null;
    const group = garmentGroups[lightbox.garmentIndex];
    if (!group) return null;
    const prev = group.jobs[lightbox.jobIndex - 1];
    if (prev?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex - 1, jobId: prev.id };
    const prevGroup = garmentGroups[lightbox.garmentIndex - 1];
    const prevGroupLast = prevGroup?.jobs[prevGroup.jobs.length - 1];
    if (prevGroupLast?.id) return { garmentIndex: lightbox.garmentIndex - 1, jobIndex: prevGroup.jobs.length - 1, jobId: prevGroupLast.id };
    return null;
  }, [garmentGroups, lightbox]);

  const nextLightboxTarget = useMemo(() => {
    if (!lightbox) return null;
    const group = garmentGroups[lightbox.garmentIndex];
    if (!group) return null;
    const next = group.jobs[lightbox.jobIndex + 1];
    if (next?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex + 1, jobId: next.id };
    const nextGroup = garmentGroups[lightbox.garmentIndex + 1];
    const nextGroupFirst = nextGroup?.jobs[0];
    if (nextGroupFirst?.id) return { garmentIndex: lightbox.garmentIndex + 1, jobIndex: 0, jobId: nextGroupFirst.id };
    return null;
  }, [garmentGroups, lightbox]);

  const lightboxJob = useMemo(() => {
    if (!lightbox) return null;
    const indexed = garmentGroups[lightbox.garmentIndex]?.jobs[lightbox.jobIndex];
    if (indexed?.id === lightbox.jobId) return indexed;
    const fallback = lightboxIndexByJobId.get(lightbox.jobId);
    if (!fallback) return null;
    return garmentGroups[fallback.garmentIndex]?.jobs[fallback.jobIndex] || null;
  }, [garmentGroups, lightbox, lightboxIndexByJobId]);

  const pageLabel = totalPages ? `Página ${currentPage} de ${totalPages}` : `Página ${currentPage}`;

  const paginationControls = selectedClientId && !loading && !error ? (
    <div className="flex items-center gap-2 self-start sm:self-auto">
      <button
        type="button"
        onClick={goToPreviousPage}
        disabled={!hasPreviousPage}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
        Anterior
      </button>
      <button
        type="button"
        onClick={() => void goToNextPage()}
        disabled={!hasNextPage}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Siguiente
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,22rem)_10rem]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Cliente</span>
              <select
                id="catalog-client"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Selecciona un cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Lote</span>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                disabled={!selectedClientId}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Todos los lotes</option>
                {batchOptions.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {formatDateTimeLong(batch.createdAt)} · {batch.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Jobs por página</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                disabled={!selectedClientId}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
          </div>

          {selectedClientId && !loading && !error && (
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500">
                <span>{selectedBatchLabel}</span>
                <span className="mx-2">·</span>
                <span>{pageLabel}</span>
                <span className="mx-2">·</span>
                <span>{jobs.length} job{jobs.length === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          )}
        </div>

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

        {selectedClientId && !loading && error && (
          <div className="text-center py-16 text-red-500 text-sm">{error}</div>
        )}

        {selectedClientId && !loading && !error && garmentGroups.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p>{selectedBatchId ? 'No hay imágenes completadas para ese lote' : 'No hay imágenes completadas para este cliente'}</p>
          </div>
        )}

        {!loading && garmentGroups.length > 0 && (
          <div className="space-y-4">
            {garmentGroups.map((group) => (
              <CatalogGarmentSection
                key={group.garmentId}
                group={group}
                onImageClick={openLightboxForJob}
              />
            ))}
            <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500">
                <span>{selectedBatchLabel}</span>
                <span className="mx-2">·</span>
                <span>{pageLabel}</span>
                <span className="mx-2">·</span>
                <span>{jobs.length} job{jobs.length === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          </div>
        )}
      </div>

      {lightbox && lightboxJob && (
        <CatalogLightbox
          job={lightboxJob}
          canGoPrevious={Boolean(previousLightboxTarget)}
          canGoNext={Boolean(nextLightboxTarget)}
          onClose={handleCloseLightbox}
          onPrevious={() => previousLightboxTarget && setLightbox(previousLightboxTarget)}
          onNext={() => nextLightboxTarget && setLightbox(nextLightboxTarget)}
        />
      )}
    </div>
  );
};
