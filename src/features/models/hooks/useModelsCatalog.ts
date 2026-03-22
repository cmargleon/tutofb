import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useLocation } from 'react-router-dom';
import { Client, Model } from '../../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../../shared/src/domain';
import { subscribeToClients } from '../../clients/firebase';
import { subscribeToModels } from '../firebase';

const MODELS_PAGE_SIZE = 12;

export interface UseModelsCatalogResult {
  models: Model[];
  clients: Client[];
  loading: boolean;
  error: string | null;
  showArchived: boolean;
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  modelSearch: string;
  handleModelSearchChange: (value: string) => void;
  modelsPage: number;
  setModelsPage: Dispatch<SetStateAction<number>>;
  modelsTotalPages: number;
  filteredModelsCount: number;
  pagedModels: Model[];
  highlightedModelId: string | null;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}

export const useModelsCatalog = (): UseModelsCatalogResult => {
  const location = useLocation();
  const [models, setModels] = useState<Model[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelsPage, setModelsPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

    const unsubModels = subscribeToModels(
      (data) => {
        setModels(data);
        modelsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error('Error loading models:', err);
        setError('Error al cargar los modelos.');
        modelsLoaded = true;
        checkLoading();
      },
      { includeArchived: showArchived },
    );

    const unsubClients = subscribeToClients(
      (data) => {
        setClients(data.filter(isActiveCatalogEntity));
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
  }, [showArchived]);

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;

    return models.filter((model) => model.name.toLowerCase().includes(query));
  }, [models, modelSearch]);

  const modelsTotalPages = Math.max(1, Math.ceil(filteredModels.length / MODELS_PAGE_SIZE));
  const pagedModels = filteredModels.slice(
    (modelsPage - 1) * MODELS_PAGE_SIZE,
    modelsPage * MODELS_PAGE_SIZE,
  );
  const highlightedModelId = location.hash.startsWith('#model-')
    ? location.hash.slice('#model-'.length)
    : null;

  useEffect(() => {
    if (modelsPage > modelsTotalPages) {
      setModelsPage(modelsTotalPages);
    }
  }, [modelsPage, modelsTotalPages]);

  useEffect(() => {
    if (!highlightedModelId) return;

    const targetIndex = models.findIndex((model) => model.id === highlightedModelId);
    if (targetIndex < 0) return;

    if (modelSearch) {
      setModelSearch('');
    }

    if (modelsPage !== Math.floor(targetIndex / MODELS_PAGE_SIZE) + 1) {
      setModelsPage(Math.floor(targetIndex / MODELS_PAGE_SIZE) + 1);
    }

    setExpandedId(highlightedModelId);

    const scrollTarget = () => {
      const element = document.getElementById(`model-${highlightedModelId}`);
      if (!element) return false;

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };

    if (scrollTarget()) return;

    const timeoutId = window.setTimeout(() => {
      scrollTarget();
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [highlightedModelId, modelSearch, models, modelsPage]);

  const handleModelSearchChange = (value: string) => {
    setModelSearch(value);
    setModelsPage(1);
  };

  return {
    models,
    clients,
    loading,
    error,
    showArchived,
    setShowArchived,
    modelSearch,
    handleModelSearchChange,
    modelsPage,
    setModelsPage,
    modelsTotalPages,
    filteredModelsCount: filteredModels.length,
    pagedModels,
    highlightedModelId,
    expandedId,
    setExpandedId,
  };
};
