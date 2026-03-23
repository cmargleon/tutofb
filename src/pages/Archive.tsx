import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Archive as ArchiveIcon, ChevronDown, ChevronUp, Download, FolderOpen, RefreshCw, Search } from 'lucide-react';
import { EmptyState, LoadingBlock, PageHeader, StatusBadge } from '../components/ui';
import { useArchiveClients } from '../features/archive/useArchiveClients';
import { useArchiveSearch } from '../features/archive/useArchiveSearch';
import { useArchiveBatch } from '../features/archive/useArchiveBatch';
import { JobBatchCarousel } from '../components/evaluation/JobBatchCarousel';
import { downloadBatchImages, downloadMultipleJobImages } from '../features/evaluation/downloadBatchImages';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { regenerateJobsBulk } from '../features/evaluation/firebase';
import { buildJobPoseIndexMap } from '../features/evaluation/jobSlides';
import { PROVIDER_LABELS, resolveApprovedJobOutput } from '../../shared/src/domain';
import { Batch, Job, JobStatus, Provider } from '../../shared/src/types';
import { usePersistedJobOutputSelections } from '../features/evaluation/usePersistedJobOutputSelections';

const SEARCH_PAGE_SIZE = 40;

import { formatDateTimeLong as formatDateTime } from '../../shared/src/utils/dateUtils';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const Archive: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const { appUser, loading: authLoading, user } = useAuth();
  const role = useRole();
  const { clients, loading: clientsLoading } = useArchiveClients();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [clientId, setClientId] = useState('all');
  const [provider, setProvider] = useState<'all' | Provider>('all');
  const [batchStatus, setBatchStatus] = useState<'all' | Batch['status']>('all');
  const [jobStatus, setJobStatus] = useState<'all' | JobStatus>('all');
  const [modelQuery, setModelQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<'download' | 'requeue' | null>(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);

  const archiveSearchEnabled = !authLoading && Boolean(user && appUser?.active);

  const { results, loading: resultsLoading, loadingMore, error: resultsError, scannedBatches, hasMore, loadMore } = useArchiveSearch(
    {
      clientId,
      provider,
      batchStatus,
      jobStatus,
      modelQuery,
      dateFrom,
      dateTo,
    },
    archiveSearchEnabled,
    SEARCH_PAGE_SIZE,
  );

  useEffect(() => {
    if (results.length === 0) {
      setSelectedBatchId(null);
      return;
    }

    if (!selectedBatchId || !results.some((result) => result.batch.id === selectedBatchId)) {
        setSelectedBatchId(results[0].batch.id!);
    }
  }, [results, selectedBatchId]);

  const selectedResult = useMemo(
    () => results.find((result) => result.batch.id === selectedBatchId) || null,
    [results, selectedBatchId],
  );

  const { batch, jobs, loading: batchLoading, error: batchError } = useArchiveBatch(selectedBatchId);
  const { selectedOutputIdsByJobId, selectOutput } = usePersistedJobOutputSelections(
    selectedBatchId,
    jobs,
    (error) => {
      console.error('Error persisting selected output in archive:', error);
      toast({
        tone: 'error',
        title: 'No pudimos guardar la selección',
        description: 'Inténtalo de nuevo desde Archivo.',
      });
    },
  );

  const visibleJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (provider !== 'all' && job.provider !== provider) {
          return false;
        }

        if (jobStatus !== 'all' && job.status !== jobStatus) {
          return false;
        }

        return true;
      }),
    [jobStatus, jobs, provider],
  );

  const downloadableVisibleJobsCount = useMemo(
    () =>
      visibleJobs.filter(
        (job) => Boolean(resolveApprovedJobOutput(job)?.resultImagePath || (job.id && selectedOutputIdsByJobId[job.id])),
      ).length,
    [selectedOutputIdsByJobId, visibleJobs],
  );

  const poseIndexes = useMemo(() => buildJobPoseIndexMap(visibleJobs), [visibleJobs]);

  const selectedJobs = useMemo(
    () => selectedJobIds.map((jobId) => visibleJobs.find((job) => job.id === jobId)).filter((job): job is Job => Boolean(job)),
    [selectedJobIds, visibleJobs],
  );

  const activeFilterCount = useMemo(
    () => [
      clientId !== 'all',
      provider !== 'all',
      batchStatus !== 'all',
      jobStatus !== 'all',
      modelQuery.trim().length > 0,
      dateFrom.length > 0,
      dateTo.length > 0,
    ].filter(Boolean).length,
    [batchStatus, clientId, dateFrom, dateTo, jobStatus, modelQuery, provider],
  );

  useEffect(() => {
    setSelectedJobIds((current) => current.filter((jobId) => visibleJobs.some((job) => job.id === jobId)));
  }, [visibleJobs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if ((event.key === 'a' || event.key === 'A') && visibleJobs.length > 0) {
        event.preventDefault();
        const visibleIds = visibleJobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId));
        const allSelected = visibleIds.every((jobId) => selectedJobIds.includes(jobId));
        setSelectedJobIds((current) =>
          allSelected ? current.filter((jobId) => !visibleIds.includes(jobId)) : Array.from(new Set([...current, ...visibleIds])),
        );
        return;
      }

      if ((event.key === 'd' || event.key === 'D') && selectedJobs.length > 0 && !busyAction) {
        event.preventDefault();
        void handleDownloadSelected();
        return;
      }

      if ((event.key === 'r' || event.key === 'R') && selectedJobs.length > 0 && role.canRegenerate && !busyAction) {
        event.preventDefault();
        void handleRequeueSelected();
        return;
      }

      if (event.key === 'Escape' && selectedJobIds.length > 0) {
        event.preventDefault();
        setSelectedJobIds([]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyAction, role.canRegenerate, selectedJobIds, selectedJobs.length, visibleJobs]);

  const toggleJob = (jobId: string) => {
    setSelectedJobIds((current) =>
      current.includes(jobId) ? current.filter((value) => value !== jobId) : [...current, jobId],
    );
  };

  const selectJobs = (jobIds: string[], selected: boolean) => {
    setSelectedJobIds((current) =>
      selected ? Array.from(new Set([...current, ...jobIds])) : current.filter((jobId) => !jobIds.includes(jobId)),
    );
  };

  const handleDownloadAll = async () => {
    if (!batch || visibleJobs.length === 0) {
      return;
    }

    setBusyAction('download');
    try {
      await downloadBatchImages(batch, visibleJobs, selectedOutputIdsByJobId);
      toast({
        tone: 'success',
        title: 'Descarga iniciada',
        description: `Preparamos el ZIP con ${downloadableVisibleJobsCount} imagen${downloadableVisibleJobsCount === 1 ? '' : 'es'} visible${downloadableVisibleJobsCount === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos descargar las imágenes',
        description: error.message || 'Inténtalo otra vez desde el archivo.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadSelected = async () => {
    if (!batch || selectedJobs.length === 0) {
      return;
    }

    setBusyAction('download');
    try {
      await downloadMultipleJobImages(batch, selectedJobs, poseIndexes, selectedOutputIdsByJobId);
      toast({
        tone: 'success',
        title: 'Descarga iniciada',
        description: `Preparamos ${selectedJobs.length} imagen${selectedJobs.length === 1 ? '' : 'es'} seleccionada${selectedJobs.length === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos descargar la selección',
        description: error.message || 'Vuelve a intentarlo con menos elementos.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequeueSelected = async () => {
    if (selectedJobs.length === 0 || !role.canRegenerate) {
      return;
    }

    const accepted = await confirm({
      title: 'Reencolar selección archivada',
      description: `Vas a volver a encolar ${selectedJobs.length} trabajo${selectedJobs.length === 1 ? '' : 's'} desde el archivo.`,
      impact: 'Se usarán el proveedor y la configuración actual de cada trabajo. Las nuevas salidas reemplazarán el resultado actual cuando terminen.',
      confirmLabel: 'Sí, reencolar',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });

    if (!accepted) {
      return;
    }

    setBusyAction('requeue');
    try {
      const result = await regenerateJobsBulk(
        selectedJobs.map((job) => ({
          jobId: job.id!,
          provider: job.provider,
          prompt: job.promptBase || job.finalPrompt || '',
        })),
      );
      toast({
        tone: 'success',
        title: 'Regeneraciones encoladas',
        description:
          result.skippedJobs > 0
            ? `Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} y ${result.skippedJobs} se omitieron.`
            : `Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} desde el archivo.`,
      });
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reencolar la selección',
        description: error.message || 'Revisa el estado de los trabajos e inténtalo nuevamente.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (clientsLoading) {
    return <LoadingBlock message="Cargando archivo..." />;
  }

  const bulkActions = (
    <>
      <button
        type="button"
        onClick={() => void handleDownloadSelected()}
        disabled={selectedJobs.length === 0 || busyAction !== null}
        className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Descargar selección
      </button>
      {role.canRegenerate ? (
        <button
          type="button"
          onClick={() => void handleRequeueSelected()}
          disabled={selectedJobs.length === 0 || busyAction !== null}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busyAction === 'requeue' ? 'animate-spin' : ''}`} />
          Reencolar selección
        </button>
      ) : null}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <PageHeader
        title="Archivo"
        description="Busca lotes reales por estado, cliente, modelo, prenda, fecha y proveedor. Cuando abras uno puedes comparar regeneraciones y actuar sobre múltiples trabajos sin salir del historial."
        icon={ArchiveIcon}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-6 h-6" />}
          title="Todavía no hay trabajos archivados"
          description="Cuando generes el primer lote, aparecerá aquí organizado para búsqueda y reuso."
        />
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setFiltersCollapsed((current) => !current)}
              className="flex w-full items-center justify-between gap-4 text-left"
              aria-expanded={!filtersCollapsed}
              aria-controls="archive-filters-panel"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">Filtros</h2>
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                      {activeFilterCount} activo{activeFilterCount === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      Sin filtros
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Filtra por cliente, proveedor, estado, modelo y fechas.
                </p>
              </div>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                {filtersCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
              </span>
            </button>

            {!filtersCollapsed ? (
              <div id="archive-filters-panel" className="mt-5 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Cliente</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                  >
                    <option value="all">Todos los clientes</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Proveedor</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as 'all' | Provider)}
                  >
                    <option value="all">Todos los proveedores</option>
                    {(Object.keys(PROVIDER_LABELS) as Provider[]).map((providerValue) => (
                      <option key={providerValue} value={providerValue}>
                        {PROVIDER_LABELS[providerValue]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Estado del lote</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={batchStatus}
                    onChange={(event) => setBatchStatus(event.target.value as 'all' | Batch['status'])}
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="processing">Procesando</option>
                    <option value="completed">Completado</option>
                    <option value="partial_failed">Parcial</option>
                    <option value="failed">Fallido</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Estado del job</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={jobStatus}
                    onChange={(event) => setJobStatus(event.target.value as 'all' | JobStatus)}
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="processing">Procesando</option>
                    <option value="completed">Completado</option>
                    <option value="failed">Fallido</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Modelo</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={searchInputRef}
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      placeholder="Busca por modelo"
                      className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Desde</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Hasta</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>{results.length} lote{results.length === 1 ? '' : 's'} cargado{results.length === 1 ? '' : 's'} hasta ahora.</span>
              <span>La búsqueda corre en Firebase y revisó {scannedBatches} lote{scannedBatches === 1 ? '' : 's'} acumulado{scannedBatches === 1 ? '' : 's'}.</span>
              {hasMore ? <span>Hay más historial disponible para estos filtros.</span> : <span>Llegaste al final del historial para esta búsqueda.</span>}
              <span>Atajos: `/` enfoca modelo, `A` selecciona visibles, `D` descarga, `R` reencola, `Esc` limpia.</span>
            </div>
            {hasMore ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={resultsLoading || loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                  {loadingMore ? 'Buscando más lotes...' : 'Cargar más resultados'}
                </button>
              </div>
            ) : null}
          </div>

          {resultsLoading ? (
            <LoadingBlock message="Buscando en el archivo..." />
          ) : resultsError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {resultsError}
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              icon={<Search className="w-6 h-6" />}
              title="No encontramos lotes para esa búsqueda"
              description="Ajusta cliente, estado, modelo, fecha o proveedor para ampliar resultados."
            />
          ) : (
            <>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Lote</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    value={selectedBatchId ?? ''}
                    onChange={(event) => setSelectedBatchId(event.target.value)}
                  >
                    {results.map((result) => (
                      <option key={result.batch.id} value={result.batch.id}>
                        {result.batch.clientNameSnapshot} / {result.batch.modelNameSnapshot} · {formatDateTime(result.batch.createdAt)} · {result.batch.id?.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedResult ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {selectedResult.batch.clientNameSnapshot} / {selectedResult.batch.modelNameSnapshot}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Lote {selectedResult.batch.id?.slice(0, 8)} · {formatDateTime(selectedResult.batch.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={selectedResult.batch.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full bg-white px-2.5 py-1">
                        {PROVIDER_LABELS[selectedResult.batch.provider]}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1">
                        {selectedResult.matchedJobCount} match{selectedResult.matchedJobCount === 1 ? '' : 'es'}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1">
                        {selectedResult.matchedGarments.slice(0, 2).join(', ')}
                        {selectedResult.matchedGarments.length > 2 ? ` +${selectedResult.matchedGarments.length - 2}` : ''}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {batchLoading ? (
                <LoadingBlock message="Cargando detalle del lote..." />
              ) : batchError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {batchError}
                </div>
              ) : batch && visibleJobs.length > 0 ? (
                <div className="space-y-6">
                  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold text-slate-900">
                          {batch.clientNameSnapshot} <span className="mx-2 font-normal text-slate-400">/</span> {batch.modelNameSnapshot}
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                          Lote {batch.id?.slice(0, 8)} · {formatDateTime(batch.createdAt)} · {visibleJobs.length} job{visibleJobs.length === 1 ? '' : 's'} visibles
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void handleDownloadAll()}
                          disabled={busyAction === 'download' || downloadableVisibleJobsCount === 0}
                          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                          {busyAction === 'download' ? 'Preparando descarga...' : 'Descargar visibles'}
                        </button>
                        {selectedJobs.length > 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {selectedJobs.length} job{selectedJobs.length === 1 ? '' : 's'} seleccionado{selectedJobs.length === 1 ? '' : 's'}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <JobBatchCarousel
                    batch={batch}
                    jobs={visibleJobs}
                    showFloatingGarment
                    selectedJobIds={selectedJobIds}
                    selectedOutputIdsByJobId={selectedOutputIdsByJobId}
                    onToggleJob={toggleJob}
                    onSelectJobs={selectJobs}
                    onSelectOutput={selectOutput}
                    bulkActions={bulkActions}
                    keyboardShortcutLabel="Flechas cambian de prenda. A selecciona visibles. D descarga. R reencola."
                  />
                </div>
              ) : selectedResult ? (
                <EmptyState
                  icon={<AlertCircle className="w-6 h-6" />}
                  title="El lote no tiene trabajos para este filtro"
                  description="Prueba con otro estado o proveedor para volver a ver resultados."
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
};
