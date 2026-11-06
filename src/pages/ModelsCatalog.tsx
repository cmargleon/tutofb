import React from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ModelLibraryItem } from '../components/models/ModelLibraryItem';
import { LoadingBlock } from '../components/ui';
import { ModelLibrarySection } from '../components/models/ModelLibrarySection';
import { useModelLibrary } from '../features/models/hooks/useModelLibrary';
import { useModelsCatalog } from '../features/models/hooks/useModelsCatalog';

export const ModelsCatalog: React.FC = () => {
  const { modelId } = useParams();
  const { hash, search } = useLocation();
  const catalog = useModelsCatalog(modelId);
  const library = useModelLibrary({
    onOptimisticUpdate: catalog.applyOptimisticModels,
    getModelsSnapshot: catalog.getModelsSnapshot,
  });

  if (!modelId && hash.startsWith('#model-') && hash.length > '#model-'.length) {
    return <Navigate replace to={`/models/catalogo/${encodeURIComponent(hash.slice('#model-'.length))}${search}`} />;
  }

  const model = modelId ? catalog.models.find((item) => item.id === modelId) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      {catalog.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {catalog.error}
        </div>
      )}

      {modelId ? (
        catalog.loading ? <LoadingBlock /> : model ? (
          <ModelLibraryItem key={modelId} model={model} clients={catalog.clients} library={library} />
        ) : (
          <div className="space-y-3">
            {!catalog.error && <p>No se encontró el modelo.</p>}
            <Link className="text-sm font-medium text-indigo-600 hover:underline" to={`/models/catalogo${search}`}>
              Volver al catálogo
            </Link>
          </div>
        )
      ) : (
        <ModelLibrarySection catalog={catalog} library={library} />
      )}
    </div>
  );
};
