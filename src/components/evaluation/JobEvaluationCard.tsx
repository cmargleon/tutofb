import React, { useState, useEffect } from 'react';
import { Batch, Job, Provider } from '../../../shared/src/types';
import { StatusBadge } from '../ui';
import { Download, RefreshCw, AlertCircle } from 'lucide-react';
import { saveAs } from 'file-saver';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../../firebase';

interface Props {
  batch: Batch;
  job: Job;
  index: number;
  draft: { provider: Provider; prompt: string };
  isQueueing: boolean;
  regenerationError: string | null;
  onUpdateDraft: (updates: Partial<{ provider: Provider; prompt: string }>) => void;
  onRegenerate: () => void;
}

export const JobEvaluationCard: React.FC<Props> = ({
  batch,
  job,
  index,
  draft,
  isQueueing,
  regenerationError,
  onUpdateDraft,
  onRegenerate
}) => {
  const [downloading, setDownloading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchUrl = async () => {
      if (job.currentOutput?.resultImagePath) {
        try {
          const imageRef = ref(storage, job.currentOutput.resultImagePath);
          const url = await getDownloadURL(imageRef);
          if (isMounted) setImageUrl(url);
        } catch (error) {
          console.error('Error fetching image URL:', error);
        }
      } else {
        if (isMounted) setImageUrl(null);
      }
    };
    fetchUrl();
    return () => { isMounted = false; };
  }, [job.currentOutput?.resultImagePath]);

  const handleDownload = async () => {
    if (!imageUrl) return;
    setDownloading(true);
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const cleanClientName = batch.clientNameSnapshot.replace(/[^a-zA-Z0-9]/g, '_');
      const cleanModelName = batch.modelNameSnapshot.replace(/[^a-zA-Z0-9]/g, '_');
      const cleanGarmentName = job.garmentName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${cleanClientName}_${cleanModelName}_${cleanGarmentName}_pose${index + 1}_${job.id}.jpg`;
      saveAs(blob, fileName);
    } catch (error) {
      console.error('Error downloading image:', error);
      alert('Error al descargar la imagen');
    } finally {
      setDownloading(false);
    }
  };

  const isProcessing = job.status === 'pending' || job.status === 'processing';
  const hasOutput = !!imageUrl;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <div>
          <h3 className="font-semibold text-gray-900">Pose {index + 1}</h3>
          <p className="text-xs text-gray-500">{job.modelNameSnapshot}</p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Image Area */}
      <div className="relative aspect-[3/4] bg-gray-100 flex-shrink-0">
        {hasOutput ? (
          <img
            src={imageUrl!}
            alt={`Pose ${index + 1}`}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-6 text-center">
            {job.status === 'failed' ? (
              <>
                <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-sm text-red-600">Error en la generación</p>
                {job.lastError && <p className="text-xs text-red-500 mt-1 line-clamp-2">{job.lastError}</p>}
              </>
            ) : (
              <p className="text-sm">Esperando resultado...</p>
            )}
          </div>
        )}

        {/* Processing Overlay */}
        {(isProcessing || isQueueing) && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
            <p className="font-medium text-gray-900">
              {isQueueing ? 'Encolando regeneración...' : 'Procesando imagen...'}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Esta tarjeta se actualizará automáticamente cuando termine el proceso.
            </p>
            {hasOutput && (
              <p className="text-xs text-indigo-600 font-medium mt-4 bg-indigo-50 px-3 py-1 rounded-full">
                Mostrando imagen anterior
              </p>
            )}
          </div>
        )}

        {/* Download Button */}
        {hasOutput && !isProcessing && !isQueueing && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="absolute bottom-3 right-3 p-2 bg-white/90 hover:bg-white text-gray-700 rounded-full shadow-sm backdrop-blur transition-all disabled:opacity-50"
            title="Descargar imagen"
          >
            <Download className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Controls Area */}
      <div className="p-4 flex flex-col flex-grow space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Proveedor IA</label>
          <select
            value={draft.provider}
            onChange={(e) => onUpdateDraft({ provider: e.target.value as Provider })}
            disabled={isProcessing || isQueueing}
            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="fal-seedream">Seedream (FAL)</option>
            <option value="fal-banana-pro">Banana Pro (FAL)</option>
            <option value="openai-gpt-image-1.5">OpenAI DALL-E 3</option>
          </select>
        </div>

        <div className="flex-grow flex flex-col">
          <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
          <textarea
            value={draft.prompt}
            onChange={(e) => onUpdateDraft({ prompt: e.target.value })}
            disabled={isProcessing || isQueueing}
            rows={4}
            className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 resize-none flex-grow disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="Describe cómo debe verse la imagen final..."
          />
        </div>

        {regenerationError && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
            {regenerationError}
          </div>
        )}

        <button
          onClick={onRegenerate}
          disabled={isProcessing || isQueueing || !draft.prompt.trim()}
          className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isQueueing ? 'animate-spin' : ''}`} />
          Regenerar foto
        </button>
      </div>
    </div>
  );
};
