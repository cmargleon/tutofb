import { ReactNode, useEffect, useState } from 'react';
import { RefreshCw, Wand2 } from 'lucide-react';
import { Job, JobOutput, MAX_PHOTO_EDIT_INSTRUCTIONS, Provider } from '../../../shared/src/types';
import { DEFAULT_IMAGE_PROVIDER, PROVIDER_LABELS, PROVIDER_VALUES } from '../../../shared/src/domain';
import { usePhotoEdit } from '../../features/catalog/usePhotoEdit';
import { ReviewPromptProposal } from '../evaluation/ReviewPromptProposal';

type PhotoActionMode = 'edit' | 'regenerate';

export const PHOTO_EDIT_SUGGESTIONS = [
  'Cambia el fondo por una pared blanca lisa',
  'Haz la iluminación más cálida',
  'Quita los objetos que distraen del fondo',
  'Encuadra más cerca del producto',
];

const sectionLabel = 'block text-xs font-medium uppercase tracking-[0.18em] text-slate-400';

interface CatalogPhotoActionsProps {
  job: Job & { id: string };
  /** Output shown in the lightbox; it is the starting point for an edit. */
  sourceOutput: JobOutput | null;
  sourceLabel: string | null;
  draft: { provider: Provider; prompt: string };
  onDraftChange: (patch: Partial<{ provider: Provider; prompt: string }>) => void;
  disabledProviders?: string[];
  controlsDisabled: boolean;
  isRegenerationActive: boolean;
  regenerationError: string | null;
  canRegenerate: boolean;
  onRegenerate: () => void;
  onEditQueued: () => void;
}

const ProviderSelect = ({ value, onChange, disabled, disabledProviders }: {
  value: Provider; onChange: (provider: Provider) => void; disabled: boolean; disabledProviders?: string[];
}) => (
  <label className="block space-y-1.5">
    <span className={sectionLabel}>Modelo IA</span>
    <select value={value} onChange={(e) => onChange(e.target.value as Provider)} disabled={disabled} className="tuto-field w-full">
      {PROVIDER_VALUES.map((provider) => (
        <option key={provider} value={provider} disabled={disabledProviders?.includes(provider)}>
          {PROVIDER_LABELS[provider]}{disabledProviders?.includes(provider) ? ' (deshabilitado)' : ''}
        </option>
      ))}
    </select>
  </label>
);

const DisabledProviderNotice = ({ action }: { action: string }) => (
  <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
    Este modelo IA está deshabilitado en Configuración. Elige otro para {action}.
  </p>
);

const ModeTab = ({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: ReactNode; label: string;
}) => (
  <button type="button" role="tab" aria-selected={active} onClick={onClick}
    className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
      active ? 'bg-white text-slate-950 shadow' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
    {icon}{label}
  </button>
);

export const CatalogPhotoActions = ({
  job, sourceOutput, sourceLabel, draft, onDraftChange, disabledProviders, controlsDisabled,
  isRegenerationActive, regenerationError, canRegenerate, onRegenerate, onEditQueued,
}: CatalogPhotoActionsProps) => {
  const canEditSource = Boolean(sourceOutput?.resultImagePath && !sourceOutput.storageDeletedAt);
  const [mode, setMode] = useState<PhotoActionMode>(canEditSource ? 'edit' : 'regenerate');
  const [editProvider, setEditProvider] = useState<Provider>(() => (
    disabledProviders?.includes(DEFAULT_IMAGE_PROVIDER)
      ? PROVIDER_VALUES.find((provider) => !disabledProviders.includes(provider)) || DEFAULT_IMAGE_PROVIDER
      : DEFAULT_IMAGE_PROVIDER
  ));
  const { instructions, setInstructions, submitting, submit } = usePhotoEdit(job.id, sourceOutput?.id || '', () => {
    setInstructions('');
    onEditQueued();
  }, editProvider);

  useEffect(() => {
    if (!canEditSource) setMode('regenerate');
  }, [canEditSource]);

  const selectedProviderDisabled = Boolean(disabledProviders?.includes(draft.provider));
  const editProviderDisabled = Boolean(disabledProviders?.includes(editProvider));
  const editDisabled = controlsDisabled || !canEditSource || submitting;

  return (
    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
      <div role="tablist" aria-label="Qué quieres hacer con esta foto" className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
        <ModeTab active={mode === 'edit'} onClick={() => setMode('edit')} icon={<Wand2 className="h-4 w-4" />} label="Ajustar esta foto" />
        <ModeTab active={mode === 'regenerate'} onClick={() => setMode('regenerate')} icon={<RefreshCw className="h-4 w-4" />} label="Crear otra versión" />
      </div>

      {mode === 'edit' ? (
        <form role="tabpanel" aria-label="Ajustar esta foto" className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p className="text-sm leading-6 text-slate-300">
            Partimos de <span className="font-semibold text-white">{sourceLabel || 'la foto que estás viendo'}</span> y
            cambiamos solo lo que indiques. Se conservan la modelo, el producto y el encuadre.
          </p>
          {!canEditSource ? (
            <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
              Esta versión no tiene imagen para ajustar. Elige otra en el historial o crea otra versión.
            </p>
          ) : null}
          <label className="block space-y-1.5">
            <span className={sectionLabel}>¿Qué quieres cambiar?</span>
            <textarea required maxLength={MAX_PHOTO_EDIT_INSTRUCTIONS} rows={4} value={instructions}
              onChange={(event) => setInstructions(event.target.value)} disabled={editDisabled}
              className="tuto-field w-full resize-none"
              placeholder="Ej.: cambia el fondo por una pared blanca, quita el bolso o ajusta la iluminación para que sea más cálida." />
          </label>
          <div className="flex flex-wrap gap-2" aria-label="Sugerencias de cambio">
            {PHOTO_EDIT_SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" disabled={editDisabled}
                onClick={() => setInstructions(instructions.trim() ? `${instructions.trim()}\n${suggestion}` : suggestion)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-40">
                {suggestion}
              </button>
            ))}
          </div>
          <ProviderSelect value={editProvider} onChange={setEditProvider}
            disabled={editDisabled} disabledProviders={disabledProviders} />
          {editProviderDisabled ? <DisabledProviderNotice action="ajustar la foto" /> : null}
          <button type="submit" disabled={editDisabled || editProviderDisabled || !instructions.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            <Wand2 className="h-4 w-4" />
            {submitting ? 'Encolando…' : 'Aplicar cambio'}
          </button>
        </form>
      ) : (
        <div role="tabpanel" aria-label="Crear otra versión" className="space-y-3">
          <p className="text-sm leading-6 text-slate-300">
            Generamos una foto nueva desde cero con la pose y el producto originales. El resultado puede cambiar
            por completo; la foto actual se mantiene en el historial.
          </p>
          {job.promptFormat === 'approved-try-on-v1' ? (
            <ReviewPromptProposal text={(sourceOutput?.autoReview || job.latestAutoReview)?.revisedPrompt}
              disabled={controlsDisabled} onEdit={(prompt) => onDraftChange({ provider: draft.provider, prompt })} />
          ) : null}
          <label className="block space-y-1.5">
            <span className={sectionLabel}>Prompt</span>
            <textarea value={draft.prompt} onChange={(e) => onDraftChange({ prompt: e.target.value })}
              disabled={controlsDisabled} rows={8}
              className="tuto-field w-full resize-y" placeholder="Prompt para regenerar esta foto..." />
          </label>
          <ProviderSelect value={draft.provider} onChange={(provider) => onDraftChange({ provider })}
            disabled={controlsDisabled} disabledProviders={disabledProviders} />
          {selectedProviderDisabled ? <DisabledProviderNotice action="crear otra versión" /> : null}
          <button type="button" onClick={onRegenerate}
            disabled={controlsDisabled || selectedProviderDisabled || !draft.prompt.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            <RefreshCw className={`h-4 w-4 ${isRegenerationActive ? 'animate-spin' : ''}`} />
            Generar nueva versión
          </button>
        </div>
      )}

      {regenerationError ? (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">{regenerationError}</p>
      ) : null}
      {!canRegenerate ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
          Solo admin y operador pueden ajustar o crear versiones desde catálogo.
        </p>
      ) : null}
    </div>
  );
};
