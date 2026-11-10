import React from 'react';
import { Wand2 } from 'lucide-react';
import { Alert, PageHeader } from '../components/ui';
import { ModelCreateSection } from '../components/models/ModelCreateSection';
import { useModelCreateFlow } from '../features/models/hooks/useModelCreateFlow';
import { useModelsCatalog } from '../features/models/hooks/useModelsCatalog';

export const ModelsGenerate: React.FC = () => {
  const catalog = useModelsCatalog();
  const createFlow = useModelCreateFlow();

  return (
    <div className="tuto-page">
      <PageHeader
        title="Generar modelos"
        icon={Wand2}
        description="Crea nuevos modelos y sus poses base para dejarlos listos antes de usarlos en generación de catálogo."
      />

      {catalog.error && (
        <Alert tone="danger">{catalog.error}</Alert>
      )}

      <ModelCreateSection
        clients={catalog.clients}
        loading={catalog.loading}
        flow={createFlow}
      />
    </div>
  );
};
