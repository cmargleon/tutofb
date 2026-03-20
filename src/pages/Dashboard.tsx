import React, { useState, useEffect } from 'react';
import { subscribeToRecentBatches, subscribeToAnalyticsSummary } from '../features/dashboard/firebase';
import { Batch, AnalyticsSummary } from '../../shared/src/types';
import { LoadingBlock, EmptyState } from '../components/ui';
import { Activity, CheckCircle, XCircle, Clock, DollarSign, Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Dashboard: React.FC = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubBatches: () => void;
    let unsubSummary: () => void;

    try {
      unsubBatches = subscribeToRecentBatches(
        (data) => {
          setBatches(data);
          setLoading(false);
        },
        (err) => {
          console.error(err);
          setError('Error loading batches');
          setLoading(false);
        }
      );

      unsubSummary = subscribeToAnalyticsSummary(
        (data) => {
          setSummary(data);
        },
        (err) => {
          console.error(err);
        }
      );
    } catch (err) {
      console.error(err);
      setError('Error initializing dashboard');
      setLoading(false);
    }

    return () => {
      if (unsubBatches) unsubBatches();
      if (unsubSummary) unsubSummary();
    };
  }, []);

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {error && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
          {error}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">En Cola</p>
            <p className="text-2xl font-bold text-gray-900">{summary?.pendingJobs || 0}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg">
            <CheckCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Completados</p>
            <p className="text-2xl font-bold text-gray-900">{summary?.completedJobs || 0}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-lg">
            <XCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Fallidos</p>
            <p className="text-2xl font-bold text-gray-900">{summary?.failedJobs || 0}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Costo Total</p>
            <p className="text-2xl font-bold text-gray-900">${(summary?.totalCostUsd || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Recent Batches */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Últimos Lotes</h2>
        </div>
        
        {batches.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">ID Lote</th>
                  <th className="px-6 py-3">Cliente / Modelo</th>
                  <th className="px-6 py-3">Progreso</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batches.map(batch => {
                  const progress = batch.totalJobs > 0 
                    ? Math.round(((batch.completedJobs + batch.failedJobs) / batch.totalJobs) * 100) 
                    : 0;
                  
                  return (
                    <tr key={batch.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono text-xs text-gray-500">
                        <Link to={`/evaluacion?batchId=${batch.id}`} className="text-indigo-600 hover:underline">
                          {batch.id?.substring(0, 8)}...
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{batch.clientNameSnapshot}</p>
                        <p className="text-gray-500">{batch.modelNameSnapshot}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-gray-200 rounded-full h-2 max-w-[100px]">
                            <div 
                              className="bg-indigo-600 h-2 rounded-full" 
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{progress}%</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {batch.completedJobs} / {batch.totalJobs}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          batch.status === 'completed' ? 'bg-green-100 text-green-700' :
                          batch.status === 'failed' ? 'bg-red-100 text-red-700' :
                          batch.status === 'partial_failed' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {batch.createdAt?.toDate?.()?.toLocaleDateString() || 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState 
              title="No hay lotes" 
              description="Aún no se han generado imágenes." 
              icon={<ImageIcon />} 
            />
          </div>
        )}
      </div>
    </div>
  );
};
