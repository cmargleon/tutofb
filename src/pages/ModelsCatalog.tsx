import React from 'react';
import { PageHeader } from '../components/ui';
import { ModelLibrarySection } from '../components/models/ModelLibrarySection';
import { useModelLibrary } from '../features/models/hooks/useModelLibrary';
import { useModelsCatalog } from '../features/models/hooks/useModelsCatalog';

export const ModelsCatalog: React.FC = () => {
  const catalog = useModelsCatalog();
  const library = useModelLibrary({
    onOptimisticUpdate: catalog.applyOptimisticModels,
    getModelsSnapshot: catalog.getModelsSnapshot,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Catálogo de modelos"
        description="Administra la biblioteca de modelos, revisa sus poses y mantén archivadas las variantes que ya no estén activas."
      />

      {catalog.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {catalog.error}
        </div>
      )}

      <ModelLibrarySection catalog={catalog} library={library} />
    </div>
  );
};
