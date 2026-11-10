import React from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, CardHeader, Surface } from '../ui';
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
  <Surface className="overflow-hidden">
    <CardHeader icon={Plus} title="Nuevo cliente" description="Podrás configurar marketplaces, fuentes y automatizaciones desde su ficha." />
    <form onSubmit={onSubmit} className="space-y-4 p-5">
      <div>
        <label htmlFor="client-name" className="tuto-label mb-1.5 block">
          Nombre del cliente
        </label>
        <input
          id="client-name"
          type="text"
          required
          value={newClientName}
          onChange={(e) => setNewClientName(e.target.value)}
          className={INPUT_BASE}
          placeholder="Nombre comercial o razón social"
          disabled={isCreating}
        />
      </div>
      <div>
        <label htmlFor="client-prompt" className="tuto-label mb-1.5 block">
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
        <p className="tuto-hint mt-1.5">
          Este texto se precarga en el wizard cuando se selecciona el cliente.
        </p>
      </div>
      <Button
        type="submit"
        variant="primary"
        size="md"
        loading={isCreating}
        disabled={!newClientName.trim()}
        className="w-full justify-center sm:w-auto"
      >
        Guardar cliente
      </Button>
      {createSuccess && (
        <p role="status" className="tuto-alert tuto-alert--success">
          <Check className="w-4 h-4" />
          Cliente creado con éxito
        </p>
      )}
    </form>
  </Surface>
);
