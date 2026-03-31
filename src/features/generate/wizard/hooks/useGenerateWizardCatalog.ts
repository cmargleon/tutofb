import { useEffect, useMemo, useState } from 'react';
import { BatchOutputMode, Client, Model, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../../../shared/src/domain';
import {
  subscribeToClientSpreadsheetTemplates,
  subscribeToClients,
  subscribeToSpreadsheetTemplateCategories,
} from '../../../clients/firebase';
import { subscribeToModels } from '../../../models/firebase';

interface UseGenerateWizardCatalogParams {
  selectedClientId: string | null;
  selectedModelId: string | null;
  outputMode: BatchOutputMode;
  selectedSpreadsheetTemplateId: string | null;
  selectedSpreadsheetCategoryId: string | null;
}

interface UseGenerateWizardCatalogResult {
  clients: Client[];
  models: Model[];
  spreadsheetTemplates: SpreadsheetTemplate[];
  spreadsheetCategories: SpreadsheetTemplateCategory[];
  selectedClient: Client | null;
  selectedModel: Model | null;
  selectedSpreadsheetTemplate: SpreadsheetTemplate | null;
  selectedSpreadsheetCategory: SpreadsheetTemplateCategory | null;
  loadingData: boolean;
  error: string | null;
}

export const useGenerateWizardCatalog = ({
  selectedClientId,
  selectedModelId,
  outputMode,
  selectedSpreadsheetTemplateId,
  selectedSpreadsheetCategoryId,
}: UseGenerateWizardCatalogParams): UseGenerateWizardCatalogResult => {
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [spreadsheetTemplates, setSpreadsheetTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [spreadsheetCategories, setSpreadsheetCategories] = useState<SpreadsheetTemplateCategory[]>([]);
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
      setSpreadsheetTemplates([]);
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

  useEffect(() => {
    if (!selectedClientId || outputMode !== 'spreadsheet') {
      setSpreadsheetTemplates([]);
      return;
    }

    const unsubscribe = subscribeToClientSpreadsheetTemplates(
      selectedClientId,
      (nextTemplates) => {
        setSpreadsheetTemplates(nextTemplates.filter((template) => template.status !== 'archived'));
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los spreadsheets del cliente.');
      },
    );

    return () => unsubscribe();
  }, [outputMode, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || outputMode !== 'spreadsheet' || !selectedSpreadsheetTemplateId) {
      setSpreadsheetCategories([]);
      return;
    }

    const unsubscribe = subscribeToSpreadsheetTemplateCategories(
      selectedClientId,
      selectedSpreadsheetTemplateId,
      (nextCategories) => {
        setSpreadsheetCategories(nextCategories);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar las categorías del spreadsheet.');
      },
    );

    return () => unsubscribe();
  }, [outputMode, selectedClientId, selectedSpreadsheetTemplateId]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );
  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );
  const selectedSpreadsheetTemplate = useMemo(
    () => spreadsheetTemplates.find((template) => template.id === selectedSpreadsheetTemplateId) ?? null,
    [selectedSpreadsheetTemplateId, spreadsheetTemplates],
  );
  const selectedSpreadsheetCategory = useMemo(
    () => spreadsheetCategories.find((category) => category.id === selectedSpreadsheetCategoryId) ?? null,
    [selectedSpreadsheetCategoryId, spreadsheetCategories],
  );

  return {
    clients,
    models,
    spreadsheetTemplates,
    spreadsheetCategories,
    selectedClient,
    selectedModel,
    selectedSpreadsheetTemplate,
    selectedSpreadsheetCategory,
    loadingData,
    error,
  };
};
