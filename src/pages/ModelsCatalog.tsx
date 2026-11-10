import React from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ModelLibraryItem } from '../components/models/ModelLibraryItem';
import { UserSquare2 } from 'lucide-react';
import { Alert, LoadingBlock, PageHeader } from '../components/ui';
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
    <div className="tuto-page">
      {!modelId && <PageHeader title="Modelos" icon={UserSquare2} description="Biblioteca de modelos y poses disponibles para la generación de fotografías." />}
      {catalog.error && (
        <Alert tone="danger">{catalog.error}</Alert>
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
