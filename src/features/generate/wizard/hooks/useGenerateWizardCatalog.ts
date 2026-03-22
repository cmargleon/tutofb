import { useEffect, useMemo, useState } from 'react';
import { Client, Model } from '../../../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../../../shared/src/domain';
import { subscribeToClients } from '../../../clients/firebase';
import { subscribeToModels } from '../../../models/firebase';

interface UseGenerateWizardCatalogParams {
  selectedClientId: string | null;
  selectedModelId: string | null;
}

interface UseGenerateWizardCatalogResult {
  clients: Client[];
  models: Model[];
  selectedModel: Model | null;
  loadingData: boolean;
  error: string | null;
}

export const useGenerateWizardCatalog = ({
  selectedClientId,
  selectedModelId,
}: UseGenerateWizardCatalogParams): UseGenerateWizardCatalogResult => {
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (nextClients) => {
        setClients(nextClients.filter(isActiveCatalogEntity));
        setLoadingData(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los clientes.');
        setLoadingData(false);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      setModels([]);
      return;
    }

    const unsubscribe = subscribeToModels(
      (nextModels) => {
        setModels(nextModels.filter((model) => model.clientId === selectedClientId && isActiveCatalogEntity(model)));
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los modelos.');
      },
    );

    return () => unsubscribe();
  }, [selectedClientId]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  return {
    clients,
    models,
    selectedModel,
    loadingData,
    error,
  };
};
