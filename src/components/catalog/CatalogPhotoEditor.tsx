import { useEffect, useRef } from 'react';
import { JobOutput, MAX_PHOTO_EDIT_INSTRUCTIONS } from '../../../shared/src/types';
import { usePhotoEdit } from '../../features/catalog/usePhotoEdit';
import { Button, Field, ImageThumb } from '../ui';

export const CatalogPhotoEditor = ({ jobId, source, onClose, onQueued }: {
  jobId: string; source: JobOutput; onClose: () => void; onQueued: () => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { instructions, setInstructions, submitting, submit } = usePhotoEdit(jobId, source.id, onQueued);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  return <dialog ref={dialogRef} aria-label="Ajustar esta foto" onClose={onClose}
    onClick={event => event.stopPropagation()}
    onCancel={event => { if (submitting) event.preventDefault(); }}
    onKeyDown={event => event.stopPropagation()}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[min(95vw,36rem)] overflow-auto rounded-2xl bg-slate-950 p-6 text-white backdrop:bg-black/75">
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
      <h2 className="text-lg font-semibold">Ajustar esta foto</h2>
      <div className="h-64"><ImageThumb storagePath={source.resultImagePath} alt="Foto de partida para la edición" fit="contain" /></div>
      <Field label="¿Qué quieres cambiar?" hint="Partimos de esta foto y cambiamos solo lo que indiques. Se conservan la modelo, el producto y el encuadre.">
        <textarea autoFocus required maxLength={MAX_PHOTO_EDIT_INSTRUCTIONS} rows={4}
          value={instructions} onChange={event => setInstructions(event.target.value)} disabled={submitting}
          className="tuto-field w-full"
          placeholder="Ej.: cambia el fondo por una pared blanca, quita el bolso o ajusta la iluminación para que sea más cálida." />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={submitting || !instructions.trim()}>{submitting ? 'Encolando…' : 'Aplicar cambio'}</Button>
      </div>
    </form>
  </dialog>;
};
