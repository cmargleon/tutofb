import { productPhotoStatus } from '../../../shared/src/productWorkflow';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { CatalogGarmentGroup } from '../../features/catalog/useCatalogJobs';
import { CatalogThumbnail } from './CatalogThumbnail';
import FileSaver from 'file-saver';
import { resolveStorageAssetUrl } from '../../features/storage/assets';
import { cancelJobGeneration, deleteJob, regenerateJob } from '../../features/evaluation/firebase';
import { useRole } from '../../features/auth/AuthProvider';
import { useConfirm, useToast } from '../../features/feedback/FeedbackProvider';

interface CatalogGarmentSectionProps {
  group: CatalogGarmentGroup;
  deferGallery?: boolean;
  showProductPhotoStatus?: boolean;
  onImageClick: (job: Job) => void;
  onRegenerationQueued?: (job: Job) => void;
  onRegenerationCancelled?: (jobId: string) => void;
  pendingRegenerationJobIds?: Record<string, true>;
}

const photoStatusLabels = { approved: 'Aprobada', attention: 'Requiere atención', inProgress: 'En curso', cancelled: 'Cancelada' };

export const CatalogGarmentSection: React.FC<CatalogGarmentSectionProps> = ({
  group,
  deferGallery = false,
  showProductPhotoStatus = false,
  onImageClick,
  onRegenerationQueued,
  onRegenerationCancelled,
  pendingRegenerationJobIds = {},
}) => {
  const [expanded, setExpanded] = useState(true);
  const [galleryOpened, setGalleryOpened] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [queueingJobIds, setQueueingJobIds] = useState<Record<string, boolean>>({});
  const [cancellingJobIds, setCancellingJobIds] = useState<Record<string, boolean>>({});
  const role = useRole();
  const toast = useToast();
  const confirm = useConfirm();
  const downloadableJobs = group.jobs.filter((job) => Boolean(resolveApprovedJobOutput(job)?.resultImagePath));
  const showGallery = !deferGallery || galleryOpened || typeof IntersectionObserver === 'undefined';

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!expanded || showGallery || !gallery) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        setGalleryOpened(true);
      }
    }, { root: gallery.closest('main'), rootMargin: '300px 0px' });
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [expanded, showGallery]);

  const handleDownloadAll = async () => {
    if (downloadableJobs.length === 0) {
      return;
    }
    setDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(group.garmentName.replace(/[^a-zA-Z0-9_-]/g, '_')) ?? zip;

      await Promise.all(
        downloadableJobs.map(async (job) => {
          const path = resolveApprovedJobOutput(job)?.resultImagePath;
          if (!path) return;
          try {
            const { url: downloadUrl } = await resolveStorageAssetUrl(path);
            const resp = await fetch(downloadUrl);
            const buf = await resp.arrayBuffer();
            const ext = path.split('?')[0].split('.').pop() || 'png';
            folder.file(`${job.modelNameSnapshot}_${job.id}.${ext}`, buf);
          } catch {
            // skip failed images
          }
        }),
      );

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      FileSaver.saveAs(blob, `${group.garmentName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`);
    } catch (e) {
      console.error('Error creating ZIP:', e);
    } finally {
      setDownloading(false);
    }
  };

  const handleRegenerate = async (job: Job) => {
    if (!job.id) return;
    if (queueingJobIds[job.id] || pendingRegenerationJobIds[job.id]) return;

    setQueueingJobIds((prev) => ({ ...prev, [job.id!]: true }));
    try {
      await regenerateJob(job.id, job.provider, job.promptBase);
      onRegenerationQueued?.(job);
      toast({ tone: 'success', title: 'Regeneración encolada', description: 'El trabajo volvió a la cola.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo regenerar', description: err.message || 'Inténtalo nuevamente.' });
    } finally {
      setQueueingJobIds((prev) => {
        if (!prev[job.id!]) return prev;
        const next = { ...prev };
        delete next[job.id!];
        return next;
      });
    }
  };

  const handleDownloadSingle = async (job: Job) => {
    const path = resolveApprovedJobOutput(job)?.resultImagePath;
    if (!path) return;
    try {
      const { url: downloadUrl } = await resolveStorageAssetUrl(path);
      const resp = await fetch(downloadUrl);
      const buf = await resp.arrayBuffer();
      const ext = path.split('?')[0].split('.').pop() || 'png';
      const fileName = `${job.modelNameSnapshot}_${job.id}.${ext}`;
      FileSaver.saveAs(new Blob([buf]), fileName);
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo descargar', description: err.message || 'Inténtalo nuevamente.' });
    }
  };

  const handleCancelRegeneration = async (job: Job) => {
    if (!job.id) return;
    if (cancellingJobIds[job.id]) return;

    const accepted = await confirm({
      title: 'Cancelar regeneración',
      description: `Vas a cancelar la regeneración de "${job.garmentName}".`,
      impact: 'La foto quedará marcada como cancelada y se quitará del spreadsheet del lote si estaba siendo usada.',
      confirmLabel: 'Sí, cancelar',
      cancelLabel: 'Seguir generando',
      tone: 'warning',
    });
    if (!accepted) return;

    setCancellingJobIds((prev) => ({ ...prev, [job.id!]: true }));
    try {
      await cancelJobGeneration(job.id);
      onRegenerationCancelled?.(job.id);
      toast({
        tone: 'success',
        title: 'Regeneración cancelada',
        description: 'La foto quedó marcada como cancelada.',
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No se pudo cancelar la regeneración',
        description: err.message || 'Inténtalo nuevamente.',
      });
    } finally {
      setCancellingJobIds((prev) => {
        if (!prev[job.id!]) return prev;
        const next = { ...prev };
        delete next[job.id!];
        return next;
      });
    }
  };

  const handleDelete = async (job: Job) => {
    if (!job.id) return;
    const accepted = await confirm({
      title: 'Borrar imagen',
      description: `¿Estás seguro de que querés borrar esta imagen de "${job.garmentName}"?`,
      impact: 'Esta acción no se puede deshacer. La imagen se eliminará permanentemente del catálogo.',
      confirmLabel: 'Sí, borrar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!accepted) return;
    try {
      await deleteJob(job.id);
      toast({ tone: 'success', title: 'Imagen borrada', description: 'El trabajo fue eliminado del catálogo.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo borrar', description: err.message || 'Inténtalo nuevamente.' });
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div onFocus={() => setGalleryOpened(true)} className="flex items-center justify-between bg-gray-50 px-4 py-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 cursor-pointer items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
          )}
          <span className="font-medium text-gray-900 truncate">{group.garmentName}</span>
          <span className="text-xs text-gray-500 shrink-0">({group.jobs.length})</span>
        </button>
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloading || downloadableJobs.length === 0}
          className="ml-4 flex cursor-pointer items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
          title="Descargar todas las imágenes de esta prenda"
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">Descargar</span>
        </button>
      </div>

      {expanded && (
        <div ref={galleryRef} className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {group.jobs.map((job) => {
            // Reserve the same responsive grid space before thumbnails mount.
            if (!showGallery) {
              const placeholder = <div key={job.id} className="aspect-[3/4] rounded-lg bg-gray-100" aria-hidden="true" />;
              return showProductPhotoStatus ? (
                <div key={job.id} aria-hidden="true">
                  {placeholder}
                  <div className="mt-1 h-4" />
                </div>
              ) : placeholder;
            }
            const isRegenerationPending = Boolean(
              job.id && (queueingJobIds[job.id] || pendingRegenerationJobIds[job.id]),
            );
            const isCancelling = Boolean(job.id && cancellingJobIds[job.id]);
            const canCancelRegeneration = role.canRegenerate && (isRegenerationPending || job.status === 'pending' || job.status === 'processing');

            const thumbnail = <CatalogThumbnail
                key={job.id}
                job={job}
                onClick={onImageClick}
                onRegenerate={role.canRegenerate && !isRegenerationPending ? handleRegenerate : undefined}
                onCancel={canCancelRegeneration ? handleCancelRegeneration : undefined}
                onDownload={handleDownloadSingle}
                onDelete={role.canRegenerate ? handleDelete : undefined}
                regenerationPending={isRegenerationPending}
                cancellationPending={isCancelling}
              />;
            return showProductPhotoStatus ? <div key={job.id}>
              {thumbnail}
              <p className="mt-1 text-xs font-medium text-slate-700">{photoStatusLabels[productPhotoStatus(job)]}</p>
            </div> : thumbnail;
          })}
        </div>
      )}
    </div>
  );
};
