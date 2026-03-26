import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, LoadingBlock, EmptyState, StatusBadge, Button } from '../components/ui';
import { useEvaluationBatch } from '../features/evaluation/useEvaluationBatch';
import { JobBatchCarousel } from '../components/evaluation/JobBatchCarousel';
import { downloadBatchImages, downloadMultipleJobImages } from '../features/evaluation/downloadBatchImages';
import { cancelPendingBatchJobs, regenerateFailedBatchJobs, regenerateJobsBulk } from '../features/evaluation/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { Download, AlertCircle, Clock, RefreshCw, CheckSquare2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { buildJobPoseIndexMap } from '../features/evaluation/jobSlides';
import { PROVIDER_LABELS, resolveApprovedJobOutput } from '../../shared/src/domain';
import { Job, JobStatus, Provider } from '../../shared/src/types';
import { usePersistedJobOutputSelections } from '../features/evaluation/usePersistedJobOutputSelections';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const Evaluacion: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const openedWithoutBatchIdRef = useRef(batchId === null);
  const { batch, jobs, loading, error, resolvedBatchId } = useEvaluationBatch(batchId, user?.uid ?? null);
  const role = useRole();
  const [downloading, setDownloading] = useState(false);
  const [isRegeneratingFailed, setIsRegeneratingFailed] = useState(false);
  const [isCancellingPending, setIsCancellingPending] = useState(false);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [busySelectionAction, setBusySelectionAction] = useState<'download' | 'requeue' | null>(null);
  const initialFocusJobId = openedWithoutBatchIdRef.current ? jobs[jobs.length - 1]?.id || null : null;
  const { selectedOutputIdsByJobId, selectOutput } = usePersistedJobOutputSelections(
    resolvedBatchId || batchId,
    jobs,
    (error) => {
      console.error('Error persisting selected output in evaluation:', error);
      toast({
        tone: 'error',
        title: 'No pudimos guardar la selección',
        description: 'Inténtalo de nuevo desde esta tarjeta.',
      });
    },
  );

  useEffect(() => {
    if (!batchId && resolvedBatchId) {
      navigate(`/evaluacion?batchId=${resolvedBatchId}`, { replace: true });
    }
  }, [batchId, navigate, resolvedBatchId]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (providerFilter !== 'all' && job.provider !== providerFilter) return false;
        if (statusFilter !== 'all' && job.status !== statusFilter) return false;
        return true;
      }),
    [jobs, providerFilter, statusFilter],
  );

  const poseIndexes = useMemo(() => buildJobPoseIndexMap(filteredJobs), [filteredJobs]);
  const selectedJobs = useMemo(
    () => selectedJobIds.map((jobId) => filteredJobs.find((job) => job.id === jobId)).filter((job): job is Job => Boolean(job)),
    [filteredJobs, selectedJobIds],
  );

  useEffect(() => {
    setSelectedJobIds((current) => current.filter((jobId) => filteredJobs.some((job) => job.id === jobId)));
  }, [filteredJobs]);

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

  const handleDownloadSelected = async () => {
    if (!batch || selectedJobs.length === 0) return;

    setBusySelectionAction('download');
    try {
      await downloadMultipleJobImages(batch, selectedJobs, poseIndexes, selectedOutputIdsByJobId);
      toast({
        tone: 'success',
        title: 'Descarga iniciada',
        description: `Preparamos ${selectedJobs.length} imagen${selectedJobs.length === 1 ? '' : 'es'} seleccionada${selectedJobs.length === 1 ? '' : 's'}.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos descargar la selección',
        description: err.message || 'Vuelve a intentarlo con menos elementos.',
      });
    } finally {
      setBusySelectionAction(null);
    }
  };

  const handleRequeueSelected = async () => {
    if (selectedJobs.length === 0 || !role.canRegenerate) return;

    const accepted = await confirm({
      title: 'Reintentar trabajos seleccionados',
      description: `Vas a reintentar ${selectedJobs.length} trabajo${selectedJobs.length === 1 ? '' : 's'} del lote actual.`,
      impact: 'Se usarán el proveedor y la configuración actual de cada imagen seleccionada.',
      confirmLabel: 'Sí, reencolar selección',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });

    if (!accepted) return;

    setBusySelectionAction('requeue');
    setBatchActionMessage(null);

    try {
      const result = await regenerateJobsBulk(
        selectedJobs.map((job) => ({
          jobId: job.id!,
          provider: job.provider,
          prompt: job.promptBase || job.finalPrompt || '',
        })),
      );
      setBatchActionMessage(
        result.skippedJobs > 0
          ? `Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'}. ${result.skippedJobs} se omitieron por estado o datos inválidos.`
          : `Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} seleccionados del lote.`,
      );
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reintentar la selección',
        description: err.message || 'Revisa el estado de los trabajos e inténtalo nuevamente.',
      });
    } finally {
      setBusySelectionAction(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if ((event.key === 'a' || event.key === 'A') && filteredJobs.length > 0) {
        event.preventDefault();
        const visibleIds = filteredJobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId));
        const allSelected = visibleIds.every((jobId) => selectedJobIds.includes(jobId));
        setSelectedJobIds((current) =>
          allSelected ? current.filter((jobId) => !visibleIds.includes(jobId)) : Array.from(new Set([...current, ...visibleIds])),
        );
        return;
      }

      if ((event.key === 'd' || event.key === 'D') && selectedJobs.length > 0 && !busySelectionAction) {
        event.preventDefault();
        void handleDownloadSelected();
        return;
      }

      if ((event.key === 'r' || event.key === 'R') && selectedJobs.length > 0 && role.canRegenerate && !busySelectionAction) {
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
  }, [busySelectionAction, filteredJobs, role.canRegenerate, selectedJobIds, selectedJobs.length]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote seleccionado." />
        <LoadingBlock />
      </div>
    );
  }

  if (error || !resolvedBatchId) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote seleccionado." />
        <EmptyState
          title={batchId ? 'Lote no encontrado' : 'No hay evaluaciones recientes'}
          description={error || 'No se ha especificado un lote válido para evaluar.'}
          icon={<AlertCircle className="w-6 h-6" />}
          action={
            <Link
              to="/cola"
              className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Abrir cola operativa
            </Link>
          }
        />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote seleccionado." />
        <EmptyState
          title="Lote no encontrado"
          description="El lote solicitado no existe o no tienes permisos para verlo."
          icon={<AlertCircle className="w-6 h-6" />}
        />
      </div>
    );
  }

  const handleDownloadAll = async () => {
    setDownloading(true);
    try {
      await downloadBatchImages(batch, filteredJobs, selectedOutputIdsByJobId);
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos descargar las imágenes',
        description: err.message || 'Vuelve a intentarlo en unos segundos.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleRegenerateFailedJobs = async () => {
    if (!batch?.id) return;

    setIsRegeneratingFailed(true);
    setBatchActionMessage(null);

    try {
      const result = await regenerateFailedBatchJobs(batch.id);

      if (result.queuedJobs === 0) {
        setBatchActionMessage('No había trabajos fallidos pendientes para reintentar.');
      } else if (result.skippedJobs > 0) {
        setBatchActionMessage(
          `Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'}. ${result.skippedJobs} se omitieron por datos inválidos.`,
        );
      } else {
        setBatchActionMessage(`Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'} del lote.`);
      }
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reintentar los trabajos fallidos',
        description: err.message || 'Revisa el estado del lote e inténtalo nuevamente.',
      });
    } finally {
      setIsRegeneratingFailed(false);
    }
  };

  const handleCancelPendingJobs = async () => {
    if (!batch?.id) return;

    const accepted = await confirm({
      title: 'Cancelar trabajos pendientes',
      description: `Vas a detener los ${batch.pendingJobs} trabajos que siguen en cola para este lote.`,
      impact: 'Los trabajos pendientes dejarán de procesarse y tendrás que relanzarlos manualmente si todavía los necesitas.',
      confirmLabel: 'Sí, cancelar pendientes',
      cancelLabel: 'Mantener cola',
      tone: 'warning',
    });

    if (!accepted) return;

    setIsCancellingPending(true);
    setBatchActionMessage(null);

    try {
      const result = await cancelPendingBatchJobs(batch.id);
      if (result.cancelledJobs === 0) {
        setBatchActionMessage('No había trabajos pendientes para cancelar.');
      } else {
        setBatchActionMessage(`Se cancelaron ${result.cancelledJobs} trabajo${result.cancelledJobs === 1 ? '' : 's'} pendiente${result.cancelledJobs === 1 ? '' : 's'} del lote.`);
      }
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos cancelar los trabajos pendientes',
        description: err.message || 'Inténtalo nuevamente cuando el sistema esté disponible.',
      });
    } finally {
      setIsCancellingPending(false);
    }
  };

  const hasCompletedImages = filteredJobs.some(
    (job) => Boolean(resolveApprovedJobOutput(job)?.resultImagePath || (job.id && selectedOutputIdsByJobId[job.id])),
  );
  const canRegenerateFailed = role.canRegenerate && batch.failedJobs > 0;
  const canCancelPending = role.canRegenerate && batch.pendingJobs > 0;
  const hasSelection = selectedJobIds.length > 0;

  return (
    <div className={`max-w-7xl mx-auto transition-all ${hasSelection ? 'pb-28' : 'pb-12'}`}>
      {/* Page header + batch-level actions */}
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title="Evaluación"
          description="Revisa visualmente los resultados del lote seleccionado. Filtra, compara regeneraciones y actúa sobre varias tarjetas a la vez."
        />

        <div className="sticky top-4 z-20 flex flex-wrap items-center gap-2 self-end rounded-2xl bg-slate-950/80 py-2 backdrop-blur-sm lg:pt-1">
          {canCancelPending ? (
            <Button
              variant="secondary"
              icon={Clock}
              loading={isCancellingPending}
              onClick={() => void handleCancelPendingJobs()}
            >
              Cancelar pendientes
            </Button>
          ) : null}

          {canRegenerateFailed ? (
            <Button
              variant="warning"
              onClick={() => void handleRegenerateFailedJobs()}
              disabled={isRegeneratingFailed}
            >
              <RefreshCw className={`h-4 w-4 ${isRegeneratingFailed ? 'animate-spin' : ''}`} />
              Reintentar fallidos
            </Button>
          ) : null}

          {hasCompletedImages ? (
            <Button
              variant="primary"
              onClick={() => void handleDownloadAll()}
              loading={downloading}
              icon={Download}
            >
              Guardar todas
            </Button>
          ) : null}
        </div>
      </div>

      {batchActionMessage ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {batchActionMessage}
        </div>
      ) : null}

      {filteredJobs.length === 0 ? (
        <EmptyState
          title="No hay resultados para ese filtro"
          description="Ajusta proveedor o estado para volver a ver las tarjetas del lote."
          icon={<AlertCircle className="w-6 h-6" />}
        />
      ) : (
        <JobBatchCarousel
          batch={batch}
          jobs={filteredJobs}
          initialFocusJobId={initialFocusJobId}
          showFloatingGarment
          headerContent={(
            <div className="space-y-4">
              {/* Batch info row */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-800">
                  Lote actual
                </span>
                <StatusBadge status={batch.status} />
                <span className="text-sm text-slate-500">
                  {new Date(batch.createdAt?.toMillis ? batch.createdAt.toMillis() : batch.createdAt).toLocaleString()}
                </span>
              </div>

              {/* Filters + toggle row */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="block flex-1 min-w-[140px]">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Proveedor</span>
                  <select
                    value={providerFilter}
                    onChange={(event) => setProviderFilter(event.target.value as 'all' | Provider)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    <option value="all">Todos</option>
                    {(Object.keys(PROVIDER_LABELS) as Provider[]).map((providerValue) => (
                      <option key={providerValue} value={providerValue}>
                        {PROVIDER_LABELS[providerValue]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block flex-1 min-w-[140px]">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Estado</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as 'all' | JobStatus)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="processing">Procesando</option>
                    <option value="completed">Completado</option>
                    <option value="failed">Fallido</option>
                  </select>
                </label>

                {/* Batch ID toggle */}
                <button
                  type="button"
                  onClick={() => setSummaryCollapsed((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  {summaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                  ID de lote
                </button>
              </div>

              {/* Collapsible batch ID */}
              {!summaryCollapsed ? (
                <p className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                  {batch.id}
                </p>
              ) : null}
            </div>
          )}
          selectedJobIds={selectedJobIds}
          selectedOutputIdsByJobId={selectedOutputIdsByJobId}
          onToggleJob={toggleJob}
          onSelectJobs={selectJobs}
          onSelectOutput={selectOutput}
          keyboardShortcutLabel="Flechas cambian de prenda. A selecciona visibles. D descarga. R reencola."
        />
      )}

      {/* Floating selection toolbar — slides up when jobs are selected */}
      {hasSelection ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-lg backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 xl:px-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1.5 text-sm font-semibold text-indigo-700">
                <CheckSquare2 className="h-4 w-4" />
                {selectedJobIds.length} {selectedJobIds.length === 1 ? 'trabajo seleccionado' : 'trabajos seleccionados'}
              </span>
              <span className="hidden text-xs text-slate-400 sm:block">
                <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">Esc</kbd>
                {' '}para limpiar
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={Download}
                loading={busySelectionAction === 'download'}
                disabled={busySelectionAction !== null}
                onClick={() => void handleDownloadSelected()}
              >
                Descargar
              </Button>
              {role.canRegenerate ? (
                <Button
                  variant="warning"
                  size="sm"
                  disabled={busySelectionAction !== null}
                  onClick={() => void handleRequeueSelected()}
                >
                  <RefreshCw className={`h-4 w-4 ${busySelectionAction === 'requeue' ? 'animate-spin' : ''}`} />
                  Reencolar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
