import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AlertCircle, ChevronLeft, ChevronRight, Download, Images, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../components/ui';
import { RetryFailedJobsDialog } from '../components/evaluation/RetryFailedJobsDialog';
import { subscribeToClients } from '../features/clients/firebase';
import { cancelBatchProcessing, exportBatchSpreadsheet, regenerateFailedBatchJobs } from '../features/evaluation/firebase';
import { useRole } from '../features/auth/AuthProvider';
import { CatalogSortOrder, useCatalogJobs } from '../features/catalog/useCatalogJobs';
import { Batch, Client, Job, Provider } from '../../shared/src/types';
import { formatDateTimeLong, toMillisOrZero } from '../../shared/src/utils/dateUtils';
import { CatalogGarmentSection } from '../components/catalog/CatalogGarmentSection';
import { CatalogLightbox } from '../components/catalog/CatalogLightbox';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { useSystemConfig } from '../features/system/useSystemConfig';
import { PROVIDER_LABELS } from '../../shared/src/domain';
import { db } from '../firebase';

interface PendingCatalogRegeneration {
  job: Job;
  leftCatalog: boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const SORT_ORDER_OPTIONS: Array<{ value: CatalogSortOrder; label: string }> = [
  { value: 'desc', label: 'Más nuevos primero' },
  { value: 'asc', label: 'Más antiguos primero' },
];

export const Catalogo: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialClientId = searchParams.get('clientId') ?? '';
  const initialBatchId = searchParams.get('batchId') ?? '';
  const toast = useToast();
  const confirm = useConfirm();
  const role = useRole();
  const { config: systemConfig } = useSystemConfig();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(initialBatchId);
  const [pageSize, setPageSize] = useState<number>(25);
  const [sortOrder, setSortOrder] = useState<CatalogSortOrder>('desc');
  const [lightbox, setLightbox] = useState<{ garmentIndex: number; jobIndex: number; jobId: string } | null>(null);
  const [lightboxLiveJob, setLightboxLiveJob] = useState<Job | null>(null);
  const [generatingJobs, setGeneratingJobs] = useState<Job[]>([]);
  const [pendingRegenerations, setPendingRegenerations] = useState<Record<string, PendingCatalogRegeneration>>({});
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false);
  const [latestSpreadsheetDownloadUrl, setLatestSpreadsheetDownloadUrl] = useState<string | null>(null);
  const [isRegeneratingFailed, setIsRegeneratingFailed] = useState(false);
  const [isCancellingBatch, setIsCancellingBatch] = useState(false);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [isRetryDialogOpen, setIsRetryDialogOpen] = useState(false);

  const {
    batches,
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
    sortOrder,
  });

  const batchOptions = useMemo(
    () => batches.filter((batch): batch is Batch & { id: string } => Boolean(batch.id)),
    [batches],
  );
  const selectedBatch = useMemo(
    () => (selectedBatchId ? batchOptions.find((batch) => batch.id === selectedBatchId) || null : null),
    [batchOptions, selectedBatchId],
  );
  // Use counters only — the status field can be stale after bulk cancels due to trigger race
  // conditions, but counters are always set correctly by the cancel callables.
  const selectedBatchIsGenerating = Boolean(
    selectedBatch
    && (selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0),
  );

  // Auto-heal: if the batch status says active but counters are 0, the status field is stale.
  // Calling cancelBatchProcessing with no active jobs recomputes and corrects the status.
  useEffect(() => {
    if (!selectedBatch?.id) return;
    const statusIsStuck =
      (selectedBatch.status === 'pending' || selectedBatch.status === 'processing')
      && selectedBatch.pendingJobs === 0
      && selectedBatch.processingJobs === 0;
    if (!statusIsStuck) return;
    void cancelBatchProcessing(selectedBatch.id).catch(() => { /* silent */ });
  }, [selectedBatch?.id, selectedBatch?.status, selectedBatch?.pendingJobs, selectedBatch?.processingJobs]);

  useEffect(() => {
    if (!selectedBatchId || !selectedBatchIsGenerating) {
      setGeneratingJobs([]);
      return undefined;
    }

    const jobsQuery = query(
      collection(db, 'jobs'),
      where('batchId', '==', selectedBatchId),
      orderBy('createdAt', sortOrder),
    );

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        setGeneratingJobs(
          snapshot.docs
            .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
            .filter((job) => job.status === 'pending' || job.status === 'processing'),
        );
      },
      () => setGeneratingJobs([]),
    );

    return () => unsubscribe();
  }, [selectedBatchId, selectedBatchIsGenerating, sortOrder]);

  const displayGarmentGroups = useMemo(() => {
    if (generatingJobs.length === 0 && Object.keys(pendingRegenerations).length === 0) {
      return garmentGroups;
    }

    const compareJobs = (left: Job, right: Job) => (
      sortOrder === 'asc'
        ? toMillisOrZero(left.createdAt) - toMillisOrZero(right.createdAt)
        : toMillisOrZero(right.createdAt) - toMillisOrZero(left.createdAt)
    );

    const grouped = new Map(
      garmentGroups.map((group) => [
        group.garmentId,
        {
          garmentId: group.garmentId,
          garmentName: group.garmentName,
          jobs: [...group.jobs],
        },
      ]),
    );

    Object.values(pendingRegenerations).forEach(({ job }) => {
      if (!job.id) {
        return;
      }

      const existingGroup = grouped.get(job.garmentId);
      if (existingGroup) {
        const existingJobIndex = existingGroup.jobs.findIndex((existingJob) => existingJob.id === job.id);
        if (existingJobIndex >= 0) {
          existingGroup.jobs[existingJobIndex] = job;
        } else {
          existingGroup.jobs.push(job);
        }
        return;
      }

      grouped.set(job.garmentId, {
        garmentId: job.garmentId,
        garmentName: job.garmentName,
        jobs: [job],
      });
    });

    const pendingRegenerationJobIds = new Set(Object.keys(pendingRegenerations));

    generatingJobs.forEach((job) => {
      if (!job.id || pendingRegenerationJobIds.has(job.id)) {
        return;
      }

      const existingGroup = grouped.get(job.garmentId);
      if (existingGroup) {
        if (!existingGroup.jobs.some((existingJob) => existingJob.id === job.id)) {
          existingGroup.jobs.push(job);
        }
        return;
      }

      grouped.set(job.garmentId, {
        garmentId: job.garmentId,
        garmentName: job.garmentName,
        jobs: [job],
      });
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        jobs: [...group.jobs].sort(compareJobs),
      }))
      .sort((left, right) => compareJobs(left.jobs[0], right.jobs[0]));
  }, [garmentGroups, generatingJobs, pendingRegenerations, sortOrder]);

  const pendingRegenerationJobIds = useMemo(
    () => Object.keys(pendingRegenerations).reduce<Record<string, true>>((acc, jobId) => {
      acc[jobId] = true;
      return acc;
    }, {}),
    [pendingRegenerations],
  );

  const visibleJobsCount = useMemo(
    () => displayGarmentGroups.reduce((total, group) => total + group.jobs.length, 0),
    [displayGarmentGroups],
  );

  const lightboxIndexByJobId = useMemo(() => {
    const map = new Map<string, { garmentIndex: number; jobIndex: number }>();
    displayGarmentGroups.forEach((group, garmentIndex) => {
      group.jobs.forEach((job, jobIndex) => {
        if (job.id) map.set(job.id, { garmentIndex, jobIndex });
      });
    });
    return map;
  }, [displayGarmentGroups]);

  const selectedBatchLabel = useMemo(() => {
    if (!selectedBatchId) return 'Todos los lotes';
    const found = batchOptions.find((b) => b.id === selectedBatchId);
    return found ? `${formatDateTimeLong(found.createdAt)} · ${found.id}` : selectedBatchId;
  }, [batchOptions, selectedBatchId]);

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (selectedClientId) {
        next.set('clientId', selectedClientId);
      } else {
        next.delete('clientId');
      }
      if (selectedBatchId) {
        next.set('batchId', selectedBatchId);
      } else {
        next.delete('batchId');
      }
      return next;
    }, { replace: true });
  }, [selectedClientId, selectedBatchId, setSearchParams]);

  useEffect(() => {
    const unsub = subscribeToClients((c) => setClients(c), () => {});
    return unsub;
  }, []);

  useEffect(() => {
    setSelectedBatchId((currentBatchId) => {
      if (!selectedClientId) return '';
      if (selectedClientId === initialClientId) return currentBatchId;
      return '';
    });
  }, [initialClientId, selectedClientId]);

  useEffect(() => {
    setLightbox(null);
    setLatestSpreadsheetDownloadUrl(null);
    setBatchActionMessage(null);
    setPendingRegenerations({});
  }, [currentPage, pageSize, selectedBatchId, selectedClientId, sortOrder]);

  useEffect(() => {
    const visibleCatalogJobIds = new Set(
      garmentGroups.flatMap((group) => group.jobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId))),
    );
    const remotelyGeneratingJobIds = new Set(
      generatingJobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId)),
    );

    setPendingRegenerations((prev) => {
      let changed = false;
      const next: Record<string, PendingCatalogRegeneration> = {};

      (Object.entries(prev) as Array<[string, PendingCatalogRegeneration]>).forEach(([jobId, entry]) => {
        const returnedToCatalog = entry.leftCatalog && visibleCatalogJobIds.has(jobId);
        if (returnedToCatalog) {
          changed = true;
          return;
        }

        const leftCatalog = entry.leftCatalog || remotelyGeneratingJobIds.has(jobId) || !visibleCatalogJobIds.has(jobId);
        if (leftCatalog !== entry.leftCatalog) {
          changed = true;
        }

        next[jobId] = {
          ...entry,
          leftCatalog,
        };
      });

      return changed ? next : prev;
    });
  }, [garmentGroups, generatingJobs]);

  const handleRegenerationQueued = useCallback((job: Job) => {
    if (!job.id) return;

    setPendingRegenerations((prev) => ({
      ...prev,
      [job.id!]: {
        job,
        leftCatalog: false,
      },
    }));
  }, []);

  useEffect(() => {
    if (!lightbox?.jobId) {
      setLightboxLiveJob(null);
      return undefined;
    }

    const jobRef = doc(db, 'jobs', lightbox.jobId);
    return onSnapshot(
      jobRef,
      (docSnapshot) => {
        if (!docSnapshot.exists()) {
          setLightboxLiveJob(null);
          return;
        }

        setLightboxLiveJob({ id: docSnapshot.id, ...docSnapshot.data() } as Job);
      },
      () => setLightboxLiveJob(null),
    );
  }, [lightbox?.jobId]);

  const handleRegenerateFailedJobs = async (provider: Provider | null) => {
    if (!selectedBatchId) return;
    setIsRegeneratingFailed(true);
    setBatchActionMessage(null);
    try {
      const result = await regenerateFailedBatchJobs(selectedBatchId, provider);
      const providerSuffix = result.retryProvider ? ` con ${PROVIDER_LABELS[result.retryProvider]}` : '';
      if (result.queuedJobs === 0) {
        setBatchActionMessage('No había trabajos fallidos pendientes para reintentar.');
      } else if (result.skippedJobs > 0) {
        setBatchActionMessage(`Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'}${providerSuffix}. ${result.skippedJobs} se omitieron por datos inválidos.`);
      } else {
        setBatchActionMessage(`Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'} del lote${providerSuffix}.`);
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos reintentar los trabajos fallidos', description: err.message || 'Revisa el estado del lote e inténtalo nuevamente.' });
    } finally {
      setIsRegeneratingFailed(false);
    }
  };

  const handleCancelBatchProcessing = async () => {
    if (!selectedBatch?.id) return;
    const activeJobs = selectedBatch.pendingJobs + selectedBatch.processingJobs;
    const activeJobsLabel = `${activeJobs} trabajo${activeJobs === 1 ? '' : 's'}`;
    const pendingLabel = selectedBatch.pendingJobs > 0 ? `${selectedBatch.pendingJobs} pendiente${selectedBatch.pendingJobs === 1 ? '' : 's'}` : null;
    const processingLabel = selectedBatch.processingJobs > 0 ? `${selectedBatch.processingJobs} en procesamiento` : null;
    const scopeLabel = [pendingLabel, processingLabel].filter(Boolean).join(' y ');

    const accepted = await confirm({
      title: 'Cancelar procesamiento del lote',
      description: `Vas a detener ${activeJobsLabel}${scopeLabel ? ` (${scopeLabel})` : ''} para este lote.`,
      impact: 'Los jobs en cola dejarán de ejecutarse y los que ya estaban procesando ignorarán cualquier resultado tardío. Si los necesitas después, tendrás que relanzarlos manualmente.',
      confirmLabel: 'Sí, cancelar lote',
      cancelLabel: 'Seguir procesando',
      tone: 'warning',
    });
    if (!accepted) return;

    setIsCancellingBatch(true);
    setBatchActionMessage(null);
    try {
      const result = await cancelBatchProcessing(selectedBatch.id);
      if (result.cancelledJobs === 0) {
        setBatchActionMessage('No había trabajos activos para cancelar en este lote.');
      } else {
        const segments = [
          result.cancelledPendingJobs > 0 ? `${result.cancelledPendingJobs} pendiente${result.cancelledPendingJobs === 1 ? '' : 's'}` : null,
          result.cancelledProcessingJobs > 0 ? `${result.cancelledProcessingJobs} en procesamiento` : null,
        ].filter(Boolean);
        setBatchActionMessage(`Se cancelaron ${result.cancelledJobs} trabajo${result.cancelledJobs === 1 ? '' : 's'} del lote${segments.length > 0 ? `: ${segments.join(' y ')}.` : '.'}`);
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos cancelar el lote', description: err.message || 'Inténtalo nuevamente cuando el sistema esté disponible.' });
    } finally {
      setIsCancellingBatch(false);
    }
  };

  const handleExportSpreadsheet = async () => {
    if (!selectedBatchId) return;
    setIsExportingSpreadsheet(true);
    try {
      const result = await exportBatchSpreadsheet(selectedBatchId);
      setLatestSpreadsheetDownloadUrl(result.downloadUrl);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      toast({ tone: 'success', title: 'Spreadsheet exportado', description: `${result.fileName} quedó listo para descarga.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos exportar el spreadsheet', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setIsExportingSpreadsheet(false);
    }
  };

  const openLightboxForJob = useCallback((job: Job) => {
    if (!job.id) return;
    const indexes = lightboxIndexByJobId.get(job.id);
    if (!indexes) return;
    setLightbox({ jobId: job.id, ...indexes });
  }, [lightboxIndexByJobId]);

  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  const previousLightboxTarget = useMemo(() => {
    if (!lightbox) return null;
    const group = displayGarmentGroups[lightbox.garmentIndex];
    if (!group) return null;
    const prev = group.jobs[lightbox.jobIndex - 1];
    if (prev?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex - 1, jobId: prev.id };
    const prevGroup = displayGarmentGroups[lightbox.garmentIndex - 1];
    const prevGroupLast = prevGroup?.jobs[prevGroup.jobs.length - 1];
    if (prevGroupLast?.id) return { garmentIndex: lightbox.garmentIndex - 1, jobIndex: prevGroup.jobs.length - 1, jobId: prevGroupLast.id };
    return null;
  }, [displayGarmentGroups, lightbox]);

  const nextLightboxTarget = useMemo(() => {
    if (!lightbox) return null;
    const group = displayGarmentGroups[lightbox.garmentIndex];
    if (!group) return null;
    const next = group.jobs[lightbox.jobIndex + 1];
    if (next?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex + 1, jobId: next.id };
    const nextGroup = displayGarmentGroups[lightbox.garmentIndex + 1];
    const nextGroupFirst = nextGroup?.jobs[0];
    if (nextGroupFirst?.id) return { garmentIndex: lightbox.garmentIndex + 1, jobIndex: 0, jobId: nextGroupFirst.id };
    return null;
  }, [displayGarmentGroups, lightbox]);

  const lightboxJob = useMemo(() => {
    if (!lightbox) return null;
    const indexed = displayGarmentGroups[lightbox.garmentIndex]?.jobs[lightbox.jobIndex];
    if (indexed?.id === lightbox.jobId) return indexed;
    const fallback = lightboxIndexByJobId.get(lightbox.jobId);
    if (!fallback) return null;
    return displayGarmentGroups[fallback.garmentIndex]?.jobs[fallback.jobIndex] || null;
  }, [displayGarmentGroups, lightbox, lightboxIndexByJobId]);

  const resolvedLightboxJob = lightboxJob || lightboxLiveJob;

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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,22rem)_10rem_14rem]">
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

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Orden por fecha</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as CatalogSortOrder)}
                disabled={!selectedClientId}
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              >
                {SORT_ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
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
                <span>{visibleJobsCount} job{visibleJobsCount === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          )}

          {selectedBatch && role.canRegenerate && !error && (selectedBatch.failedJobs > 0 || selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0) && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
              {(selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0) && (
                <button
                  type="button"
                  onClick={() => void handleCancelBatchProcessing()}
                  disabled={isCancellingBatch}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancellingBatch
                    ? <span className="app-spinner app-spinner-sm" aria-hidden="true" />
                    : <AlertCircle className="h-4 w-4" />}
                  {isCancellingBatch ? 'Cancelando...' : 'Cancelar lote'}
                </button>
              )}
              {selectedBatch.failedJobs > 0 && (
                <button
                  type="button"
                  onClick={() => setIsRetryDialogOpen(true)}
                  disabled={isRegeneratingFailed}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${isRegeneratingFailed ? 'animate-spin' : ''}`} />
                  {isRegeneratingFailed ? 'Reintentando...' : `Reintentar fallidos (${selectedBatch.failedJobs})`}
                </button>
              )}
            </div>
          )}

          {batchActionMessage && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {batchActionMessage}
            </div>
          )}

          {selectedBatchIsGenerating && !error && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="app-spinner app-spinner-sm shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">El catálogo se actualiza solo a medida que salen imágenes nuevas.</p>
                  <p className="text-indigo-700">
                    {selectedBatch.completedJobs} de {selectedBatch.totalJobs} jobs completados en este lote.
                  </p>
                </div>
              </div>
            </div>
          )}

          {selectedBatch?.spreadsheetTemplateId && !error && (
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Excel del lote</p>
                <p className="text-xs text-gray-400">
                  Plantilla: {selectedBatch.spreadsheetTemplateNameSnapshot || 'Sin nombre'}
                  {selectedBatch.spreadsheetCategoryNameSnapshot ? ` · ${selectedBatch.spreadsheetCategoryNameSnapshot}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {latestSpreadsheetDownloadUrl && (
                  <a
                    href={latestSpreadsheetDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2"
                  >
                    Abrir descarga
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void handleExportSpreadsheet()}
                  disabled={isExportingSpreadsheet}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExportingSpreadsheet
                    ? <span className="app-spinner app-spinner-sm" aria-hidden="true" />
                    : <Download className="h-4 w-4" />}
                  {isExportingSpreadsheet ? 'Exportando...' : 'Exportar Excel'}
                </button>
              </div>
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

        {selectedClientId && !loading && !error && displayGarmentGroups.length === 0 && (
          selectedBatchIsGenerating ? (
            <div className="rounded-2xl border border-gray-200 bg-white">
              <LoadingBlock
                message={`Todavía no hay fotos aprobadas para mostrar. El lote lleva ${selectedBatch?.completedJobs ?? 0} de ${selectedBatch?.totalJobs ?? 0} jobs completados.`}
              />
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <p>{selectedBatchId ? 'No hay imágenes completadas para ese lote' : 'No hay imágenes completadas para este cliente'}</p>
            </div>
          )
        )}

        <RetryFailedJobsDialog
          isOpen={isRetryDialogOpen}
          isSubmitting={isRegeneratingFailed}
          failedJobsCount={selectedBatch?.failedJobs || 0}
          scopeLabel="este lote"
          disabledProviders={systemConfig.disabledProviders}
          onClose={() => setIsRetryDialogOpen(false)}
          onSubmit={async (provider) => {
            setIsRetryDialogOpen(false);
            await handleRegenerateFailedJobs(provider);
          }}
        />

        {!loading && displayGarmentGroups.length > 0 && (
          <div className="space-y-4">
            {displayGarmentGroups.map((group) => (
              <CatalogGarmentSection
                key={group.garmentId}
                group={group}
                onImageClick={openLightboxForJob}
                onRegenerationQueued={handleRegenerationQueued}
                pendingRegenerationJobIds={pendingRegenerationJobIds}
              />
            ))}
            <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-gray-500">
                <span>{selectedBatchLabel}</span>
                <span className="mx-2">·</span>
                <span>{pageLabel}</span>
                <span className="mx-2">·</span>
                <span>{visibleJobsCount} job{visibleJobsCount === 1 ? '' : 's'} visibles</span>
              </div>
              {paginationControls}
            </div>
          </div>
        )}
      </div>

      {lightbox && resolvedLightboxJob && (
        <CatalogLightbox
          job={resolvedLightboxJob}
          disabledProviders={systemConfig.disabledProviders}
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
