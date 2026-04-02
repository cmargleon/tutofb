import React from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '../ui';
import { INPUT_BASE } from './clientUtils';

interface ClientCreateFormProps {
  newClientName: string;
  setNewClientName: (v: string) => void;
  newClientPrompt: string;
  setNewClientPrompt: (v: string) => void;
  isCreating: boolean;
  createSuccess: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const ClientCreateForm: React.FC<ClientCreateFormProps> = ({
  newClientName, setNewClientName,
  newClientPrompt, setNewClientPrompt,
  isCreating, createSuccess, onSubmit,
}) => (
  <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
    <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900">
      <Plus className="w-4 h-4 text-indigo-600" />
      Nuevo cliente
    </h2>
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="client-name" className="mb-1.5 block text-sm font-medium text-gray-700">
          Nombre del cliente
        </label>
        <input
          id="client-name"
          type="text"
          required
          value={newClientName}
          onChange={(e) => setNewClientName(e.target.value)}
          className={INPUT_BASE}
          placeholder="Ej. Zara, H&M..."
          disabled={isCreating}
        />
      </div>
      <div>
        <label htmlFor="client-prompt" className="mb-1.5 block text-sm font-medium text-gray-700">
          Prompt general del cliente
        </label>
        <textarea
          id="client-prompt"
          rows={7}
          value={newClientPrompt}
          onChange={(e) => setNewClientPrompt(e.target.value)}
          className={INPUT_BASE}
          placeholder="Opcional. Si lo dejas vacío, este cliente usará el prompt global por defecto de Configuración."
          disabled={isCreating}
        />
        <p className="mt-1.5 text-xs text-slate-500">
          Este texto se precarga en el wizard cuando se selecciona el cliente.
        </p>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isCreating}
        disabled={!newClientName.trim()}
        className="w-full justify-center"
      >
        Guardar cliente
      </Button>
      {createSuccess && (
        <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
          <Check className="w-4 h-4" />
          Cliente creado con éxito
        </p>
      )}
    </form>
  </div>
);
