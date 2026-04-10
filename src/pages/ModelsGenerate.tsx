import React from 'react';
import { PageHeader } from '../components/ui';
import { ModelCreateSection } from '../components/models/ModelCreateSection';
import { useModelCreateFlow } from '../features/models/hooks/useModelCreateFlow';
import { useModelsCatalog } from '../features/models/hooks/useModelsCatalog';

export const ModelsGenerate: React.FC = () => {
  const catalog = useModelsCatalog();
  const createFlow = useModelCreateFlow();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Generar modelos"
        description="Crea nuevos modelos y sus poses base para dejarlos listos antes de usarlos en generación de catálogo."
      />

      {catalog.error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {catalog.error}
        </div>
      )}

      <ModelCreateSection
        clients={catalog.clients}
        loading={catalog.loading}
        flow={createFlow}
      />
    </div>
  );
};
