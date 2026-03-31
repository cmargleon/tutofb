import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingBlock, EmptyState, StatusBadge, Button } from '../components/ui';
import { useEvaluationBatch } from '../features/evaluation/useEvaluationBatch';
import { PoseSingleView } from '../components/evaluation/PoseSingleView';
import { ProductDraftEditor } from '../components/product-drafts/ProductDraftEditor';
import { downloadBatchImages, downloadMultipleJobImages } from '../features/evaluation/downloadBatchImages';
import {
  cancelBatchProcessing,
  exportBatchSpreadsheet,
  regenerateFailedBatchJobs,
  regenerateJobsBulk,
  updateBatchProductDraft,
} from '../features/evaluation/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { Download, AlertCircle, RefreshCw, CheckSquare2, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { buildJobPoseIndexMap } from '../features/evaluation/jobSlides';
import { PROVIDER_LABELS, resolveApprovedJobOutput } from '../../shared/src/domain';
import { Batch, Job, JobStatus, ProductDraft, Provider } from '../../shared/src/types';
import { usePersistedJobOutputSelections } from '../features/evaluation/usePersistedJobOutputSelections';
import { useRecentEvaluationBatches } from '../features/evaluation/useRecentEvaluationBatches';
import { useBatchProductDrafts } from '../features/evaluation/useBatchProductDrafts';
import { useBatchSpreadsheetCategory } from '../features/evaluation/useBatchSpreadsheetCategory';
import { formatDateTimeLong } from '../../shared/src/utils/dateUtils';

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
  const [isCancellingBatch, setIsCancellingBatch] = useState(false);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [busySelectionAction, setBusySelectionAction] = useState<'download' | 'requeue' | null>(null);
  const [editableProductDrafts, setEditableProductDrafts] = useState<ProductDraft[]>([]);
  const [dirtyDraftIds, setDirtyDraftIds] = useState<string[]>([]);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [isSavingAllDrafts, setIsSavingAllDrafts] = useState(false);
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false);
  const [latestSpreadsheetDownloadUrl, setLatestSpreadsheetDownloadUrl] = useState<string | null>(null);
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
  const { batches: recentBatches, loading: recentBatchesLoading } = useRecentEvaluationBatches(user?.uid ?? null);
  const { productDrafts, loading: productDraftsLoading, error: productDraftsError } = useBatchProductDrafts(resolvedBatchId || batchId);
  const {
    category: spreadsheetCategory,
    loading: spreadsheetCategoryLoading,
    error: spreadsheetCategoryError,
  } = useBatchSpreadsheetCategory(batch);

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
  const batchOptions = useMemo(() => {
    const merged = new Map<string, Batch>();

    recentBatches.forEach((recentBatch) => {
      if (recentBatch.id) {
        merged.set(recentBatch.id, recentBatch);
      }
    });

    if (batch?.id && !merged.has(batch.id)) {
      merged.set(batch.id, batch);
    }

    return [...merged.values()];
  }, [batch, recentBatches]);
  const selectedJobs = useMemo(
    () => selectedJobIds.map((jobId) => filteredJobs.find((job) => job.id === jobId)).filter((job): job is Job => Boolean(job)),
    [filteredJobs, selectedJobIds],
  );

  useEffect(() => {
    setSelectedJobIds((current) => current.filter((jobId) => filteredJobs.some((job) => job.id === jobId)));
  }, [filteredJobs]);

  useEffect(() => {
    setEditableProductDrafts((current) => {
      const currentById = new Map<string, ProductDraft>();
      current.forEach((draft) => {
        if (draft.id) {
          currentById.set(draft.id, draft);
        }
      });

      return productDrafts.map((draft) => {
        const currentDraft = draft.id ? currentById.get(draft.id) : null;
        if (!currentDraft || !draft.id || !dirtyDraftIds.includes(draft.id)) {
          return draft;
        }

        return {
          ...draft,
          rows: currentDraft.rows,
        };
      });
    });
  }, [dirtyDraftIds, productDrafts]);

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

  const handleDraftRowsChange = (draft: ProductDraft, rows: ProductDraft['rows']) => {
    if (!draft.id) {
      return;
    }

    setEditableProductDrafts((current) =>
      current.map((entry) => (entry.id === draft.id ? { ...entry, rows } : entry)),
    );
    setDirtyDraftIds((current) => (current.includes(draft.id!) ? current : [...current, draft.id!]));
  };

  const saveDraft = async (draftId: string) => {
    if (!resolvedBatchId) {
      return;
    }

    const draft = editableProductDrafts.find((entry) => entry.id === draftId);
    if (!draft) {
      return;
    }

    setSavingDraftId(draftId);
    try {
      await updateBatchProductDraft(resolvedBatchId, draftId, draft.rows);
      setDirtyDraftIds((current) => current.filter((entry) => entry !== draftId));
      toast({
        tone: 'success',
        title: 'Product draft guardado',
        description: `${draft.garmentName} quedó actualizado en el lote.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos guardar el product draft',
        description: err.message || 'Inténtalo de nuevo en unos segundos.',
      });
    } finally {
      setSavingDraftId(null);
    }
  };

  const saveDirtyDrafts = async () => {
    if (!resolvedBatchId || dirtyDraftIds.length === 0) {
      return;
    }

    setIsSavingAllDrafts(true);
    try {
      for (const draftId of dirtyDraftIds) {
        const draft = editableProductDrafts.find((entry) => entry.id === draftId);
        if (!draft) {
          continue;
        }

        await updateBatchProductDraft(resolvedBatchId, draftId, draft.rows);
      }

      setDirtyDraftIds([]);
      toast({
        tone: 'success',
        title: 'Drafts guardados',
        description: 'Todos los cambios pendientes quedaron persistidos.',
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos guardar todos los drafts',
        description: err.message || 'Revisa el draft marcado y vuelve a intentarlo.',
      });
      throw err;
    } finally {
      setIsSavingAllDrafts(false);
    }
  };

  const handleExportSpreadsheet = async () => {
    if (!resolvedBatchId) {
      return;
    }

    setIsExportingSpreadsheet(true);
    try {
      if (dirtyDraftIds.length > 0) {
        await saveDirtyDrafts();
      }

      const result = await exportBatchSpreadsheet(resolvedBatchId);
      setLatestSpreadsheetDownloadUrl(result.downloadUrl);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      toast({
        tone: 'success',
        title: 'Spreadsheet exportado',
        description: `${result.fileName} quedó listo para descarga.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos exportar el spreadsheet',
        description: err.message || 'Completa los campos requeridos y vuelve a intentarlo.',
      });
    } finally {
      setIsExportingSpreadsheet(false);
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
      <div>
        <LoadingBlock />
      </div>
    );
  }

  if (error || !resolvedBatchId) {
    return (
      <div>
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
      <div>
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

  const handleCancelBatchProcessing = async () => {
    if (!batch?.id) return;

    const activeJobs = batch.pendingJobs + batch.processingJobs;
    const activeJobsLabel = `${activeJobs} trabajo${activeJobs === 1 ? '' : 's'}`;
    const pendingLabel = batch.pendingJobs > 0
      ? `${batch.pendingJobs} pendiente${batch.pendingJobs === 1 ? '' : 's'}`
      : null;
    const processingLabel = batch.processingJobs > 0
      ? `${batch.processingJobs} en procesamiento`
      : null;
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
      const result = await cancelBatchProcessing(batch.id);
      if (result.cancelledJobs === 0) {
        setBatchActionMessage('No había trabajos activos para cancelar en este lote.');
      } else {
        const segments = [
          result.cancelledPendingJobs > 0
            ? `${result.cancelledPendingJobs} pendiente${result.cancelledPendingJobs === 1 ? '' : 's'}`
            : null,
          result.cancelledProcessingJobs > 0
            ? `${result.cancelledProcessingJobs} en procesamiento`
            : null,
        ].filter(Boolean);
        setBatchActionMessage(
          `Se cancelaron ${result.cancelledJobs} trabajo${result.cancelledJobs === 1 ? '' : 's'} del lote${segments.length > 0 ? `: ${segments.join(' y ')}.` : '.'}`,
        );
      }
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos cancelar el lote',
        description: err.message || 'Inténtalo nuevamente cuando el sistema esté disponible.',
      });
    } finally {
      setIsCancellingBatch(false);
    }
  };

  const hasCompletedImages = filteredJobs.some(
    (job) => Boolean(resolveApprovedJobOutput(job)?.resultImagePath || (job.id && selectedOutputIdsByJobId[job.id])),
  );
  const canRegenerateFailed = role.canRegenerate && batch.failedJobs > 0;
  const canCancelBatch = role.canRegenerate && (batch.pendingJobs > 0 || batch.processingJobs > 0);
  const hasSelection = selectedJobIds.length > 0;
  const selectedBatchOptionValue = resolvedBatchId || batch.id || '';

  return (
    <div className={`transition-all ${hasSelection ? 'pb-28' : ''}`}>
      {/* Batch-level action pills (cancel/retry) */}
      {(canCancelBatch || canRegenerateFailed) ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {canCancelBatch ? (
            <Button
              variant="danger"
              icon={AlertCircle}
              loading={isCancellingBatch}
              onClick={() => void handleCancelBatchProcessing()}
            >
              Cancelar lote
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
        </div>
      ) : null}

      {batchActionMessage ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {batchActionMessage}
        </div>
      ) : null}

      {batch.spreadsheetTemplateId ? (
        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Product drafts del lote</h2>
              <p className="mt-1 text-sm text-slate-500">
                Edita lo inferido por Gemini, completa los campos comerciales faltantes y exporta la plantilla masiva del cliente.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Plantilla: {batch.spreadsheetTemplateNameSnapshot || 'Sin nombre'} · Categoría: {batch.spreadsheetCategoryNameSnapshot || 'Sin categoría'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {dirtyDraftIds.length > 0 ? (
                <Button
                  variant="secondary"
                  icon={Save}
                  loading={isSavingAllDrafts}
                  disabled={isExportingSpreadsheet}
                  onClick={() => void saveDirtyDrafts()}
                >
                  Guardar pendientes ({dirtyDraftIds.length})
                </Button>
              ) : null}
              <Button
                variant="primary"
                icon={Download}
                loading={isExportingSpreadsheet}
                disabled={productDraftsLoading || spreadsheetCategoryLoading || editableProductDrafts.length === 0}
                onClick={() => void handleExportSpreadsheet()}
              >
                Exportar spreadsheet
              </Button>
            </div>
          </div>

          {latestSpreadsheetDownloadUrl ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Export más reciente listo.
              {' '}
              <a
                href={latestSpreadsheetDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline decoration-emerald-300 underline-offset-2"
              >
                Abrir descarga
              </a>
            </div>
          ) : null}

          <div className="mt-4">
            <ProductDraftEditor
              category={spreadsheetCategory}
              drafts={editableProductDrafts}
              loading={productDraftsLoading || spreadsheetCategoryLoading}
              error={productDraftsError || spreadsheetCategoryError}
              emptyCopy="Este lote todavía no tiene product drafts listos para editar."
              saveLabel="Guardar draft"
              savingDraftId={savingDraftId}
              onChangeRows={(draft, rows) => handleDraftRowsChange(draft as ProductDraft, rows)}
              onSaveDraft={(draft) => {
                if (draft.id) {
                  void saveDraft(draft.id);
                }
              }}
            />
          </div>
        </section>
      ) : null}

      {filteredJobs.length === 0 ? (
        <EmptyState
          title="No hay resultados para ese filtro"
          description="Ajusta proveedor o estado para volver a ver las tarjetas del lote."
          icon={<AlertCircle className="w-6 h-6" />}
        />
      ) : (
        <PoseSingleView
          batch={batch}
          jobs={filteredJobs}
          initialFocusJobId={initialFocusJobId}
          headerContent={(
            <div>
              {/* Always-visible row: lote tag + toggle */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-800">
                  Lote actual
                </span>
                <StatusBadge status={batch.status} />
                <span className="text-sm text-slate-500">
                  {new Date(batch.createdAt?.toMillis ? batch.createdAt.toMillis() : batch.createdAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => setHeaderCollapsed((c) => !c)}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
                >
                  {headerCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                  {headerCollapsed ? 'Filtros' : 'Colapsar'}
                </button>
              </div>

              {/* Collapsible filters */}
              {!headerCollapsed ? (
                <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block flex-[1.6] min-w-[260px]">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Lote</span>
                      <select
                        value={selectedBatchOptionValue}
                        onChange={(event) => {
                          const nextBatchId = event.target.value;
                          if (nextBatchId && nextBatchId !== resolvedBatchId) {
                            navigate(`/evaluacion?batchId=${nextBatchId}`);
                          }
                        }}
                        disabled={recentBatchesLoading || batchOptions.length === 0}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        {batchOptions.length === 0 ? (
                          <option value="">{recentBatchesLoading ? 'Cargando lotes...' : 'Sin lotes disponibles'}</option>
                        ) : null}
                        {batchOptions.map((batchOption) => (
                          <option key={batchOption.id} value={batchOption.id}>
                            {[
                              batchOption.clientNameSnapshot,
                              batchOption.modelNameSnapshot,
                              formatDateTimeLong(batchOption.createdAt),
                              batchOption.id?.slice(0, 8),
                            ].filter(Boolean).join(' · ')}
                          </option>
                        ))}
                      </select>
                    </label>
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
                    <button
                      type="button"
                      onClick={() => setSummaryCollapsed((current) => !current)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                    >
                      {summaryCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                      ID de lote
                    </button>
                  </div>
                  {!summaryCollapsed ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                      {batch.id}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          selectedOutputIdsByJobId={selectedOutputIdsByJobId}
          onSelectOutput={selectOutput}
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

      {/* Floating "Guardar todas" FAB — bottom-right */}
      {hasCompletedImages ? (
        <button
          type="button"
          onClick={() => void handleDownloadAll()}
          disabled={downloading}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-green-500 text-white shadow-xl transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-60"
          title="Guardar todas las imágenes"
          style={{ bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))' }}
        >
          {downloading
            ? <RefreshCw className="h-6 w-6 animate-spin" />
            : <Download className="h-6 w-6" />
          }
        </button>
      ) : null}
    </div>
  );
};
