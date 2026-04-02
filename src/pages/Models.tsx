import React from 'react';
import { PageHeader } from '../components/ui';
import { ModelCreateSection } from '../components/models/ModelCreateSection';
import { ModelLibrarySection } from '../components/models/ModelLibrarySection';
import { useModelCreateFlow } from '../features/models/hooks/useModelCreateFlow';
import { useModelLibrary } from '../features/models/hooks/useModelLibrary';
import { useModelsCatalog } from '../features/models/hooks/useModelsCatalog';

export const Models: React.FC = () => {
  const catalog = useModelsCatalog();
  const createFlow = useModelCreateFlow();
  const library = useModelLibrary({
    onOptimisticUpdate: catalog.applyOptimisticModels,
    getModelsSnapshot: catalog.getModelsSnapshot,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Modelos"
        description="Gestiona los modelos y sus poses (imágenes base) para la generación de catálogo."
      />

      {catalog.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {catalog.error}
        </div>
      )}

      <div className="space-y-8">
        <ModelCreateSection
          clients={catalog.clients}
          loading={catalog.loading}
          flow={createFlow}
        />
        <ModelLibrarySection catalog={catalog} library={library} />
      </div>
    </div>
  );
};
