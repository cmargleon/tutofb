import React, { useEffect, useState, useCallback } from 'react';
import { Download, Images, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { PageHeader, LoadingBlock } from '../components/ui';
import { subscribeToClients } from '../features/clients/firebase';
import { useCatalogJobs, CatalogGarmentGroup } from '../features/catalog/useCatalogJobs';
import { Client, Job } from '../../shared/src/types';
import { resolveApprovedJobOutput } from '../../shared/src/domain';
import FileSaver from 'file-saver';

// ─── Thumbnail ────────────────────────────────────────────────────────────────

interface ThumbnailProps {
  job: Job;
  onClick: (job: Job, url: string) => void;
}

const Thumbnail: React.FC<ThumbnailProps> = ({ job, onClick }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const resultPath = resolveApprovedJobOutput(job)?.resultImagePath;

  useEffect(() => {
    if (!resultPath) return;
    let cancelled = false;
    getDownloadURL(ref(storage, resultPath))
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [resultPath]);

  if (loadError || !resultPath) return null;

  return (
    <button
      type="button"
      onClick={() => url && onClick(job, url)}
      className="relative group aspect-[3/4] rounded-lg overflow-hidden border border-gray-200 hover:border-indigo-400 transition-colors bg-gray-100"
      title={job.garmentName}
    >
      {url ? (
        <img
          src={url}
          alt={job.garmentName}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2">
        <p className="text-white text-xs truncate">{job.modelNameSnapshot}</p>
      </div>
    </button>
  );
};

// ─── Garment section ──────────────────────────────────────────────────────────

interface GarmentSectionProps {
  group: CatalogGarmentGroup;
  onImageClick: (job: Job, url: string) => void;
}

const GarmentSection: React.FC<GarmentSectionProps> = ({ group, onImageClick }) => {
  const [expanded, setExpanded] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadAll = async () => {
    setDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(group.garmentName.replace(/[^a-zA-Z0-9_-]/g, '_')) ?? zip;

      await Promise.all(
        group.jobs.map(async (job) => {
          const path = resolveApprovedJobOutput(job)?.resultImagePath;
          if (!path) return;
          try {
            const downloadUrl = await getDownloadURL(ref(storage, path));
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

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-left min-w-0"
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
          disabled={downloading}
          className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50 shrink-0 ml-4"
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
        <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {group.jobs.map((job) => (
            <Thumbnail key={job.id} job={job} onClick={onImageClick} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  job: Job;
  url: string;
  onClose: () => void;
}

const Lightbox: React.FC<LightboxProps> = ({ job, url, onClose }) => {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const ext = url.split('?')[0].split('.').pop() || 'png';
      const filename = [
        job.clientNameSnapshot,
        job.garmentName,
        job.modelNameSnapshot,
        job.id,
      ]
        .map((s) => (s || '').replace(/[^a-zA-Z0-9_-]/g, '_'))
        .join('_') + `.${ext}`;
      FileSaver.saveAs(blob, filename);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[90vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Controls */}
        <div className="flex items-center justify-between w-full">
          <div className="text-white text-sm space-y-0.5">
            <p className="font-semibold">{job.garmentName}</p>
            <p className="text-white/70">{job.modelNameSnapshot} · {job.clientNameSnapshot}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Descargar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Image */}
        <img
          src={url}
          alt={job.garmentName}
          className="max-h-[75vh] rounded-xl object-contain"
        />
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export const Catalogo: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [lightbox, setLightbox] = useState<{ job: Job; url: string } | null>(null);

  const { garmentGroups, loading, error } = useCatalogJobs(selectedClientId || null);

  useEffect(() => {
    const unsub = subscribeToClients(
      (c) => setClients(c),
      () => {},
    );
    return unsub;
  }, []);

  const handleImageClick = useCallback((job: Job, url: string) => {
    setLightbox({ job, url });
  }, []);

  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  const totalImages = garmentGroups.reduce((sum, g) => sum + g.jobs.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-6 py-4">
        <PageHeader title="Catálogo" icon={Images} />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Client selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="catalog-client" className="text-sm font-medium text-gray-700 shrink-0">
            Cliente
          </label>
          <select
            id="catalog-client"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="">Selecciona un cliente...</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedClientId && !loading && (
            <span className="text-sm text-gray-500">
              {totalImages} {totalImages === 1 ? 'imagen' : 'imágenes'} · {garmentGroups.length}{' '}
              {garmentGroups.length === 1 ? 'prenda' : 'prendas'}
            </span>
          )}
        </div>

        {/* States */}
        {!selectedClientId && (
          <div className="text-center py-16 text-gray-400">
            <Images className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>Selecciona un cliente para ver su catálogo</p>
          </div>
        )}

        {selectedClientId && loading && (
          <div className="flex items-center justify-center py-16">
            <LoadingBlock />
          </div>
        )}

        {selectedClientId && !loading && error && (
          <div className="text-center py-16 text-red-500 text-sm">{error}</div>
        )}

        {selectedClientId && !loading && !error && garmentGroups.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p>No hay imágenes completadas para este cliente</p>
          </div>
        )}

        {/* Garment sections */}
        {!loading && garmentGroups.length > 0 && (
          <div className="space-y-4">
            {garmentGroups.map((group) => (
              <GarmentSection
                key={group.garmentId}
                group={group}
                onImageClick={handleImageClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox job={lightbox.job} url={lightbox.url} onClose={handleCloseLightbox} />
      )}
    </div>
  );
};
