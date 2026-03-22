import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export const LocalFileThumb: React.FC<{ file: File; onRemove: () => void }> = ({ file, onRemove }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file]);

  return (
    <div className="aspect-[3/4] relative group rounded-md overflow-hidden border border-gray-200 bg-gray-50">
      {previewUrl ? (
        <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-gray-100" />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 inline-flex items-center justify-center rounded-full bg-white/95 p-1.5 text-red-600 shadow-sm hover:bg-white"
        aria-label={`Quitar ${file.name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
        <p className="truncate text-[11px] text-white">{file.name}</p>
      </div>
    </div>
  );
};
