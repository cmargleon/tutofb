import React, { useEffect, useMemo, useState } from 'react';
import { Batch, Job, JobAutoReview, JobAutoReviewMarketplaceData, JobOutput, Provider } from '../../../shared/src/types';
import { StatusBadge } from '../ui';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  ImageIcon,
  Layers3,
  RefreshCw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useRole } from '../../features/auth/AuthProvider';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { downloadSingleJobImage } from '../../features/evaluation/downloadBatchImages';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { useJobOutputHistory } from '../../features/evaluation/useJobOutputHistory';
import { HoverZoomImage } from './HoverZoomImage';

interface Props {
  batch: Batch;
  job: Job;
  index: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  regenerationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
  selected?: boolean;
  onToggleSelected?: () => void;
  focused?: boolean;
  onFocusTraceability?: () => void;
}

const INPUT_BASE =
  'w-full rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed';
const HISTORY_LIMIT = 18;

const reviewTone = (review: JobAutoReview | null): string => {
  if (!review) return 'border-slate-200 bg-slate-50 text-slate-600';
  return review.verdict === 'approved'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
};

const reviewTitle = (review: JobAutoReview | null): string => {
  if (!review) return 'Sin revisión automática registrada';
  return review.verdict === 'approved' ? 'Aprobada por Gemini' : 'Gemini pidió otro intento';
};

const formatOutputLabel = (output: JobOutput, fallbackIndex: number): string =>
  output.generationAttempt ? `Intento ${output.generationAttempt}` : `Salida ${fallbackIndex + 1}`;

const marketplaceFieldValue = (value: string | null | undefined): string => value?.trim() || 'Sin dato';
const EMPTY_MARKETPLACE_DATA: JobAutoReviewMarketplaceData = {
  title: null,
  description: null,
  brand: null,
  gender: null,
  garmentType: null,
  primaryColor: null,
  sport: null,
  isSportswear: null,
};

export const JobEvaluationCard: React.FC<Props> = ({
  batch,
  job,
  index,
  draft,
  isQueueing,
  regenerationError,
  onUpdateDraft,
  onRegenerate,
  selected = false,
  onToggleSelected,
  focused = false,
  onFocusTraceability,
}) => {
  const role = useRole();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [marketplaceExpanded, setMarketplaceExpanded] = useState(false);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const { outputs } = useJobOutputHistory(job.id, HISTORY_LIMIT);
  const isExperimentJob = job.experimentEnabled === true;

  const outputsDesc = useMemo(() => {
    const next = [...outputs];
    if (job.currentOutput && !next.some((output) => output.id === job.currentOutput?.id)) {
      next.unshift(job.currentOutput);
    }
    return next;
  }, [job.currentOutput, outputs]);

  const currentOutput = outputsDesc[0] ?? null;
  const previousOutput = outputsDesc[1] ?? null;
  const displayedOutput = useMemo(
    () => outputsDesc.find((output) => output.id === selectedOutputId) || currentOutput,
    [currentOutput, outputsDesc, selectedOutputId],
  );
  const historyOutputs = useMemo(() => [...outputsDesc].reverse(), [outputsDesc]);
  const isViewingLatest = !selectedOutputId || displayedOutput?.id === currentOutput?.id;
  const activeReview = displayedOutput?.autoReview || (isViewingLatest ? job.latestAutoReview || currentOutput?.autoReview || null : null);
  const activeReviewPrompt =
    activeReview?.reviewPrompt
    || displayedOutput?.autoReview?.reviewPrompt
    || currentOutput?.autoReview?.reviewPrompt
    || job.latestAutoReview?.reviewPrompt
    || null;
  const marketplaceData = activeReview?.marketplaceData || EMPTY_MARKETPLACE_DATA;
  const hasMarketplaceData = Object.values(marketplaceData).some((value) => value !== null && value !== '');
  const failedCriteria = activeReview?.criteria.filter((criterion) => !criterion.passed) || [];

  const { url: displayedImageUrl } = useStorageAssetUrl(displayedOutput?.resultImagePath || null);
  const { url: currentImageUrl } = useStorageAssetUrl(currentOutput?.resultImagePath || null);
  const { url: previousImageUrl } = useStorageAssetUrl(previousOutput?.resultImagePath || null);

  useEffect(() => {
    setCompareMode(false);
    setMarketplaceExpanded(false);
    setSelectedOutputId(null);
  }, [job.id]);

  useEffect(() => {
    if (selectedOutputId && !outputsDesc.some((output) => output.id === selectedOutputId)) {
      setSelectedOutputId(null);
    }
  }, [outputsDesc, selectedOutputId]);

  const handleDownload = async () => {
    if (!job.currentOutput?.resultImagePath) return;
    setDownloading(true);
    try {
      await downloadSingleJobImage(batch, job, index);
    } catch (error) {
      console.error('Error downloading image:', error);
      toast({
        tone: 'error',
        title: 'No pudimos descargar la imagen',
        description: 'Revisa la conexión o inténtalo de nuevo desde esta tarjeta.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const hasOutput = !!displayedImageUrl;
  const hasPreviousOutput = !!previousOutput && !!previousImageUrl;
  const canCompare = hasPreviousOutput && isViewingLatest;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow flex flex-col ${
        focused
          ? 'border-indigo-400 ring-2 ring-indigo-100'
          : selected
            ? 'border-sky-300 ring-2 ring-sky-100'
            : 'border-gray-200 hover:shadow-md'
      }`}
      onClick={() => onFocusTraceability?.()}
      onFocusCapture={() => onFocusTraceability?.()}
    >
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <div className="flex items-start gap-3">
          {onToggleSelected ? (
            <label className="mt-0.5 inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelected}
                onClick={(event) => event.stopPropagation()}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                aria-label={`Seleccionar ${job.garmentName} pose ${index + 1}`}
              />
            </label>
          ) : null}
          <div>
            <p className="text-sm font-semibold text-gray-900">Pose {index + 1}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {job.modelNameSnapshot}
              {isExperimentJob ? ` · Brazo ${job.experimentArmLabel} (${job.provider})` : ''}
            </p>
            <p className="text-xs text-gray-500">
              {job.garmentName} · {PROVIDER_LABELS[job.provider]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onFocusTraceability ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFocusTraceability();
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                focused ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Abrir trazabilidad del job"
            >
              <History className="h-3.5 w-3.5" />
              Historial
            </button>
          ) : null}
          {canCompare ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCompareMode((current) => !current);
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                compareMode ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              title="Comparar resultado actual con el intento anterior"
            >
              {compareMode ? <Layers3 className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
              {compareMode ? 'Comparando' : 'Ver anterior'}
            </button>
          ) : null}
          <StatusBadge status={job.status} />
        </div>
      </div>

      <div className="relative flex-shrink-0 bg-gray-100">
        {compareMode && canCompare ? (
          <div className="grid grid-cols-2 gap-px bg-slate-200">
            <HoverZoomImage
              src={previousImageUrl!}
              alt={`Pose ${index + 1} anterior`}
              containerClassName="aspect-[3/4] bg-slate-100"
              imageClassName="bg-white object-contain"
              preserveNaturalAspectRatio
              zoomScale={2.1}
            >
              <span className="absolute left-3 top-3 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                Anterior
              </span>
            </HoverZoomImage>
            <HoverZoomImage
              src={currentImageUrl!}
              alt={`Pose ${index + 1} actual`}
              containerClassName="aspect-[3/4] bg-slate-100"
              imageClassName="bg-white object-contain"
              preserveNaturalAspectRatio
              zoomScale={2.1}
            >
              <span className="absolute left-3 top-3 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white">
                Actual
              </span>
            </HoverZoomImage>
          </div>
        ) : hasOutput ? (
          <HoverZoomImage
            src={displayedImageUrl!}
            alt={`Pose ${index + 1}`}
            containerClassName="aspect-[3/4]"
            imageClassName="bg-white object-contain"
            preserveNaturalAspectRatio
            zoomScale={1.95}
          >
            {!isViewingLatest ? (
              <span className="absolute left-3 top-3 rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-white">
                {formatOutputLabel(displayedOutput!, historyOutputs.findIndex((output) => output.id === displayedOutput?.id))}
              </span>
            ) : null}
          </HoverZoomImage>
        ) : (
          <div className="aspect-[3/4] w-full flex flex-col items-center justify-center text-gray-400 p-6 text-center">
            {job.status === 'failed' ? (
              <>
                <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-sm font-medium text-red-600">Error en la generación</p>
                {job.lastError && <p className="text-xs text-red-500 mt-1">{job.lastError}</p>}
              </>
            ) : (
              <p className="text-sm text-gray-400">Esperando resultado...</p>
            )}
          </div>
        )}

        {(isProcessing || isQueueing) && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
            <p className="font-medium text-gray-900">
              {isQueueing ? 'Encolando regeneración...' : 'Procesando imagen...'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Esta tarjeta se actualizará automáticamente cuando termine.
            </p>
            {currentOutput ? (
              <p className="text-xs text-indigo-600 font-medium mt-4 bg-indigo-50 px-3 py-1 rounded-full">
                Mostrando el último intento disponible
              </p>
            ) : null}
          </div>
        )}

        {hasOutput && !isProcessing && !isQueueing && isViewingLatest && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              void handleDownload();
            }}
            disabled={downloading}
            className="absolute bottom-3 right-3 cursor-pointer p-2 bg-white/90 hover:bg-white text-gray-700 rounded-xl shadow-sm backdrop-blur transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Descargar imagen actual"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="border-t border-slate-100 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Historial generado</p>
            <p className="mt-1 text-xs text-slate-500">
              {historyOutputs.length === 0
                ? 'Todavía no hay imágenes generadas para esta pose.'
                : `${historyOutputs.length} intento${historyOutputs.length === 1 ? '' : 's'} disponible${historyOutputs.length === 1 ? '' : 's'} en esta imagen.`}
            </p>
          </div>
          {historyOutputs.length > 0 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {formatOutputLabel(currentOutput!, historyOutputs.length - 1)}
            </span>
          ) : null}
        </div>

        {historyOutputs.length > 0 ? (
          <div
            className="mt-3 flex gap-2 overflow-x-auto pb-1"
            onClick={(event) => event.stopPropagation()}
          >
            {historyOutputs.map((output, outputIndex) => (
              <AttemptThumbnail
                key={output.id}
                output={output}
                label={formatOutputLabel(output, outputIndex)}
                selected={selectedOutputId ? output.id === selectedOutputId : output.id === currentOutput?.id}
                onSelect={() => {
                  setCompareMode(false);
                  setSelectedOutputId(output.id === currentOutput?.id ? null : output.id);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="p-4 flex flex-col flex-grow space-y-3">
        {displayedOutput ? (
          <div className={`rounded-xl border px-3 py-3 text-xs ${reviewTone(activeReview)}`}>
            <div className="flex items-start gap-2">
              {activeReview?.verdict === 'approved' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : activeReview ? (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-semibold">{reviewTitle(activeReview)}</p>
                <p className="mt-1 leading-relaxed">
                  {activeReview?.summary || 'Esta salida todavía no tiene un veredicto automático asociado.'}
                </p>
                {activeReview?.model ? (
                  <p className="mt-1 text-[11px] uppercase tracking-[0.12em] opacity-80">
                    {activeReview.model}
                  </p>
                ) : null}
              </div>
            </div>

            {failedCriteria.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {failedCriteria.map((criterion) => (
                  <span key={`${displayedOutput.id}-${criterion.key}`} className="rounded-full bg-white/70 px-2.5 py-1">
                    {criterion.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeReview ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMarketplaceExpanded((current) => !current);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
              aria-expanded={marketplaceExpanded}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Ficha marketplace</p>
                <p className="mt-1 text-xs text-slate-600">
                  {hasMarketplaceData
                    ? 'Titulo, descripcion y atributos comerciales extraidos por Gemini.'
                    : 'Esta revision no trae datos comerciales guardados todavia.'}
                </p>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                {marketplaceExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            </button>

            {marketplaceExpanded ? (
              <div className="border-t border-slate-200 px-3 py-3 text-xs text-slate-700">
                {!hasMarketplaceData ? (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    Este intento no incluye `marketplaceData`. Suele pasar con imagenes evaluadas antes de este cambio o si Gemini no devolvio esos campos.
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <MarketplaceField label="Titulo" value={marketplaceFieldValue(marketplaceData.title)} />
                  <MarketplaceField label="Marca" value={marketplaceFieldValue(marketplaceData.brand)} />
                  <MarketplaceField label="Genero" value={marketplaceFieldValue(marketplaceData.gender)} />
                  <MarketplaceField label="Tipo de prenda" value={marketplaceFieldValue(marketplaceData.garmentType)} />
                  <MarketplaceField label="Color principal" value={marketplaceFieldValue(marketplaceData.primaryColor)} />
                  <MarketplaceField label="Deporte / uso" value={marketplaceFieldValue(marketplaceData.sport)} />
                  <MarketplaceField
                    label="Es deportiva"
                    value={
                      marketplaceData.isSportswear === null
                        ? 'Sin dato'
                        : marketplaceData.isSportswear
                          ? 'Si'
                          : 'No'
                    }
                  />
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Descripcion</p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-700">
                    {marketplaceFieldValue(marketplaceData.description)}
                  </p>
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Prompt enviado a Gemini
                  </p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-3 text-[11px] leading-relaxed text-slate-700">
                    {activeReviewPrompt || 'Sin prompt guardado en esta revision.'}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Proveedor IA</label>
          <select
            value={draft.provider}
            onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
            onClick={(event) => event.stopPropagation()}
            disabled={isProcessing || isQueueing || !role.canRegenerate || isExperimentJob}
            className={INPUT_BASE}
          >
            <option value="fal-seedream">{PROVIDER_LABELS['fal-seedream']}</option>
            <option value="fal-banana-pro">{PROVIDER_LABELS['fal-banana-pro']}</option>
            <option value="openai-gpt-image-1.5">{PROVIDER_LABELS['openai-gpt-image-1.5']}</option>
          </select>
        </div>

        <div className="flex-grow flex flex-col">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Prompt</label>
          <textarea
            value={draft.prompt}
            onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
            onClick={(event) => event.stopPropagation()}
            disabled={isProcessing || isQueueing || !role.canRegenerate || isExperimentJob}
            rows={4}
            className={`${INPUT_BASE} resize-none flex-grow`}
            placeholder="Define el prompt base para regenerar..."
          />
          {isExperimentJob ? (
            <p className="mt-1.5 text-xs text-amber-700">
              El proveedor y el prompt quedan bloqueados para conservar la validez del experimento A/B.
            </p>
          ) : null}
        </div>

        {job.status === 'failed' && job.lastError && currentOutput ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" aria-hidden="true" />
            <div><span className="font-medium">Detalle del fallo: </span>{job.lastError}</div>
          </div>
        ) : null}

        {regenerationError ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
            <span>{regenerationError}</span>
          </div>
        ) : null}

        {historyOutputs.length > 1 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Esta pose conserva el historial completo de intentos generados. Puedes abrir cualquier miniatura para revisar qué cambió.
          </div>
        ) : null}

        {role.canRegenerate ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRegenerate();
            }}
            disabled={isProcessing || isQueueing || !draft.prompt.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-transparent text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isQueueing ? 'animate-spin' : ''}`} />
            Regenerar foto
          </button>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            Tu rol puede revisar y descargar resultados, pero no encolar regeneraciones.
          </div>
        )}
      </div>
    </div>
  );
};

const MarketplaceField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
    <p className="mt-1 text-slate-700">{value}</p>
  </div>
);

const AttemptThumbnail: React.FC<{
  output: JobOutput;
  label: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ output, label, selected, onSelect }) => {
  const { url } = useStorageAssetUrl(output.resultImagePath || null);
  const verdict = output.autoReview?.verdict || null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group shrink-0 rounded-2xl border p-1.5 text-left transition ${
        selected
          ? 'border-indigo-300 bg-indigo-50 shadow-sm'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
      }`}
      title={label}
    >
      <div className="relative h-20 w-16 overflow-hidden rounded-xl bg-slate-100">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
        {output.isCurrent ? (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Actual
          </span>
        ) : null}
      </div>
      <div className="mt-2 space-y-1 px-0.5">
        <p className="text-[11px] font-semibold text-slate-700">{label}</p>
        <p
          className={`text-[11px] ${
            verdict === 'approved'
              ? 'text-emerald-700'
              : verdict === 'rejected'
                ? 'text-amber-700'
                : 'text-slate-500'
          }`}
        >
          {verdict === 'approved' ? 'Aprobada' : verdict === 'rejected' ? 'Rechazada' : 'Sin veredicto'}
        </p>
      </div>
    </button>
  );
};
