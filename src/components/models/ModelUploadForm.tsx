import React from 'react';
import { Check, Upload } from 'lucide-react';
import { Button } from '../ui';
import {
  ModelCreateFlowSharedState,
  ModelCreateFlowUploadState,
} from '../../features/models/hooks/useModelCreateFlow';
import { LocalFileThumb } from './LocalFileThumb';

interface ModelUploadFormProps {
  shared: ModelCreateFlowSharedState;
  upload: ModelCreateFlowUploadState;
}

export const ModelUploadForm: React.FC<ModelUploadFormProps> = ({ shared, upload }) => (
  <form onSubmit={(event) => void upload.handleCreate(event)} className="space-y-4">
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Fotos del modelo (Poses)
      </label>
      <div className="mt-1 flex justify-center rounded-md border-2 border-dashed border-gray-300 px-6 pb-6 pt-5">
        <div className="space-y-1 text-center">
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <div className="flex justify-center text-sm text-gray-600">
            <label
              htmlFor="file-upload"
              className="relative cursor-pointer rounded-md bg-white font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2"
            >
              <span>Subir imágenes</span>
              <input
                id="file-upload"
                name="file-upload"
                type="file"
                multiple
                accept="image/*"
                className="sr-only"
                onChange={upload.handleFileChange}
                disabled={shared.isCreating}
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">PNG, JPG hasta 10MB</p>
        </div>
      </div>

      {upload.selectedFiles.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Vista previa ({upload.selectedFiles.length})
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {upload.selectedFiles.map((file, index) => (
              <LocalFileThumb
                key={`${file.name}-${file.lastModified}-${index}`}
                file={file}
                onRemove={() => upload.handleRemoveCreateFile(index)}
              />
            ))}
          </div>
        </div>
      )}
    </div>

    <Button
      type="submit"
      variant="primary"
      size="md"
      loading={shared.isCreating}
      disabled={!upload.canSubmit}
      className="w-full justify-center"
    >
      Guardar modelo
    </Button>

    {shared.createSuccess && (
      <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
        <Check className="h-4 w-4" /> Modelo creado con éxito
      </p>
    )}
  </form>
);
