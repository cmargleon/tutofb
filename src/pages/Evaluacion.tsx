import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, LoadingBlock, EmptyState, StatusBadge } from '../components/ui';
import { useEvaluationBatch } from '../features/evaluation/useEvaluationBatch';
import { JobBatchCarousel } from '../components/evaluation/JobBatchCarousel';
import { downloadBatchImages } from '../features/evaluation/downloadBatchImages';
import { Download, AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';

export const Evaluacion: React.FC = () => {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  const { batch, jobs, loading, error } = useEvaluationBatch(batchId);
  const [downloading, setDownloading] = useState(false);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote actual." />
        <LoadingBlock />
      </div>
    );
  }

  if (error || !batchId) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote actual." />
        <EmptyState
          title="Lote no encontrado"
          description={error || "No se ha especificado un lote válido para evaluar."}
          icon={<AlertCircle className="w-6 h-6" />}
        />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader title="Evaluación" description="Revisa y regenera las imágenes del lote actual." />
        <EmptyState
          title="Lote no encontrado"
          description="El lote solicitado no existe o no tienes permisos para verlo."
          icon={<AlertCircle className="w-6 h-6" />}
        />
      </div>
    );
  }

  const handleDownloadAll = async () => {
    setDownloading(true);
    try {
      await downloadBatchImages(batch, jobs);
    } catch (err: any) {
      alert(err.message || 'Error al descargar las imágenes');
    } finally {
      setDownloading(false);
    }
  };

  const hasCompletedImages = jobs.some(job => job.status === 'completed' && job.currentOutput?.resultImagePath);

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <div className="flex justify-between items-start mb-8">
        <PageHeader 
          title="Evaluación" 
          description="Revisa visualmente los resultados del lote actual. Puedes regenerar cualquier imagen individualmente si el resultado no es satisfactorio." 
        />
        
        {hasCompletedImages && (
          <button
            onClick={handleDownloadAll}
            disabled={downloading}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {downloading ? (
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Download className="w-5 h-5 mr-2" />
            )}
            Guardar todas las imágenes
          </button>
        )}
      </div>

      {/* Batch Summary Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="bg-indigo-100 text-indigo-800 text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wide">
                Lote Actual
              </span>
              <StatusBadge status={batch.status} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {batch.clientNameSnapshot} <span className="text-gray-400 font-normal mx-2">/</span> {batch.modelNameSnapshot}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              ID: {batch.id} • Creado el {new Date(batch.createdAt?.toMillis ? batch.createdAt.toMillis() : batch.createdAt).toLocaleString()}
            </p>
          </div>

          <div className="flex space-x-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase font-semibold">Total</p>
              <p className="text-2xl font-bold text-gray-900">{batch.totalJobs}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-green-600 uppercase font-semibold">Completados</p>
              <p className="text-2xl font-bold text-green-700 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {batch.completedJobs}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-blue-600 uppercase font-semibold">En Proceso</p>
              <p className="text-2xl font-bold text-blue-700 flex items-center justify-center">
                <Clock className="w-4 h-4 mr-1" />
                {batch.processingJobs + batch.pendingJobs}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-red-600 uppercase font-semibold">Fallidos</p>
              <p className="text-2xl font-bold text-red-700 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 mr-1" />
                {batch.failedJobs}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Jobs Carousel */}
      {jobs.length === 0 ? (
        <EmptyState
          title="No hay trabajos"
          description="Este lote no tiene trabajos asociados o aún no se han creado."
          icon={<Clock className="w-6 h-6" />}
        />
      ) : (
        <JobBatchCarousel batch={batch} jobs={jobs} />
      )}
    </div>
  );
};
