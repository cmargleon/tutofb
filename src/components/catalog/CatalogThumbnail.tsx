import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';
import { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';

interface CatalogThumbnailProps {
  job: Job;
  onClick: (job: Job) => void;
}

export const CatalogThumbnail: React.FC<CatalogThumbnailProps> = ({ job, onClick }) => {
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
      onClick={() => url && onClick(job)}
      className="relative group aspect-[3/4] cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-indigo-400"
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
