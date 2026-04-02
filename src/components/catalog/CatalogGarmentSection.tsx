import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';
import { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { CatalogGarmentGroup } from '../../features/catalog/useCatalogJobs';
import { CatalogThumbnail } from './CatalogThumbnail';
import FileSaver from 'file-saver';

interface CatalogGarmentSectionProps {
  group: CatalogGarmentGroup;
  onImageClick: (job: Job) => void;
}

export const CatalogGarmentSection: React.FC<CatalogGarmentSectionProps> = ({ group, onImageClick }) => {
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
          disabled={downloading}
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
        <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {group.jobs.map((job) => (
            <CatalogThumbnail key={job.id} job={job} onClick={() => onImageClick(job)} />
          ))}
        </div>
      )}
    </div>
  );
};
