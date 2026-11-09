import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { isArchivedCatalogEntity } from '../../../../shared/src/domain';
import { Client, Model } from '../../../../shared/src/types';
import { subscribeToClients } from '../../clients/firebase';
import { subscribeToModel, subscribeToModels } from '../firebase';

const MODELS_PAGE_SIZE = 20;

export interface UseModelsCatalogResult {
  models: Model[];
  clients: Client[];
  loading: boolean;
  error: string | null;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  modelSearch: string;
  handleModelSearchChange: (value: string) => void;
  clientFilter: string;
  handleClientFilterChange: (value: string) => void;
  modelsPage: number;
  setModelsPage: (value: number) => void;
  modelsTotalPages: number;
  filteredModelsCount: number;
  pagedModels: Model[];
  applyOptimisticModels: (updater: (prev: Model[]) => Model[]) => void;
  getModelsSnapshot: () => Model[];
}

export const useModelsCatalog = (modelId?: string): UseModelsCatalogResult => {
  const [params, setParams] = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const showArchived = params.get('archived') === '1';
  const modelSearch = params.get('q') ?? '';
  const clientFilter = params.get('clientId') ?? '';
  const pageParam = Number(params.get('page'));
  const requestedPage = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const includeArchived = !modelId && showArchived;
  const modelsRef = useRef<Model[]>([]);

  useEffect(() => {
    let modelsLoaded = false;
    let clientsLoaded = false;

    setLoading(true);
    setError(null);

    const checkLoading = () => {
      if (modelsLoaded && clientsLoaded) {
        setLoading(false);
      }
    };

    const handleModels = (data: Model[]) => {
      modelsRef.current = data;
      setModels(data);
      modelsLoaded = true;
      checkLoading();
    };

    const handleModelsError = (err: Error) => {
      console.error('Error loading models:', err);
      setError('Error al cargar los modelos.');
      handleModels([]);
    };

    const unsubModels = modelId
      ? subscribeToModel(modelId, (model) => handleModels(model ? [model] : []), handleModelsError)
      : subscribeToModels(handleModels, handleModelsError, { includeArchived, includeInactive: true });

    const unsubClients = subscribeToClients(
      (data) => {
        setClients(data);
        clientsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error('Error loading clients:', err);
        clientsLoaded = true;
        checkLoading();
      },
    );

    return () => {
      unsubModels();
      unsubClients();
    };
  }, [includeArchived, modelId]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter((model) =>
      (showArchived || !isArchivedCatalogEntity(model))
      && (!clientFilter || model.clientId === clientFilter)
      && model.name.toLowerCase().includes(query),
    );
  }, [models, modelSearch, clientFilter, showArchived]);

  const modelsTotalPages = Math.max(1, Math.ceil(filteredModels.length / MODELS_PAGE_SIZE));
  const modelsPage = Math.min(requestedPage, modelsTotalPages);
  const pagedModels = filteredModels.slice(
    (modelsPage - 1) * MODELS_PAGE_SIZE,
    modelsPage * MODELS_PAGE_SIZE,
  );

  const setShowArchived = (value: boolean) => {
    const next = new URLSearchParams(params);
    if (value) next.set('archived', '1');
    else next.delete('archived');
    next.delete('page');
    setParams(next);
  };

  const handleModelSearchChange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    next.delete('page');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const setModelsPage = (value: number) => {
    const next = new URLSearchParams(params);
    if (value > 1) next.set('page', String(value));
    else next.delete('page');
    setParams(next);
  };

  const handleClientFilterChange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('clientId', value);
    else next.delete('clientId');
    next.delete('page');
    setParams(next, { preventScrollReset: true });
  };

  const applyOptimisticModels = useCallback((updater: (prev: Model[]) => Model[]) => {
    setModels(updater);
  }, []);

  const getModelsSnapshot = useCallback(() => modelsRef.current, []);

  return {
    models,
    clients,
    loading,
    error,
    showArchived,
    setShowArchived,
    modelSearch,
    handleModelSearchChange,
    clientFilter,
    handleClientFilterChange,
    modelsPage,
    setModelsPage,
    modelsTotalPages,
    filteredModelsCount: filteredModels.length,
    pagedModels,
    applyOptimisticModels,
    getModelsSnapshot,
  };
};
