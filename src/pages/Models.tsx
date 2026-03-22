import React, { useState, useEffect, useMemo } from 'react';
import { PageHeader, LoadingBlock, EmptyState, ImageThumb, Button } from '../components/ui';
import { subscribeToModels, createModel, updateModel, archiveModel, restoreModel, permanentlyDeleteModel } from '../features/models/firebase';
import { subscribeToClients } from '../features/clients/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { Model, Client } from '../../shared/src/types';
import { isActiveCatalogEntity, isArchivedCatalogEntity } from '../../shared/src/domain';
import { UserSquare2, Plus, Edit2, Trash2, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Image as ImageIcon, Upload, X } from 'lucide-react';

const INPUT_BASE =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';

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

const LocalFileThumb: React.FC<{ file: File; onRemove: () => void }> = ({ file, onRemove }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file]);

  return (
    <div className="aspect-[3/4] relative group rounded-md overflow-hidden border border-gray-200 bg-gray-50">
      {previewUrl ? (
        <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-gray-100" />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 inline-flex items-center justify-center rounded-full bg-white/95 p-1.5 text-red-600 shadow-sm hover:bg-white"
        aria-label={`Quitar ${file.name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
        <p className="truncate text-[11px] text-white">{file.name}</p>
      </div>
    </div>
  );
};

export const Models: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
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
  const [editFilesToAdd, setEditFilesToAdd] = useState<File[]>([]);
  const [editPoseIdsToRemove, setEditPoseIdsToRemove] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelsPage, setModelsPage] = useState(1);

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
        console.error("Error loading clients:", err);
        clientsLoaded = true;
        checkLoading();
      }
    );

    return () => {
      unsubModels();
      unsubClients();
    };
  }, [showArchived]);

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

  const handleRemoveCreateFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStartEdit = (model: Model) => {
    setEditingId(model.id!);
    setEditName(model.name);
    setEditClientId(model.clientId);
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditClientId('');
    setEditFilesToAdd([]);
    setEditPoseIdsToRemove([]);
    setIsSavingEdit(false);
  };

  const handleEditFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    setEditFilesToAdd((current) => [...current, ...Array.from(e.target.files || [])]);
    e.target.value = '';
  };

  const handleRemovePendingEditFile = (indexToRemove: number) => {
    setEditFilesToAdd((current) => current.filter((_, index) => index !== indexToRemove));
  };

  const handleTogglePoseRemoval = (poseId: string) => {
    setEditPoseIdsToRemove((current) =>
      current.includes(poseId)
        ? current.filter((currentPoseId) => currentPoseId !== poseId)
        : [...current, poseId],
    );
  };

  const handleSaveEdit = async (model: Model) => {
    const id = model.id;
    const trimmedName = editName.trim();
    if (!id || !trimmedName || !editClientId) return;

    const remainingPoseCount =
      (model.poses?.filter((pose) => !editPoseIdsToRemove.includes(pose.id)).length || 0) + editFilesToAdd.length;

    if (remainingPoseCount === 0) {
      toast({
        tone: 'warning',
        title: 'El modelo no puede quedarse sin poses',
        description: 'Debes conservar al menos una pose existente o subir una nueva foto antes de guardar.',
      });
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateModel(id, {
        name: trimmedName,
        clientId: editClientId,
        filesToAdd: editFilesToAdd,
        poseIdsToRemove: editPoseIdsToRemove,
      });
      handleCancelEdit();
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos actualizar el modelo',
        description: err.message || 'Revisa los cambios e inténtalo nuevamente.',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleArchive = async (model: Model) => {
    const accepted = await confirm({
      title: 'Archivar modelo',
      description: `Vas a archivar "${model.name}" y retirarlo de los flujos de generación.`,
      impact: 'El modelo deja de estar disponible para nuevos lotes, pero conserva su historial y sus referencias hasta que decidas borrarlo definitivamente.',
      confirmLabel: 'Sí, archivar modelo',
      cancelLabel: 'Mantener activo',
      tone: 'warning',
    });

    if (!accepted || !model.id) {
      return;
    }

    try {
      await archiveModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo archivado',
        description: `"${model.name}" salió de la biblioteca operativa.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos archivar el modelo',
        description: err.message || 'Comprueba si aún tiene dependencias activas e inténtalo otra vez.',
      });
    }
  };

  const handleRestore = async (model: Model) => {
    if (!model.id) return;

    try {
      await restoreModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo reactivado',
        description: `"${model.name}" volvió a la biblioteca operativa.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reactivar el modelo',
        description: err.message || 'Inténtalo otra vez en un momento.',
      });
    }
  };

  const handlePermanentDelete = async (model: Model) => {
    if (!model.id) {
      return;
    }

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${model.name}".`,
      impact: 'Esto elimina el modelo, sus fotos y todos sus datos de forma permanente. No se puede deshacer.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) {
      return;
    }

    const typedName = window.prompt(`Escribe el nombre exacto del modelo para confirmar el borrado permanente:\n${model.name}`);
    if (typedName !== model.name) {
      toast({
        tone: 'warning',
        title: 'Borrado cancelado',
        description: 'El nombre no coincidió. No se eliminó nada.',
      });
      return;
    }

    try {
      await permanentlyDeleteModel(model.id);
      toast({
        tone: 'success',
        title: 'Modelo eliminado definitivamente',
        description: `"${model.name}" se eliminó de forma permanente.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos borrar el modelo definitivamente',
        description: err.message || 'Comprueba dependencias o permisos e inténtalo otra vez.',
      });
    }
  };

  const MODELS_PAGE_SIZE = 12;

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return models;
    return models.filter((m) => m.name.toLowerCase().includes(query));
  }, [models, modelSearch]);

  const modelsTotalPages = Math.max(1, Math.ceil(filteredModels.length / MODELS_PAGE_SIZE));
  const pagedModels = filteredModels.slice((modelsPage - 1) * MODELS_PAGE_SIZE, modelsPage * MODELS_PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Modelos" 
        description="Gestiona los modelos y sus poses (imágenes base) para la generación de catálogo." 
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-8">
        {/* Create Form */}
        <div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              Nuevo modelo
            </h2>
            
            {clients.length === 0 && !loading ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Debes crear al menos un cliente antes de poder registrar un modelo.
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label htmlFor="client" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Cliente
                  </label>
                  <select
                    id="client"
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className={INPUT_BASE}
                    disabled={isCreating}
                  >
                    <option value="">Selecciona un cliente...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="model-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Nombre del modelo
                  </label>
                  <input
                    id="model-name"
                    type="text"
                    required
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    className={INPUT_BASE}
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
                    <div className="mt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Vista previa ({selectedFiles.length})
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {selectedFiles.map((file, index) => (
                          <LocalFileThumb
                            key={`${file.name}-${file.lastModified}-${index}`}
                            file={file}
                            onRemove={() => handleRemoveCreateFile(index)}
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
                  loading={isCreating}
                  disabled={!newModelName.trim() || !selectedClientId || selectedFiles.length === 0}
                  className="w-full justify-center"
                >
                  Guardar modelo
                </Button>
                {createSuccess && (
                  <p className="flex items-center justify-center gap-1.5 text-sm text-emerald-600">
                    <Check className="w-4 h-4" /> Modelo creado con éxito
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        {/* List */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                  <UserSquare2 className="w-5 h-5 text-indigo-600" />
                  Biblioteca de modelos
                  <span className="ml-2 bg-indigo-100 text-indigo-700 py-0.5 px-2.5 rounded-full text-xs font-semibold">
                    {filteredModels.length}
                  </span>
                </h2>
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Mostrar archivados
                </label>
              </div>
              <div className="mt-3">
                <input
                  type="search"
                  value={modelSearch}
                  onChange={(e) => { setModelSearch(e.target.value); setModelsPage(1); }}
                  placeholder="Buscar modelo por nombre..."
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : filteredModels.length === 0 ? (
              <EmptyState
                title="No hay modelos"
                description="Registra tu primer modelo usando el formulario de arriba."
                icon={<UserSquare2 className="w-6 h-6" />}
              />
            ) : (
              <ul className="divide-y divide-gray-200">
                {pagedModels.map((model) => {
                  const isEditing = editingId === model.id;
                  const isExpanded = expandedId === model.id;
                  const hasPoses = model.poses && model.poses.length > 0;

                  return (
                    <li key={model.id} className="hover:bg-gray-50 transition-colors">
                      <div className="p-4 sm:px-6">
                        {isArchivedCatalogEntity(model) && (
                          <div className="mb-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                            Archivado
                          </div>
                        )}

                        {/* Edit form — full width when active */}
                        {isEditing ? (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                placeholder="Nombre del modelo"
                              />
                              <select
                                value={editClientId}
                                onChange={(e) => setEditClientId(e.target.value)}
                                className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              >
                                {clients.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Poses grid with remove controls */}
                            {hasPoses && (
                              <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                  Poses ({model.poses.length})
                                </h4>
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {model.poses.map(pose => (
                                    <div
                                      key={pose.id}
                                      className={`aspect-[3/4] relative group rounded-md overflow-hidden bg-white ${editPoseIdsToRemove.includes(pose.id) ? 'opacity-40' : ''}`}
                                    >
                                      <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                                      <div className="absolute inset-0 rounded-md bg-black/0 transition-colors group-hover:bg-black/10" />
                                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-2 rounded-b-md">
                                        <p className="truncate text-[11px] text-white">{pose.fileName}</p>
                                        {editPoseIdsToRemove.includes(pose.id) && (
                                          <p className="mt-1 text-[11px] font-medium text-amber-200">Se eliminará al guardar</p>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleTogglePoseRemoval(pose.id)}
                                        className={`absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium shadow-sm ${
                                          editPoseIdsToRemove.includes(pose.id)
                                            ? 'bg-white text-gray-700'
                                            : 'bg-red-600 text-white hover:bg-red-700'
                                        }`}
                                      >
                                        {editPoseIdsToRemove.includes(pose.id) ? 'Deshacer' : 'Quitar'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h4 className="text-sm font-medium text-gray-900">Agregar fotos</h4>
                                  <p className="mt-1 text-xs text-gray-500">Las nuevas poses se subirán cuando guardes el modelo.</p>
                                </div>
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">
                                  <Upload className="w-3.5 h-3.5" />
                                  Subir fotos
                                  <input type="file" multiple accept="image/*" className="sr-only" onChange={handleEditFileChange} disabled={isSavingEdit} />
                                </label>
                              </div>
                              {editFilesToAdd.length > 0 && (
                                <div className="mt-4">
                                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Nuevas fotos ({editFilesToAdd.length})
                                  </p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {editFilesToAdd.map((file, index) => (
                                      <LocalFileThumb
                                        key={`${file.name}-${file.lastModified}-${index}`}
                                        file={file}
                                        onRemove={() => handleRemovePendingEditFile(index)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {editPoseIdsToRemove.length > 0 && (
                              <p className="text-xs text-amber-600">
                                {editPoseIdsToRemove.length} pose{editPoseIdsToRemove.length === 1 ? '' : 's'} marcada
                                {editPoseIdsToRemove.length === 1 ? '' : 's'} para eliminar al guardar.
                              </p>
                            )}

                            <div className="flex items-center gap-2">
                              <Button variant="primary" size="sm" loading={isSavingEdit} onClick={() => void handleSaveEdit(model)}>
                                Guardar
                              </Button>
                              <Button variant="ghost" size="sm" disabled={isSavingEdit} onClick={handleCancelEdit}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Main row: info left, actions + poses toggle right */}
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-indigo-600 truncate">{model.name}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                  <span>Cliente: {model.clientNameSnapshot}</span>
                                  <span className="flex items-center gap-1">
                                    <ImageIcon className="w-3 h-3" /> {model.poseCount || 0} poses
                                  </span>
                                  <span>Alta: {formatDate(model.createdAt)}</span>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                {!isArchivedCatalogEntity(model) ? (
                                  <>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={Edit2}
                                      onClick={() => { handleStartEdit(model); setExpandedId(model.id!); }}
                                    >
                                      Editar
                                    </Button>
                                    <Button variant="warning" size="sm" icon={Trash2} onClick={() => void handleArchive(model)}>
                                      Archivar
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void handleRestore(model)}
                                      className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                    >
                                      Reactivar
                                    </Button>
                                    <Button variant="danger" size="sm" icon={Trash2} onClick={() => void handlePermanentDelete(model)}>
                                      Borrar definitivo
                                    </Button>
                                  </>
                                )}

                                {hasPoses && (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : model.id!)}
                                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    title={isExpanded ? 'Ocultar poses' : 'Ver poses'}
                                  >
                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expanded: poses grid (view-only) */}
                            {isExpanded && hasPoses && (
                              <div className="mt-4 border-t border-gray-100 pt-4">
                                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                  Poses ({model.poses.length})
                                </h4>
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                  {model.poses.map(pose => (
                                    <div key={pose.id} className="aspect-[3/4] relative group rounded-md overflow-hidden bg-white">
                                      <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {modelsTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <button
                  onClick={() => setModelsPage((p) => Math.max(1, p - 1))}
                  disabled={modelsPage === 1}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Página {modelsPage} de {modelsTotalPages}
                </span>
                <button
                  onClick={() => setModelsPage((p) => Math.min(modelsTotalPages, p + 1))}
                  disabled={modelsPage === modelsTotalPages}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
