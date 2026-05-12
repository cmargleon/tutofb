import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Batch, Job, JobOutput, Provider } from '../../../shared/src/types';
import { PROVIDER_LABELS, PROVIDER_VALUES, resolveApprovedJobOutput } from '../../../shared/src/domain';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { trimUrlAfterImageExtension } from '../../features/storage/urlDisplay';
import { HoverZoomImage } from './HoverZoomImage';
import { AttemptThumbnail } from './AttemptThumbnail';
import {
  RefreshCw, ChevronLeft, ChevronRight, Heart, AlertTriangle,
  Download, ImageIcon, AlertCircle, XCircle,
} from 'lucide-react';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { useAuth, useRole } from '../../features/auth/AuthProvider';
import { toMillisOrZero as toMillis } from '../../../shared/src/utils/dateUtils';
import { setJobManualFlag } from '../../features/evaluation/firebase';

const HISTORY_LIMIT = 18;

const getGestureHintOpacityClass = (opacity: number) => {
  if (opacity >= 0.9) return 'opacity-100';
  if (opacity >= 0.6) return 'opacity-70';
  if (opacity >= 0.3) return 'opacity-40';
  return 'opacity-0';
};

const getGestureLayerOpacityClass = (isDragging: boolean, travel: number) => {
  if (!isDragging) return 'opacity-100';
  if (travel >= 90) return 'opacity-80';
  if (travel >= 45) return 'opacity-90';
  return 'opacity-100';
};

export const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element
  && Boolean(target.closest('button, a, input, textarea, select, label, [role="button"]'));

export interface PoseViewProps {
  batch: Batch;
  job: Job;
  poseIndex: number;
  garmentIndex: number;
  totalGarments: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  isCancellingGeneration: boolean;
  regenerationError: string | null;
  cancellationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
  onCancelGeneration: () => Promise<void>;
  selectedOutputId: string | null;
  onSelectOutput?: (outputId: string | null, output: JobOutput | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onPrevGarment: () => void;
  onNextGarment: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  canGoPrevGarment: boolean;
  canGoNextGarment: boolean;
  layoutMode: 'desktop' | 'tablet' | 'mobile';
  showDetailsOverlay?: boolean;
  onCloseDetailsOverlay?: () => void;
}

export const PoseView: React.FC<PoseViewProps> = ({
  batch,
  job,
  poseIndex,
  garmentIndex,
  totalGarments,
  draft,
  isQueueing,
  isCancellingGeneration,
  regenerationError,
  cancellationError,
  onUpdateDraft,
  onRegenerate,
  onCancelGeneration,
  selectedOutputId,
  onSelectOutput,
  onPrev,
  onNext,
  onPrevGarment,
  onNextGarment,
  canGoPrev,
  canGoNext,
  canGoPrevGarment,
  canGoNextGarment,
  layoutMode,
  showDetailsOverlay = false,
  onCloseDetailsOverlay,
}) => {
  const role = useRole();
  const { user } = useAuth();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [isUpdatingFlag, setIsUpdatingFlag] = useState(false);
  const [isGestureDragging, setIsGestureDragging] = useState(false);
  const [gestureDelta, setGestureDelta] = useState({ x: 0, y: 0 });
  const [gestureDirection, setGestureDirection] = useState<'left' | 'right' | 'up' | 'down' | null>(null);
  const gesturePointerIdRef = useRef<number | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const { outputs } = useJobOutputHistory(job.id, HISTORY_LIMIT);

  const outputsDesc = useMemo(() => {
    const merged = new Map<string, JobOutput>();
    [job.userSelectedOutput, job.currentOutput, ...outputs].forEach((output) => {
      if (output?.id && !merged.has(output.id)) merged.set(output.id, output);
    });
    return [...merged.values()].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [job.currentOutput, job.userSelectedOutput, outputs]);

  const currentOutput = job.currentOutput || outputsDesc[0] || null;
  const displayedOutput = useMemo(
    () => outputsDesc.find((o) => o.id === selectedOutputId) || currentOutput,
    [currentOutput, outputsDesc, selectedOutputId],
  );
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const isViewingLatest = displayedOutput?.id === currentOutput?.id;
  const isUserApproved = Boolean(displayedOutput?.id && selectedOutputId === displayedOutput.id);
  const currentOutputAutoReviewVerdict = currentOutput?.autoReview?.verdict ?? job.latestAutoReview?.verdict ?? null;
  const approvedOutputId =
    selectedOutputId
    || (currentOutputAutoReviewVerdict === 'approved' ? currentOutput?.id ?? null : null);
  const showApprovedBadge = Boolean(displayedOutput?.id && displayedOutput.id === approvedOutputId);

  const { url: displayedImageUrl, loading: displayedImageUrlLoading } = useStorageAssetUrl(displayedOutput?.resultImagePath || null);
  const displayedImageUrlLabel = displayedImageUrl ? trimUrlAfterImageExtension(displayedImageUrl) : null;

  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const isLoadingState = isProcessing || isQueueing;
  const hasOutput = !!displayedImageUrl;
  const canCancelGeneration = role.canRegenerate && isLoadingState && !isCancellingGeneration;
  const showInlineLoadingBadge = hasOutput && isLoadingState && isViewingLatest;
  const showLoadingPlaceholder = !hasOutput && isLoadingState;
  const controlsDisabled = isProcessing || isQueueing || isCancellingGeneration;
  const isManuallyFlagged = Boolean(job.manuallyFlagged);
  const gesturesEnabled = layoutMode !== 'desktop';

  useEffect(() => {
    if (selectedOutputId && !outputsDesc.some((o) => o.id === selectedOutputId)) {
      onSelectOutput?.(null, null);
    }
  }, [onSelectOutput, outputsDesc, selectedOutputId]);

  const handleDownload = async () => {
    if (!displayedOutput?.resultImagePath && !resolveApprovedJobOutput(job)?.resultImagePath) return;
    setDownloading(true);
    try {
      await downloadSingleJobImage(batch, job, poseIndex, selectedOutputId);
    } catch (err) {
      console.error('Error downloading image:', err);
      toast({ tone: 'error', title: 'No pudimos descargar la imagen', description: 'Revisa la conexión o inténtalo de nuevo.' });
    } finally {
      setDownloading(false);
    }
  };

  const handleCancelGeneration = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await onCancelGeneration();
      toast({ tone: 'success', title: 'Generación cancelada', description: `La pose ${poseIndex + 1} dejó de procesarse.` });
    } catch (err) {
      console.error('Error cancelling generation:', err);
      toast({ tone: 'error', title: 'No pudimos cancelar esta generación', description: 'Inténtalo de nuevo en unos segundos.' });
    }
  };

  const handleApproveAndAdvance = () => {
    if (!displayedOutput) return;
    onSelectOutput?.(displayedOutput.id, displayedOutput);
    if (canGoNext) onNext();
  };

  const resetGesture = () => {
    gesturePointerIdRef.current = null;
    gestureStartRef.current = null;
    setIsGestureDragging(false);
    setGestureDelta({ x: 0, y: 0 });
    setGestureDirection(null);
  };

  const resolveGestureDirection = (deltaX: number, deltaY: number) => {
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      return deltaX >= 0 ? 'right' : 'left';
    }
    return deltaY >= 0 ? 'down' : 'up';
  };

  const handleSwipeAction = (direction: 'left' | 'right' | 'up' | 'down') => {
    if (!gesturesEnabled) return;

    if (direction === 'left') {
      if (!controlsDisabled && draft.prompt.trim() && role.canRegenerate) onRegenerate();
      return;
    }

    if (direction === 'right') {
      handleApproveAndAdvance();
      return;
    }

    if (direction === 'up') {
      if (canGoPrevGarment) onPrevGarment();
      return;
    }

    if (canGoNextGarment) onNextGarment();
  };

  const handleGesturePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesturesEnabled || isInteractiveTarget(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    gesturePointerIdRef.current = event.pointerId;
    gestureStartRef.current = { x: event.clientX, y: event.clientY };
    setIsGestureDragging(true);
    setGestureDelta({ x: 0, y: 0 });
    setGestureDirection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleGesturePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesturesEnabled || gesturePointerIdRef.current !== event.pointerId || !gestureStartRef.current) return;

    const deltaX = event.clientX - gestureStartRef.current.x;
    const deltaY = event.clientY - gestureStartRef.current.y;
    const nextDirection = Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 16
      ? resolveGestureDirection(deltaX, deltaY)
      : null;

    setGestureDelta({ x: deltaX, y: deltaY });
    setGestureDirection(nextDirection);
  };

  const handleGesturePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesturesEnabled || gesturePointerIdRef.current !== event.pointerId || !gestureStartRef.current) {
      resetGesture();
      return;
    }

    const deltaX = event.clientX - gestureStartRef.current.x;
    const deltaY = event.clientY - gestureStartRef.current.y;
    const direction = resolveGestureDirection(deltaX, deltaY);
    const movement = direction === 'left' || direction === 'right' ? Math.abs(deltaX) : Math.abs(deltaY);

    if (movement >= 72) {
      handleSwipeAction(direction);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetGesture();
  };

  const handleGesturePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetGesture();
  };

  const handleToggleFlag = async () => {
    if (!job.id || isUpdatingFlag) return;

    setIsUpdatingFlag(true);
    try {
      const nextFlaggedState = !isManuallyFlagged;
      await setJobManualFlag(job.id, nextFlaggedState, user?.uid ?? null);
      toast({
        tone: nextFlaggedState ? 'warning' : 'success',
        title: nextFlaggedState ? 'Foto marcada' : 'Marca removida',
        description: nextFlaggedState
          ? 'La pose quedó flagueada en la base de datos.'
          : 'La pose dejó de estar flagueada.',
      });
    } catch (error) {
      console.error('Error updating manual flag:', error);
      toast({
        tone: 'error',
        title: 'No pudimos actualizar la marca',
        description: 'Inténtalo de nuevo en unos segundos.',
      });
    } finally {
      setIsUpdatingFlag(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        if (canGoPrev) onPrev();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        if (canGoNext) onNext();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        if (canGoPrevGarment) onPrevGarment();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        if (canGoNextGarment) onNextGarment();
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        if (!controlsDisabled && draft.prompt.trim() && role.canRegenerate) onRegenerate();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        handleApproveAndAdvance();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    canGoNext,
    canGoPrev,
    canGoNextGarment,
    canGoPrevGarment,
    controlsDisabled,
    draft.prompt,
    onNext,
    onNextGarment,
    onPrev,
    onPrevGarment,
    onRegenerate,
    role.canRegenerate,
    displayedOutput,
    onSelectOutput,
  ]);

  const detailsPanelContent = (
    <>
      <div className="border-b border-slate-100 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
          Prenda {garmentIndex + 1} / {totalGarments}
        </p>
      </div>

      {historyOutputs.length > 0 ? (
        <div className="border-b border-slate-100 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Historial</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {historyOutputs.map((output, outputIndex) => (
              <AttemptThumbnail
                key={output.id}
                output={output}
                label={formatOutputLabel(output, outputIndex)}
                active={displayedOutput?.id === output.id}
                userApproved={selectedOutputId === output.id}
                onSelect={() => onSelectOutput?.(output.id, output)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {role.canRegenerate ? (
        <div className="flex flex-col gap-3 px-3 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Prompt</label>
            <textarea
              value={draft.prompt}
              onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
              disabled={controlsDisabled}
              rows={5}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
              placeholder="Prompt para regenerar..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Modelo IA</label>
            <select
              value={draft.provider}
              onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
              disabled={controlsDisabled}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            >
              {PROVIDER_VALUES.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {role.canRegenerate ? (
        <div className="mt-auto space-y-3 border-t border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={() => onRegenerate()}
            disabled={controlsDisabled || !draft.prompt.trim() || !role.canRegenerate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isQueueing ? 'animate-spin' : ''}`} />
            Regenerar foto
          </button>
          {displayedOutput?.resultImagePath ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Archivo</p>
              {displayedImageUrl ? (
                <a
                  href={displayedImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all font-mono text-[11px] text-indigo-700 underline decoration-indigo-300 underline-offset-2"
                >
                  {displayedImageUrlLabel}
                </a>
              ) : displayedImageUrlLoading ? (
                <p className="mt-1 font-mono text-[11px] text-slate-500">Resolviendo URL...</p>
              ) : (
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{displayedOutput.resultImagePath}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {(regenerationError || cancellationError || (job.status === 'failed' && job.lastError)) ? (
        <div className="space-y-2 px-3 pb-3">
          {regenerationError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <span>{regenerationError}</span>
            </div>
          ) : null}
          {cancellationError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <span>{cancellationError}</span>
            </div>
          ) : null}
          {job.status === 'failed' && job.lastError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              <span>{job.lastError}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const gestureOffsetX = gesturesEnabled ? Math.max(-120, Math.min(120, gestureDelta.x)) : 0;
  const gestureOffsetY = gesturesEnabled ? Math.max(-120, Math.min(120, gestureDelta.y)) : 0;
  const gestureTravel = Math.max(Math.abs(gestureOffsetX), Math.abs(gestureOffsetY));
  const gestureTransform = isGestureDragging
    ? `translate3d(${gestureOffsetX}px, ${gestureOffsetY}px, 0) rotate(${gestureOffsetX / 28}deg)`
    : 'translate3d(0, 0, 0) rotate(0deg)';
  const gestureHint = gestureDirection
    ? ({
      left: 'Regenerar pose',
      right: 'Aprobar pose',
      up: 'Prenda anterior',
      down: 'Siguiente prenda',
    } satisfies Record<'left' | 'right' | 'up' | 'down', string>)[gestureDirection]
    : null;
  const gestureHintOpacity = Math.min(1, gestureTravel / 90);
  const gestureHintOpacityClass = getGestureHintOpacityClass(gestureHintOpacity);
  const gestureLayerOpacityClass = getGestureLayerOpacityClass(isGestureDragging, gestureTravel);
  const imagePanel = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={`absolute inset-0 flex items-center justify-center ${gesturesEnabled ? 'select-none touch-none' : ''}`}
          onPointerDown={handleGesturePointerDown}
          onPointerMove={handleGesturePointerMove}
          onPointerUp={handleGesturePointerUp}
          onPointerCancel={handleGesturePointerCancel}
        >
          {gesturesEnabled && gestureHint ? (
            <div
              className={`pointer-events-none absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-full bg-slate-950/82 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur-sm ${gestureHintOpacityClass}`}
            >
              {gestureHint}
            </div>
          ) : null}
          {hasOutput ? (
            <div
              className={`relative h-full will-change-transform ${gestureLayerOpacityClass} ${isGestureDragging ? 'transition-none' : 'transition-transform duration-200 ease-out'}`}
              style={{
                transform: gestureTransform,
              }}
            >
              <HoverZoomImage
                src={displayedImageUrl!}
                alt={`Pose ${poseIndex + 1}`}
                containerClassName="h-full w-auto"
                imageClassName="h-full w-full"
                preserveNaturalAspectRatio={true}
                zoomScale={1.95}
              >
                {showApprovedBadge && !isLoadingState ? (
                  <span className="absolute left-3 top-3 z-20 rounded-full bg-emerald-600/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    ✓ Aprobada
                  </span>
                ) : null}
                {!isViewingLatest ? (
                  <span
                    className={`absolute left-3 z-10 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white ${
                      showApprovedBadge && !isLoadingState ? 'top-11' : 'top-3'
                    }`}
                  >
                    {formatOutputLabel(
                      displayedOutput!,
                      historyOutputs.findIndex((output) => output.id === displayedOutput?.id),
                    )}
                  </span>
                ) : null}
              </HoverZoomImage>

              {!isLoadingState ? (
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                  title={downloading ? 'Descargando imagen...' : 'Descargar imagen'}
                  aria-label={downloading ? 'Descargando imagen' : 'Descargar imagen'}
                  className="absolute bottom-4 right-4 z-10 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-slate-950/14 text-white shadow-lg shadow-slate-950/20 backdrop-blur-md transition hover:bg-slate-950/24 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {downloading ? (
                    <RefreshCw className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <Download className="h-4.5 w-4.5" />
                  )}
                </button>
              ) : null}

              {showInlineLoadingBadge ? (
                <button
                  type="button"
                  onClick={(event) => void handleCancelGeneration(event)}
                  disabled={!canCancelGeneration}
                  className={`group absolute left-1/2 top-1/2 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-all ${
                    canCancelGeneration
                      ? 'border-indigo-200 bg-white/92 text-indigo-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                      : 'cursor-default border-indigo-200 bg-white/92 text-indigo-700'
                  }`}
                >
                  <span className={`items-center gap-2 ${canCancelGeneration ? 'flex group-hover:hidden' : 'flex'}`}>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {isCancellingGeneration ? 'Cancelando...' : isQueueing ? 'Encolando...' : 'Generando...'}
                  </span>
                  {canCancelGeneration ? (
                    <span className="hidden items-center gap-2 group-hover:flex">
                      <XCircle className="h-3.5 w-3.5" />
                      Cancelar
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          ) : (
            <div
              className={`flex h-full w-full flex-col items-center justify-center bg-slate-50 text-center will-change-transform ${gestureLayerOpacityClass} ${
                isGestureDragging ? 'transition-none' : 'transition-transform duration-200 ease-out'
              }`}
              style={{
                transform: gestureTransform,
              }}
            >
              {job.status === 'failed' && !isLoadingState ? (
                <>
                  <AlertCircle className="mb-2 h-10 w-10 text-red-400" />
                  <p className="text-sm font-medium text-red-600">Error en la generación</p>
                  {job.lastError ? <p className="mt-1 max-w-sm text-xs text-red-500">{job.lastError}</p> : null}
                </>
              ) : showLoadingPlaceholder ? (
                <>
                  <RefreshCw className="mb-4 h-10 w-10 animate-spin text-indigo-600" />
                  <p className="font-medium text-gray-900">{isQueueing ? 'Encolando...' : 'Procesando...'}</p>
                  {canCancelGeneration ? (
                    <button
                      type="button"
                      onClick={(event) => void handleCancelGeneration(event)}
                      className="mt-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {isCancellingGeneration ? 'Cancelando...' : 'Cancelar'}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <ImageIcon className="mb-2 h-10 w-10 text-slate-300" />
                  <p className="text-sm text-gray-400">Esperando resultado...</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-center gap-5 border-t border-slate-100 py-4">
        <button
          type="button"
          onClick={() => onRegenerate()}
          disabled={controlsDisabled || !draft.prompt.trim() || !role.canRegenerate}
          title="Regenerar foto"
          className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-amber-400 text-white shadow-md transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className={`h-6 w-6 ${isQueueing ? 'animate-spin' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onPrev}
          disabled={!canGoPrev}
          title="Pose anterior"
          className="evaluation-action-button evaluation-action-button--accent"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={handleApproveAndAdvance}
          disabled={!hasOutput || isLoadingState}
          title="Aprobar esta foto"
          className={`evaluation-action-button evaluation-action-button--success ${
            isUserApproved ? 'evaluation-action-button--success-active' : 'bg-white/90'
          }`}
        >
          <Heart className={`h-6 w-6 ${isUserApproved ? 'fill-current' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canGoNext}
          title="Pose siguiente"
          className="evaluation-action-button evaluation-action-button--accent"
        >
          <ChevronRight className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={() => void handleToggleFlag()}
          disabled={isUpdatingFlag}
          title={isManuallyFlagged ? 'Quitar marca' : 'Marcar foto'}
          className={`evaluation-action-button evaluation-action-button--danger ${
            isManuallyFlagged ? 'evaluation-action-button--danger-active' : 'bg-white/90'
          }`}
        >
          <AlertTriangle className={`h-6 w-6 ${isManuallyFlagged ? 'fill-current' : ''}`} />
        </button>
      </div>
    </div>
  );

  if (layoutMode === 'mobile') {
    return (
      <div className="relative flex h-full min-w-0 flex-col">
        {imagePanel}
        {showDetailsOverlay ? (
          <div className="absolute inset-y-0 right-0 z-30 w-[min(24rem,100%)] border-l border-slate-100 bg-white/95 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Detalles</span>
              <button
                type="button"
                onClick={onCloseDetailsOverlay}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
            <div className="flex h-[calc(100%-3.25rem)] min-h-0 flex-col overflow-y-auto">
              {detailsPanelContent}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid h-full w-full min-w-0 grid-cols-2">
      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-r border-slate-100">
        {detailsPanelContent}
      </div>
      {imagePanel}
    </div>
  );
};
