import React, { useState, useEffect } from 'react';
import { PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { subscribeToClients, createClient, updateClient, archiveClient, restoreClient, permanentlyDeleteClient } from '../features/clients/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { isArchivedCatalogEntity } from '../../shared/src/domain';
import { Client } from '../../shared/src/types';
import { Users, Plus, Edit2, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

const formatDate = (timestamp: any) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

export const Clients: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create state
  const [newClientName, setNewClientName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (data) => {
        setClients(data);
        setLoading(false);
      },
      (err) => {
        console.error("Error subscribing to clients:", err);
        setError("Error al cargar los clientes.");
        setLoading(false);
      },
      { includeArchived: showArchived },
    );
    return () => unsubscribe();
  }, [showArchived]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newClientName.trim();
    if (!trimmedName) return;

    setIsCreating(true);
    setError(null);
    setCreateSuccess(false);

    try {
      await createClient(trimmedName);
      setNewClientName('');
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al crear cliente');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (client: Client) => {
    setEditingId(client.id!);
    setEditName(client.name);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) return;

    try {
      await updateClient(id, trimmedName);
      setEditingId(null);
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos actualizar el cliente',
        description: err.message || 'Vuelve a intentarlo en un momento.',
      });
    }
  };

  const handleArchive = async (client: Client) => {
    const accepted = await confirm({
      title: 'Archivar cliente',
      description: `Vas a archivar "${client.name}" y sacarlo del catálogo operativo.`,
      impact: 'El cliente dejará de aparecer en los flujos de generación. Su historial se conserva y podrás restaurarlo después.',
      confirmLabel: 'Sí, archivar cliente',
      cancelLabel: 'Mantener activo',
      tone: 'warning',
    });

    if (!accepted || !client.id) {
      return;
    }

    try {
      await archiveClient(client.id);
      toast({
        tone: 'success',
        title: 'Cliente archivado',
        description: `"${client.name}" salió del catálogo operativo pero su historial sigue disponible.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos archivar el cliente',
        description: err.message || 'Inténtalo de nuevo en un momento.',
      });
    }
  };

  const handleRestore = async (client: Client) => {
    if (!client.id) return;

    try {
      await restoreClient(client.id);
      toast({
        tone: 'success',
        title: 'Cliente reactivado',
        description: `"${client.name}" volvió al catálogo operativo.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reactivar el cliente',
        description: err.message || 'Inténtalo de nuevo en un momento.',
      });
    }
  };

  const handlePermanentDelete = async (client: Client) => {
    if (!client.id) {
      return;
    }

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${client.name}".`,
      impact: 'Esto elimina el cliente de Firestore y dispara la limpieza en Firebase. Úsalo solo cuando estés completamente seguro.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) {
      return;
    }

    const typedName = window.prompt(`Escribe el nombre exacto del cliente para confirmar el borrado permanente:\n${client.name}`);
    if (typedName !== client.name) {
      toast({
        tone: 'warning',
        title: 'Borrado cancelado',
        description: 'El nombre no coincidió. No se eliminó nada.',
      });
      return;
    }

    try {
      await permanentlyDeleteClient(client.id);
      toast({
        tone: 'success',
        title: 'Cliente eliminado definitivamente',
        description: `"${client.name}" se borró de Firebase de forma permanente.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos borrar el cliente definitivamente',
        description: err.message || 'Revisa dependencias o permisos e inténtalo de nuevo.',
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader 
        title="Clientes" 
        description="Gestiona los clientes para los que generarás imágenes de catálogo." 
      />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Create Form */}
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 sticky top-8">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              Nuevo cliente
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del cliente
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Ej. Zara, H&M..."
                  disabled={isCreating}
                />
              </div>
              <button
                type="submit"
                disabled={isCreating || !newClientName.trim()}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {isCreating ? 'Guardando...' : 'Guardar cliente'}
              </button>
              {createSuccess && (
                <p className="text-sm text-green-600 text-center flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> Cliente creado con éxito
                </p>
              )}
            </form>
          </div>
        </div>

        {/* Right Column: List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Lista de clientes
                <span className="ml-2 bg-indigo-100 text-indigo-700 py-0.5 px-2.5 rounded-full text-xs font-semibold">
                  {clients.length}
                </span>
              </h2>
              <div className="mt-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Mostrar archivados
                </label>
              </div>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : clients.length === 0 ? (
              <EmptyState 
                title="No hay clientes" 
                description="Crea tu primer cliente usando el formulario de la izquierda."
                icon={<Users className="w-6 h-6" />}
              />
            ) : (
              <ul className="divide-y divide-gray-200">
                {clients.map((client) => (
                  <li key={client.id} className="hover:bg-gray-50 transition-colors">
                    <div className="p-4 sm:px-6">
                      {isArchivedCatalogEntity(client) && (
                        <div className="mb-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                          Archivado
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div 
                          className="flex-1 cursor-pointer flex items-center gap-3"
                          onClick={() => setExpandedId(expandedId === client.id ? null : client.id!)}
                        >
                          {expandedId === client.id ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-indigo-600 truncate">{client.name}</p>
                            <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                              <span>ID: {client.id}</span>
                              <span>•</span>
                              <span>Alta: {formatDate(client.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {expandedId === client.id && (
                        <div className="mt-4 pt-4 border-t border-gray-100 pl-8">
                          {editingId === client.id ? (
                            <div className="flex items-center gap-3">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveEdit(client.id!)}
                                className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                              >
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              {!isArchivedCatalogEntity(client) ? (
                                <>
                                  <button
                                    onClick={() => handleStartEdit(client)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-xs font-medium rounded shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                    Editar
                                  </button>
                                  <button
                                    onClick={() => handleArchive(client)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-amber-800 bg-amber-100 hover:bg-amber-200"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Archivar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleRestore(client)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-emerald-700 bg-emerald-100 hover:bg-emerald-200"
                                  >
                                    Reactivar
                                  </button>
                                  <button
                                    onClick={() => handlePermanentDelete(client)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-red-700 bg-red-100 hover:bg-red-200"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Borrar definitivo
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
