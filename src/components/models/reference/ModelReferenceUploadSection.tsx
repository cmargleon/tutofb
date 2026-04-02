import React, { type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import { LocalFileThumb } from '../LocalFileThumb';

interface ModelReferenceUploadSectionProps {
  referenceFile: File | null;
  busy: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

export const ModelReferenceUploadSection: React.FC<ModelReferenceUploadSectionProps> = ({
  referenceFile,
  busy,
  onFileChange,
  onRemove,
}) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-gray-700">
      Foto base del modelo
    </label>
    <p className="mb-3 text-xs text-gray-500">
      Sube una foto de frente y de cuerpo entero. La usaremos como referencia para conservar o aproximar la identidad.
    </p>
    <div className="mt-1 flex justify-center rounded-md border-2 border-dashed border-gray-300 px-6 pb-6 pt-5">
      <div className="space-y-1 text-center">
        <Upload className="mx-auto h-12 w-12 text-gray-400" />
        <div className="flex justify-center text-sm text-gray-600">
          <label
            htmlFor="reference-upload"
            className="relative cursor-pointer rounded-md bg-white font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2"
          >
            <span>Subir foto base</span>
            <input
              id="reference-upload"
              name="reference-upload"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={onFileChange}
              disabled={busy}
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">PNG o JPG. Solo una imagen.</p>
      </div>
    </div>

    {referenceFile ? (
      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Referencia actual
        </p>
        <div className="grid max-w-[11rem] grid-cols-1 gap-2">
          <LocalFileThumb file={referenceFile} onRemove={onRemove} />
        </div>
      </div>
    ) : null}
  </div>
);
