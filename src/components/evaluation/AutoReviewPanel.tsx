import React, { useState } from 'react';
import { JobAutoReview, JobAutoReviewMarketplaceData, JobOutput } from '../../../shared/src/types';
import { CheckCircle2, ChevronDown, ChevronUp, ImageIcon, Sparkles } from 'lucide-react';

interface Props {
  displayedOutput: JobOutput | null;
  activeReview: JobAutoReview | null;
  activeReviewPrompt: string | null;
  isUserApprovedDisplayed: boolean;
}

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

const reviewTone = (review: JobAutoReview | null, userApproved: boolean): string => {
  if (userApproved) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (!review) return 'border-slate-200 bg-slate-50 text-slate-600';
  return review.verdict === 'approved'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
};

const reviewTitle = (review: JobAutoReview | null, userApproved: boolean): string => {
  if (userApproved) return 'Aprobada por usuario';
  if (!review) return 'Sin revisión automática registrada';
  return review.verdict === 'approved' ? 'Aprobada por Gemini' : 'Gemini pidió otro intento';
};

const marketplaceFieldValue = (value: string | null | undefined): string => value?.trim() || 'Sin dato';

export const AutoReviewPanel: React.FC<Props> = ({
  displayedOutput,
  activeReview,
  activeReviewPrompt,
  isUserApprovedDisplayed,
}) => {
  const [marketplaceExpanded, setMarketplaceExpanded] = useState(false);

  if (!displayedOutput && !activeReview) return null;

  const marketplaceData = activeReview?.marketplaceData || EMPTY_MARKETPLACE_DATA;
  const hasMarketplaceData = Object.values(marketplaceData).some((value) => value !== null && value !== '');
  const failedCriteria = activeReview?.criteria.filter((criterion) => !criterion.passed) || [];

  return (
    <>
      {displayedOutput ? (
        <div className={`rounded-xl border px-3 py-3 text-xs ${reviewTone(activeReview, isUserApprovedDisplayed)}`}>
          <div className="flex items-start gap-2">
            {isUserApprovedDisplayed ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : activeReview?.verdict === 'approved' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : activeReview ? (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">{reviewTitle(activeReview, isUserApprovedDisplayed)}</p>
              <p className="mt-1 leading-relaxed">
                {isUserApprovedDisplayed
                  ? 'Esta salida fue marcada manualmente como la aprobada. Guardar y descargar usarán esta imagen.'
                  : activeReview?.summary || 'Esta salida todavía no tiene un veredicto automático asociado.'}
              </p>
              {isUserApprovedDisplayed && activeReview ? (
                <p className="mt-1 text-[11px] uppercase tracking-[0.12em] opacity-80">
                  Veredicto Gemini original: {activeReview.verdict === 'approved' ? 'Aprobada' : 'Rechazada'}
                </p>
              ) : activeReview?.model ? (
                <p className="mt-1 text-[11px] uppercase tracking-[0.12em] opacity-80">{activeReview.model}</p>
              ) : null}
            </div>
          </div>

          {failedCriteria.length > 0 && !isUserApprovedDisplayed ? (
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
                  Este intento no incluye `marketplaceData`. Suele pasar con imagenes evaluadas antes de este cambio o si
                  Gemini no devolvio esos campos.
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
                    marketplaceData.isSportswear === null ? 'Sin dato' : marketplaceData.isSportswear ? 'Si' : 'No'
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
    </>
  );
};

const MarketplaceField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
    <p className="mt-1 text-slate-700">{value}</p>
  </div>
);
