import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Columns3, X } from 'lucide-react';
import { Button } from '../ui';
import { useAuth, useRole } from '../../features/auth/AuthProvider';
import { useJobReviewReferences } from '../../features/evaluation/useJobReview';
import { useStorageAssetUrl } from '../../features/storage/useStorageAssetUrl';
import { humanClientIds } from '../../../shared/src/clientAccess';
import { getApprovedReviewOutput, jobReviewReferenceAsset } from '../../../shared/src/jobReview';
import type { Job, JobOutput, JobReviewCorrection } from '../../../shared/src/types';
import { JobRejectionPanel } from './JobRejectionPanel';

interface Props {
  job: Job;
  outputs: JobOutput[];
  displayedOutput?: JobOutput | null;
  historyLoading?: boolean;
  historyError?: boolean;
  regenerationDisabled: boolean;
  regenerationError?: string | null;
  onRegenerate: (correction: JobReviewCorrection) => Promise<boolean>;
}

const labelOutput = (output: JobOutput, outputs: JobOutput[]) =>
  output.generationAttempt
    ? `Intento ${output.generationAttempt} · Resultado ${Math.max(1, outputs.length - outputs.findIndex(item => item.id === output.id))}`
    : `Resultado ${Math.max(1, outputs.length - outputs.findIndex(item => item.id === output.id))}`;

export function JobPhotoReview(props: Props) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const { appUser } = useAuth();
  const role = useRole();
  const clients = appUser ? humanClientIds(appUser) : [];
  if (!props.job.id || !role.canEvaluate || (clients && !clients.includes(props.job.clientId))) return null;

  return (
    <div onClick={event => event.stopPropagation()}>
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" id={triggerId} onClick={() => setOpen(true)}>
        <Columns3 className="h-4 w-4" aria-hidden="true" /> Comparar y revisar fotos
      </Button>
      {open ? <ReviewDialog key={props.job.id} {...props} jobId={props.job.id} canRegenerate={role.canRegenerate} onClose={() => {
        setOpen(false);
        document.getElementById(triggerId)?.focus();
      }} /> : null}
    </div>
  );
}

function ReviewDialog({
  job, jobId, outputs, displayedOutput, historyLoading, historyError, regenerationDisabled, regenerationError, onRegenerate, canRegenerate, onClose,
}: Props & { jobId: string; canRegenerate: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { paths, error: referenceListError } = useJobReviewReferences(job);
  const [referencePath, setReferencePath] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(displayedOutput?.id ?? null);
  const [reviewedId, setReviewedId] = useState<string | null>(displayedOutput?.id ?? null);
  const [synced, setSynced] = useState(true);
  const [sharedZoom, setSharedZoom] = useState(100);
  const close = () => {
    ref.current?.close();
    onClose();
  };

  useEffect(() => {
    const modal = ref.current;
    modal?.showModal();
    return () => { if (modal?.open) modal.close(); };
  }, []);

  const current = outputs.find(output => output.id === job.currentOutput?.id) || job.currentOutput || outputs[0] || null;
  const approved = getApprovedReviewOutput(job);
  const previousOutputs = outputs.filter(output => output.id !== current?.id);
  const previous = previousOutputs.find(output => output.id === previousId)
    || previousOutputs.find(output => output.id === reviewedId)
    || previousOutputs.find(output => output.id === approved?.id) || previousOutputs[0] || null;
  const reviewed = reviewedId ? outputs.find(output => output.id === reviewedId) : current;
  const selectedRef = paths.find(path => path === referencePath) || paths[0];
  const approvedOutsidePanels = approved && approved.id !== current?.id && approved.id !== previous?.id;
  const changePrevious = (id: string) => {
    if (reviewedId === previous?.id) setReviewedId(id);
    setPreviousId(id);
  };

  const resultPane = (output: JobOutput, title: string) => (
    <ReviewImage
      key={output.id}
      title={`${title} · ${labelOutput(output, outputs)}`}
      path={output.storageDeletedAt ? null : output.resultImagePath}
      unavailable={output.storageDeletedAt ? 'Esta imagen ya no está disponible.' : 'Este resultado no tiene imagen.'}
      badge={approved?.id === output.id ? (job.userSelectedOutput?.id === output.id ? 'Aprobado manualmente' : 'Aprobado automáticamente') : undefined}
      zoom={synced ? sharedZoom : undefined}
    />
  );

  return (
    <dialog ref={ref} data-job-photo-review aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => event.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[94dvh] w-[calc(100%-1rem)] max-w-6xl overflow-y-auto overscroll-contain rounded-2xl bg-slate-50 p-0 text-slate-900 shadow-2xl backdrop:bg-black/75 sm:w-[calc(100%-3rem)]">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold">Comparar y revisar fotos</h2>
          <p className="truncate text-sm text-slate-600">{job.garmentName}</p>
        </div>
        <Button type="button" autoFocus variant="secondary" size="sm" aria-label="Cerrar comparación" onClick={close}>
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          {paths.length > 1 ? (
            <label className="min-w-0 max-w-full flex-1">
              Foto de referencia
              <select className="tuto-field mt-1 block w-full" value={selectedRef} onChange={event => setReferencePath(event.target.value)}>
                {paths.map((path, i) => <option key={path} value={path}>Referencia {i + 1}</option>)}
              </select>
            </label>
          ) : null}
          {previousOutputs.length > 0 ? (
            <label className="min-w-0 max-w-full flex-1">
              Intento anterior
              <select className="tuto-field mt-1 block w-full" value={previous?.id} onChange={event => changePrevious(event.target.value)}>
                {previousOutputs.map(output => <option key={output.id} value={output.id}>
                  {labelOutput(output, outputs)}{approved?.id === output.id ? ' · Aprobado' : ''}
                </option>)}
              </select>
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={synced} onChange={event => setSynced(event.target.checked)} /> Sincronizar zoom
          </label>
          {synced ? <ZoomControl label="Zoom de todas las imágenes" value={sharedZoom} onChange={setSharedZoom} /> : null}
        </div>
        <p className="text-xs text-slate-600">
          Con zoom, desplaza cada imagen de forma independiente arrastrándola o usando las flechas cuando tenga el foco.
          <span className="sm:hidden"> Desliza entre fotos fuera de la imagen ampliada.</span>
        </p>
        {referenceListError ? <p role="alert" className="text-sm text-red-700">No pudimos buscar otras referencias de este artículo.</p> : null}
        {historyError ? <p role="alert" className="text-sm text-red-700">No pudimos cargar todos los intentos anteriores.</p> : null}
        {!previous && !historyError ? <p role="status" className="text-sm text-slate-600">{historyLoading ? 'Cargando intentos…' : 'No hay intentos anteriores.'}</p> : null}
        {approvedOutsidePanels ? <p className="text-sm text-emerald-800">Aprobado: {labelOutput(approved, outputs)}. Puedes verlo en el selector de intentos anteriores.</p> : null}
        <div tabIndex={0} role="region" aria-label="Fotos de la comparación" className="grid snap-x snap-mandatory auto-cols-[86%] grid-flow-col gap-3 overflow-x-auto pb-2 sm:auto-cols-fr">
          <ReviewImage key={selectedRef || 'no-ref'} title={`Referencia original${paths.length > 1 ? ` ${paths.indexOf(selectedRef) + 1}` : ''}`}
            path={selectedRef ? jobReviewReferenceAsset(jobId, selectedRef) : null}
            unavailable="No hay una foto de referencia disponible." zoom={synced ? sharedZoom : undefined} />
          {current ? resultPane(current, 'Resultado actual') : (
            <ReviewImage title="Resultado actual" path={null} unavailable="Todavía no hay un resultado." />
          )}
          {previous ? resultPane(previous, 'Intento anterior') : null}
        </div>
        {current ? (
          <>
            {previous ? (
              <label className="block text-sm font-medium">
                Resultado que quieres revisar
                <select className="tuto-field mt-1 block w-full sm:w-auto" value={reviewed?.id ?? current.id}
                  onChange={event => setReviewedId(event.target.value)}>
                  <option value={current.id}>Resultado actual · {labelOutput(current, outputs)}</option>
                  <option value={previous.id}>Intento anterior · {labelOutput(previous, outputs)}</option>
                </select>
              </label>
            ) : null}
            {reviewed?.resultImagePath && !reviewed.storageDeletedAt ? (
              <JobRejectionPanel key={reviewed.id} jobId={jobId} outputId={reviewed.id} outputLabel={labelOutput(reviewed, outputs)}
                canWrite canRegenerate={canRegenerate} regenerationDisabled={regenerationDisabled}
                regenerationError={regenerationError} onRegenerate={onRegenerate} />
            ) : <p className="text-sm text-slate-600">El resultado seleccionado no tiene una imagen disponible para revisar.</p>}
          </>
        ) : null}
      </div>
    </dialog>
  );
}

function ZoomControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex max-w-full flex-wrap items-center gap-2 text-sm">
      <span>{label}</span>
      <input type="range" min={100} max={300} step={25} value={value} onChange={event => onChange(Number(event.target.value))} />
      <span aria-hidden="true" className="tabular-nums">{value}%</span>
    </label>
  );
}

function ReviewImage({ title, path, unavailable, badge, zoom }: {
  title: string; path: string | null; unavailable: string; badge?: string; zoom?: number;
}) {
  const [localZoom, setLocalZoom] = useState(100);
  const [attempt, setAttempt] = useState(0);
  const [decodeError, setDecodeError] = useState(false);
  const { url, loading } = useStorageAssetUrl(path, attempt);
  const frame = useRef<HTMLDivElement>(null);
  const lastZoom = useRef(100);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scale = zoom ?? localZoom;
  const canPan = Boolean(url && !loading && !decodeError && scale > 100);

  useLayoutEffect(() => {
    const el = frame.current;
    if (el && url && !loading && !decodeError) {
      const ratio = scale / lastZoom.current;
      el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    }
    lastZoom.current = scale;
  }, [scale, url, loading, decodeError]);

  return (
    <figure className="flex min-w-0 snap-start flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <figcaption className="min-h-14 px-3 py-2 text-sm font-semibold">
        {title}
        {badge ? <span className="block text-xs text-emerald-700">{badge}</span> : null}
      </figcaption>
      <div ref={frame} role={canPan ? 'region' : undefined} aria-label={canPan ? `Desplazar: ${title}` : undefined}
        tabIndex={canPan ? 0 : undefined} className={`h-[min(52dvh,30rem)] bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 ${canPan ? 'cursor-grab overflow-auto active:cursor-grabbing' : 'overflow-hidden'}`}
        onKeyDown={event => {
          if (!canPan || event.target !== event.currentTarget) return;
          const offsets: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
          if (!offsets[event.key]) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.scrollBy(...offsets[event.key]);
        }}
        onPointerDown={event => {
          if (!canPan || event.pointerType !== 'mouse' || event.button !== 0 || !(event.target instanceof HTMLImageElement)) return;
          event.currentTarget.focus({ preventScroll: true });
          drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          event.currentTarget.scrollTo(drag.current.left + drag.current.x - event.clientX, drag.current.top + drag.current.y - event.clientY);
        }}
        onLostPointerCapture={() => { drag.current = null; }}>
        {url && !loading && !decodeError ? (
          <img key={url} src={url} alt={title} draggable={false} onError={() => setDecodeError(true)}
            className="block max-w-none select-none object-contain" style={{ width: `${scale}%`, height: `${scale}%` }} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-600">
            <p role="status">{!path ? unavailable : loading ? 'Cargando imagen…' : 'No pudimos cargar esta imagen.'}</p>
            {path && !loading ? <Button type="button" variant="secondary" size="sm" onClick={() => { setDecodeError(false); setAttempt(n => n + 1); }}>Reintentar</Button> : null}
          </div>
        )}
      </div>
      {zoom === undefined && url && !decodeError ? <div className="p-2"><ZoomControl label={`Zoom: ${title}`} value={localZoom} onChange={setLocalZoom} /></div> : null}
    </figure>
  );
}
