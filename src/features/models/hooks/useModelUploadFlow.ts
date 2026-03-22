import { useState, type ChangeEvent, type FormEvent } from 'react';
import { createModel } from '../firebase';

interface UseModelUploadFlowParams {
  newModelName: string;
  selectedClientId: string;
  setNewModelName: (value: string) => void;
  setSelectedClientId: (value: string) => void;
  onSuccess: () => void;
}

export interface ModelCreateFlowUploadState {
  selectedFiles: File[];
  canSubmit: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleCreate: (event: FormEvent) => Promise<void>;
  handleRemoveCreateFile: (index: number) => void;
}

export interface UseModelUploadFlowResult {
  upload: ModelCreateFlowUploadState;
  isCreating: boolean;
  error: string | null;
}

export const useModelUploadFlow = ({
  newModelName,
  selectedClientId,
  setNewModelName,
  setSelectedClientId,
  onSuccess,
}: UseModelUploadFlowParams): UseModelUploadFlowResult => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setSelectedFiles(Array.from(event.target.files));
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId || selectedFiles.length === 0) return;

    setIsCreating(true);
    setError(null);
    try {
      await createModel(selectedClientId, trimmedName, selectedFiles);
      setNewModelName('');
      setSelectedClientId('');
      setSelectedFiles([]);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Error al crear modelo');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveCreateFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  };

  return {
    upload: {
      selectedFiles,
      canSubmit: Boolean(newModelName.trim() && selectedClientId && selectedFiles.length > 0),
      handleFileChange,
      handleCreate,
      handleRemoveCreateFile,
    },
    isCreating,
    error,
  };
};
