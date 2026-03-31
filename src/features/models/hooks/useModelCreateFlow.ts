import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { CreateTab } from '../types';
import { ModelCreateFlowAiState, useAiWizard } from './useAiWizard';
import {
  ModelCreateFlowReferenceState,
  useReferenceModelFlow,
} from './useReferenceModelFlow';
import { ModelCreateFlowUploadState, useModelUploadFlow } from './useModelUploadFlow';

export type { ModelCreateFlowAiState } from './useAiWizard';
export type { ModelCreateFlowReferenceState } from './useReferenceModelFlow';
export type { ModelCreateFlowUploadState } from './useModelUploadFlow';

type SetState<T> = Dispatch<SetStateAction<T>>;

export interface ModelCreateFlowSharedState {
  createTab: CreateTab;
  setCreateTab: SetState<CreateTab>;
  newModelName: string;
  setNewModelName: SetState<string>;
  selectedClientId: string;
  setSelectedClientId: SetState<string>;
  isCreating: boolean;
  createSuccess: boolean;
  inputsDisabled: boolean;
  error: string | null;
}

export interface UseModelCreateFlowResult {
  shared: ModelCreateFlowSharedState;
  upload: ModelCreateFlowUploadState;
  ai: ModelCreateFlowAiState;
  reference: ModelCreateFlowReferenceState;
}

export const useModelCreateFlow = (): UseModelCreateFlowResult => {
  const [createTab, setCreateTab] = useState<CreateTab>('upload');
  const [newModelName, setNewModelName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [createSuccess, setCreateSuccess] = useState(false);

  const showCreateSuccess = useCallback(() => {
    setCreateSuccess(true);
    window.setTimeout(() => setCreateSuccess(false), 3000);
  }, []);

  const {
    upload,
    isCreating: uploadCreating,
    error,
  } = useModelUploadFlow({
    newModelName,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    onSuccess: showCreateSuccess,
  });

  const { ai, isCreating: aiCreating } = useAiWizard({
    newModelName,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    onSuccess: showCreateSuccess,
  });

  const {
    reference,
    isCreating: referenceCreating,
    error: referenceError,
  } = useReferenceModelFlow({
    newModelName,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    onSuccess: showCreateSuccess,
  });

  const isCreating = uploadCreating || aiCreating || referenceCreating;

  return {
    shared: {
      createTab,
      setCreateTab,
      newModelName,
      setNewModelName,
      selectedClientId,
      setSelectedClientId,
      isCreating,
      createSuccess,
      inputsDisabled: isCreating || ai.busy || reference.busy,
      error: error || referenceError,
    },
    upload,
    ai,
    reference,
  };
};
