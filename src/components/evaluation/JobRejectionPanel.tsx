import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { recordJobRejection } from '../../features/evaluation/firebase';
import { useJobRejections } from '../../features/evaluation/useJobReview';
import { buildReviewCorrection, JOB_REJECTION_OPTIONS } from '../../../shared/src/jobReview';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import {
  JOB_REJECTION_REASONS, MAX_JOB_REVIEW_CORRECTION, MAX_JOB_REVIEW_NOTE,
  type JobRejectionReason, type JobReviewCorrection,
} from '../../../shared/src/types';

interface Props {
  jobId: string;
  outputId: string;
  outputLabel: string;
  canWrite: boolean;
  canRegenerate: boolean;
  regenerationDisabled: boolean;
  regenerationError?: string | null;
  onRegenerate: (correction: JobReviewCorrection) => Promise<boolean>;
}

export function JobRejectionPanel({
  jobId, outputId, outputLabel, canWrite, canRegenerate, regenerationDisabled, regenerationError, onRegenerate,
}: Props) {
  const titleId = useId();
  const toast = useToast();
  const [reasons, setReasons] = useState<JobRejectionReason[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [proposal, setProposal] = useState<JobReviewCorrection | null>(null);
  const correctionInput = useRef<HTMLTextAreaElement>(null);
  const proposalId = proposal?.feedbackId;
  useEffect(() => {
    if (proposalId) correctionInput.current?.focus();
  }, [proposalId]);
  const { entries, loading, error } = useJobRejections(jobId, outputId);
  const sortedEntries = [...entries].sort((a, b) => toMillisOrZero(b.createdAt) - toMillisOrZero(a.createdAt));

  const saveFeedback = async (prepare: boolean) => {
    if (!canWrite || !reasons.length || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { feedbackId } = await recordJobRejection({ jobId, outputId, reasons, note });
      toast({ tone: 'success', title: 'Motivos de rechazo guardados' });
      setReasons([]);
      setNote('');
      if (prepare) {
        setQueueError(false);
        setProposal({ feedbackId, text: buildReviewCorrection(reasons, note) });
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const submitCorrection = async () => {
    if (!proposal?.text.trim() || regenerationDisabled || queuing) return;
    setQueuing(true);
    setQueued(false);
    setQueueError(false);
    try {
      if (await onRegenerate(proposal)) {
        setProposal(null);
        setQueued(true);
      } else {
        setQueueError(true);
      }
    } catch {
      setQueueError(true);
    } finally {
      setQueuing(false);
    }
  };

  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 id={titleId} className="font-semibold">Revisión humana · {outputLabel}</h3>
      <p className="text-sm text-slate-600">Los motivos se guardan en este resultado, sin cambiar la foto aprobada ni iniciar una generación.</p>
      {canWrite ? (
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void saveFeedback(false); }}>
          <fieldset disabled={saving} className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Motivos de rechazo</legend>
            {JOB_REJECTION_REASONS.map(reason => (
              <label key={reason} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={reasons.includes(reason)}
                  onChange={event => setReasons(previous => event.target.checked ? [...previous, reason] : previous.filter(item => item !== reason))} />
                {JOB_REJECTION_OPTIONS[reason].label}
              </label>
            ))}
            <label className="text-sm sm:col-span-2">
              Nota opcional
              <textarea className="tuto-field mt-1 w-full" rows={2} value={note} maxLength={MAX_JOB_REVIEW_NOTE}
                onChange={event => setNote(event.target.value)} />
            </label>
          </fieldset>
          {saveError ? <p role="alert" className="text-sm text-red-700">No pudimos guardar el rechazo. {saveError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!reasons.length || saving}>{saving ? 'Guardando…' : 'Guardar motivos'}</Button>
            {canRegenerate ? <Button type="button" variant="secondary" disabled={!reasons.length || saving || Boolean(proposal)}
              onClick={() => void saveFeedback(true)}>Guardar y preparar corrección</Button> : null}
          </div>
        </form>
      ) : null}

      {proposal && canRegenerate ? (
        <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <label className="block text-sm font-semibold">
            Corrección del siguiente intento
            <textarea ref={correctionInput} className="tuto-field mt-1 w-full" rows={5} value={proposal.text} maxLength={MAX_JOB_REVIEW_CORRECTION}
              disabled={queuing} onChange={event => setProposal({ ...proposal, text: event.target.value })} />
          </label>
          <p className="text-sm text-slate-600">Se añadirá a las instrucciones actuales. La regeneración usa el proveedor y la configuración vigentes, y tiene coste.</p>
          {queueError ? <p role="alert" className="text-sm text-red-700">{regenerationError || 'No pudimos encolar la regeneración. Inténtalo de nuevo.'}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={regenerationDisabled || queuing || !proposal.text.trim()} onClick={() => void submitCorrection()}>
              {queuing ? 'Encolando…' : 'Regenerar con esta corrección'}
            </Button>
            <Button type="button" variant="secondary" disabled={queuing} onClick={() => setProposal(null)}>Cerrar propuesta</Button>
          </div>
        </div>
      ) : null}

      {queued ? <p role="status" className="text-sm text-emerald-800">Regeneración encolada con la corrección revisada.</p> : null}
      {loading ? <p role="status" className="text-sm text-slate-500">Cargando rechazos…</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">No pudimos cargar el historial de rechazos.</p> : null}
      {sortedEntries.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Rechazos registrados ({sortedEntries.length})</summary>
          <ul className="mt-2 space-y-2">
            {sortedEntries.map(({ id, humanFeedback: feedback, createdAt }) => feedback && (
              <li key={id} className="space-y-1 rounded-lg bg-slate-50 p-2">
                <p className="font-medium">{feedback.reasons.map(reason => JOB_REJECTION_OPTIONS[reason]?.label || reason).join(' · ')}</p>
                {feedback.note ? <p className="whitespace-pre-wrap break-words">{feedback.note}</p> : null}
                <p className="break-words text-xs text-slate-600">
                  {feedback.authorDisplayName || feedback.authorUid}
                  {toMillisOrZero(createdAt) ? ` · ${new Date(toMillisOrZero(createdAt)).toLocaleString('es')}` : ''}
                </p>
                {canRegenerate && id ? <button type="button" className="text-indigo-700 underline disabled:opacity-50"
                  disabled={Boolean(proposal)} onClick={() => { setQueueError(false); setProposal({ feedbackId: id, text: buildReviewCorrection(feedback.reasons, feedback.note) }); }}>
                  Preparar corrección con estos motivos
                </button> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : (!loading && !error ? <p className="text-sm text-slate-500">Este resultado aún no tiene motivos registrados.</p> : null)}
    </section>
  );
}
