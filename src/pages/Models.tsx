import React, { useState, useEffect } from 'react';
import { PageHeader, LoadingBlock, EmptyState, ImageThumb } from '../components/ui';
import { subscribeToModels, createModel, updateModel, deleteModel } from '../features/models/firebase';
import { subscribeToClients } from '../features/clients/firebase';
import { Model, Client } from '../../shared/src/types';
import { UserSquare2, Plus, Edit2, Trash2, Check, ChevronDown, ChevronUp, Image as ImageIcon, Upload } from 'lucide-react';

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

export const Models: React.FC = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Create state
  const [newModelName, setNewModelName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let modelsLoaded = false;
    let clientsLoaded = false;

    const checkLoading = () => {
      if (modelsLoaded && clientsLoaded) setLoading(false);
    };

    const unsubModels = subscribeToModels(
      (data) => {
        setModels(data);
        modelsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading models:", err);
        setError("Error al cargar los modelos.");
        modelsLoaded = true;
        checkLoading();
      }
    );

    const unsubClients = subscribeToClients(
      (data) => {
        setClients(data);
        clientsLoaded = true;
        checkLoading();
      },
      (err) => {
        console.error("Error loading clients:", err);
        clientsLoaded = true;
        checkLoading();
      }
    );

    return () => {
      unsubModels();
      unsubClients();
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId || selectedFiles.length === 0) return;

    setIsCreating(true);
    setError(null);
    setCreateSuccess(false);

    try {
      await createModel(selectedClientId, trimmedName, selectedFiles);
      setNewModelName('');
      setSelectedClientId('');
      setSelectedFiles([]);
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al crear modelo');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (model: Model) => {
    setEditingId(model.id!);
    setEditName(model.name);
    setEditClientId(model.clientId);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName || !editClientId) return;

    try {
      await updateModel(id, trimmedName, editClientId);
      setEditingId(null);
    } catch (err: any) {
      alert(err.message || 'Error al actualizar modelo');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('¿Estás seguro de eliminar este modelo? Esto eliminará sus poses y puede afectar trabajos asociados.')) {
      try {
        await deleteModel(id);
      } catch (err: any) {
        alert(err.message || 'Error al eliminar modelo');
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader 
        title="Modelos" 
        description="Gestiona los modelos y sus poses (imágenes base) para la generación de catálogo." 
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
              Nuevo modelo
            </h2>
            
            {clients.length === 0 && !loading ? (
              <div className="p-4 bg-yellow-50 text-yellow-800 rounded-md text-sm">
                Debes crear al menos un cliente antes de poder registrar un modelo.
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label htmlFor="client" className="block text-sm font-medium text-gray-700 mb-1">
                    Cliente
                  </label>
                  <select
                    id="client"
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                    disabled={isCreating}
                  >
                    <option value="">Selecciona un cliente...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre del modelo
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Ej. Modelo Femenino 1"
                    disabled={isCreating}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fotos del modelo (Poses)
                  </label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                    <div className="space-y-1 text-center">
                      <Upload className="mx-auto h-12 w-12 text-gray-400" />
                      <div className="flex text-sm text-gray-600 justify-center">
                        <label
                          htmlFor="file-upload"
                          className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500"
                        >
                          <span>Subir imágenes</span>
                          <input
                            id="file-upload"
                            name="file-upload"
                            type="file"
                            multiple
                            accept="image/*"
                            className="sr-only"
                            onChange={handleFileChange}
                            disabled={isCreating}
                          />
                        </label>
                      </div>
                      <p className="text-xs text-gray-500">PNG, JPG hasta 10MB</p>
                    </div>
                  </div>
                  {selectedFiles.length > 0 && (
                    <p className="mt-2 text-sm text-gray-600">
                      {selectedFiles.length} archivo(s) seleccionado(s)
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isCreating || !newModelName.trim() || !selectedClientId || selectedFiles.length === 0}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {isCreating ? 'Subiendo y guardando...' : 'Guardar modelo'}
                </button>
                {createSuccess && (
                  <p className="text-sm text-green-600 text-center flex items-center justify-center gap-1">
                    <Check className="w-4 h-4" /> Modelo creado con éxito
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Right Column: List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                <UserSquare2 className="w-5 h-5 text-indigo-600" />
                Biblioteca de modelos
                <span className="ml-2 bg-indigo-100 text-indigo-700 py-0.5 px-2.5 rounded-full text-xs font-semibold">
                  {models.length}
                </span>
              </h2>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : models.length === 0 ? (
              <EmptyState 
                title="No hay modelos" 
                description="Registra tu primer modelo usando el formulario de la izquierda."
                icon={<UserSquare2 className="w-6 h-6" />}
              />
            ) : (
              <ul className="divide-y divide-gray-200">
                {models.map((model) => (
                  <li key={model.id} className="hover:bg-gray-50 transition-colors">
                    <div className="p-4 sm:px-6">
                      <div className="flex items-center justify-between">
                        <div 
                          className="flex-1 cursor-pointer flex items-center gap-3"
                          onClick={() => setExpandedId(expandedId === model.id ? null : model.id!)}
                        >
                          {expandedId === model.id ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-indigo-600 truncate">{model.name}</p>
                            <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                              <span>Cliente: {model.clientNameSnapshot}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> {model.poseCount || 0} poses</span>
                              <span>•</span>
                              <span>Alta: {formatDate(model.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {expandedId === model.id && (
                        <div className="mt-4 pt-4 border-t border-gray-100 pl-8">
                          {editingId === model.id ? (
                            <div className="flex flex-col gap-3 mb-4">
                              <div className="flex items-center gap-3">
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                                  placeholder="Nombre del modelo"
                                />
                                <select
                                  value={editClientId}
                                  onChange={(e) => setEditClientId(e.target.value)}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                                >
                                  {clients.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handleSaveEdit(model.id!)}
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
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 mb-4">
                              <button
                                onClick={() => handleStartEdit(model)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-xs font-medium rounded shadow-sm text-gray-700 bg-white hover:bg-gray-50"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                Editar
                              </button>
                              <button
                                onClick={() => handleDelete(model.id!)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-red-700 bg-red-100 hover:bg-red-200"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Eliminar
                              </button>
                            </div>
                          )}

                          {/* Poses Grid */}
                          {model.poses && model.poses.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Poses ({model.poses.length})</h4>
                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                {model.poses.map(pose => (
                                  <div key={pose.id} className="aspect-[3/4] relative group">
                                    <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity rounded-md" />
                                  </div>
                                ))}
                              </div>
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
