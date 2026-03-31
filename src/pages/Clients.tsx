import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader, LoadingBlock, EmptyState, Button } from '../components/ui';
import {
  subscribeToClients,
  subscribeToSpreadsheetTemplates,
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  permanentlyDeleteClient,
  importClientSpreadsheetTemplate,
  updateClientSpreadsheetTemplateCategory,
} from '../features/clients/firebase';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { isArchivedCatalogEntity } from '../../shared/src/domain';
import { Client, SpreadsheetTemplate } from '../../shared/src/types';
import { Users, Plus, Edit2, Trash2, Check, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Sheet } from 'lucide-react';

import { formatDateTimeLong as formatDate } from '../../shared/src/utils/dateUtils';

const INPUT_BASE =
  'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400';

const summarizePrompt = (prompt: string | null | undefined): string | null => {
  const trimmed = prompt?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
};

export const Clients: React.FC = () => {
  const location = useLocation();
  const toast = useToast();
  const confirm = useConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newClientName, setNewClientName] = useState('');
  const [newClientPrompt, setNewClientPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsPage, setClientsPage] = useState(1);
  const [uploadingTemplateClientId, setUploadingTemplateClientId] = useState<string | null>(null);
  const [savingTemplateCategoryId, setSavingTemplateCategoryId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (data) => {
        setClients(data);
        setLoading(false);
      },
      (err) => {
        console.error('Error subscribing to clients:', err);
        setError('Error al cargar los clientes.');
        setLoading(false);
      },
      { includeArchived: showArchived },
    );
    return () => unsubscribe();
  }, [showArchived]);

  useEffect(() => {
    const unsubscribe = subscribeToSpreadsheetTemplates(
      (data) => setTemplates(data),
      (err) => {
        console.error('Error subscribing to spreadsheet templates:', err);
      },
    );

    return () => unsubscribe();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newClientName.trim();
    if (!trimmedName) return;

    setIsCreating(true);
    setError(null);
    setCreateSuccess(false);

    try {
      await createClient(trimmedName, newClientPrompt);
      setNewClientName('');
      setNewClientPrompt('');
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
    setEditPrompt(client.generationPromptBase ?? '');
  };

  const handleSaveEdit = async (id: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) return;

    try {
      await updateClient(id, trimmedName, editPrompt);
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

    if (!accepted || !client.id) return;

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
    if (!client.id) return;

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${client.name}".`,
      impact: 'Esto elimina todos los datos del cliente de forma permanente. No se puede deshacer.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) return;

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
        description: `"${client.name}" se eliminó de forma permanente.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos borrar el cliente definitivamente',
        description: err.message || 'Revisa dependencias o permisos e inténtalo de nuevo.',
      });
    }
  };

  const CLIENTS_PAGE_SIZE = 20;
  const templatesByClientId = useMemo(
    () =>
      templates.reduce<Record<string, SpreadsheetTemplate[]>>((accumulator, template) => {
        if (!template.clientId) {
          return accumulator;
        }

        accumulator[template.clientId] = [...(accumulator[template.clientId] || []), template];
        return accumulator;
      }, {}),
    [templates],
  );

  const sortedTemplatesByClientId = useMemo(
    () =>
      Object.keys(templatesByClientId).reduce<Record<string, SpreadsheetTemplate[]>>((accumulator, clientId) => {
        const clientTemplates = templatesByClientId[clientId] || [];
        accumulator[clientId] = [...clientTemplates].sort((left, right) => {
          const leftName = left.name?.toLowerCase() || '';
          const rightName = right.name?.toLowerCase() || '';
          return leftName.localeCompare(rightName, 'es');
        });
        return accumulator;
      }, {}),
    [templatesByClientId],
  );

  const handleTemplateUpload = async (client: Client, file: File | null) => {
    if (!file || !client.id) return;

    setUploadingTemplateClientId(client.id);
    try {
      const result = await importClientSpreadsheetTemplate(client.id, file);
      toast({
        tone: 'success',
        title: 'Spreadsheet importado',
        description: `"${file.name}" quedó vinculado a ${client.name} con ${result.categoryCount} categoría${result.categoryCount === 1 ? '' : 's'}.`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos importar el spreadsheet',
        description: err.message || 'Revisa el archivo y vuelve a intentarlo.',
      });
    } finally {
      setUploadingTemplateClientId(null);
    }
  };

  const handleTemplateCategoryChange = async (
    client: Client,
    template: SpreadsheetTemplate,
    categoryId: string | null,
  ) => {
    if (!client.id || !template.id) {
      return;
    }

    setSavingTemplateCategoryId(template.id);
    try {
      await updateClientSpreadsheetTemplateCategory(client.id, template.id, categoryId);
      toast({
        tone: 'success',
        title: 'Categoría por defecto actualizada',
        description: categoryId
          ? `El wizard usará la categoría elegida para "${template.name}" por defecto.`
          : `Se limpió la categoría por defecto de "${template.name}".`,
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No pudimos actualizar la categoría por defecto',
        description: err.message || 'Vuelve a intentarlo en un momento.',
      });
    } finally {
      setSavingTemplateCategoryId(null);
    }
  };

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(query));
  }, [clients, clientSearch]);

  const clientsTotalPages = Math.max(1, Math.ceil(filteredClients.length / CLIENTS_PAGE_SIZE));
  const pagedClients = filteredClients.slice((clientsPage - 1) * CLIENTS_PAGE_SIZE, clientsPage * CLIENTS_PAGE_SIZE);
  const highlightedClientId = location.hash.startsWith('#client-') ? location.hash.slice('#client-'.length) : null;

  useEffect(() => {
    if (!highlightedClientId) return;

    const targetIndex = clients.findIndex((client) => client.id === highlightedClientId);
    if (targetIndex < 0) return;

    if (clientSearch) {
      setClientSearch('');
    }

    if (clientsPage !== Math.floor(targetIndex / CLIENTS_PAGE_SIZE) + 1) {
      setClientsPage(Math.floor(targetIndex / CLIENTS_PAGE_SIZE) + 1);
    }

    setExpandedId(highlightedClientId);

    const scrollTarget = () => {
      const element = document.getElementById(`client-${highlightedClientId}`);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };

    if (scrollTarget()) return;

    const timeoutId = window.setTimeout(() => {
      scrollTarget();
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [clientSearch, clients, clientsPage, highlightedClientId]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Clientes"
        description="Gestiona los clientes para los que generarás imágenes de catálogo."
        icon={Users}
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-8">
        {/* Create form */}
        <div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900">
              <Plus className="w-4 h-4 text-indigo-600" />
              Nuevo cliente
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
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
        </div>

        {/* Client list */}
        <div>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  Lista de clientes
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {filteredClients.length}
                  </span>
                </h2>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Mostrar archivados
                </label>
              </div>
              <div className="mt-3">
                <input
                  type="search"
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setClientsPage(1); }}
                  placeholder="Buscar cliente por nombre..."
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : filteredClients.length === 0 ? (
              <EmptyState
                title="No hay clientes"
                description="Crea tu primer cliente usando el formulario de arriba."
                icon={<Users className="w-6 h-6" />}
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {pagedClients.map((client) => {
                  const isExpanded = expandedId === client.id;
                  const isEditing = editingId === client.id;

                  const actionButtons = !isArchivedCatalogEntity(client) ? (
                    <>
                      <Button variant="secondary" size="sm" icon={Edit2} onClick={() => handleStartEdit(client)}>
                        Editar
                      </Button>
                      <Button variant="warning" size="sm" icon={Trash2} onClick={() => void handleArchive(client)}>
                        Archivar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRestore(client)}
                        className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                      >
                        Reactivar
                      </Button>
                      <Button variant="danger" size="sm" icon={Trash2} onClick={() => void handlePermanentDelete(client)}>
                        Borrar definitivo
                      </Button>
                    </>
                  );

                  return (
                    <li
                      key={client.id}
                      id={client.id ? `client-${client.id}` : undefined}
                      className={`scroll-mt-28 transition-colors hover:bg-gray-50 ${
                        highlightedClientId === client.id ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-200' : ''
                      }`}
                    >
                      <div className="px-6 py-4">
                        {isArchivedCatalogEntity(client) && (
                          <div className="mb-2 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                            Archivado
                          </div>
                        )}

                        {/* Edit form — replaces row on all screen sizes */}
                        {isEditing ? (
                          <div className="space-y-3">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className={INPUT_BASE}
                              autoFocus
                            />
                            <textarea
                              rows={7}
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              className={INPUT_BASE}
                              placeholder="Si queda vacío, este cliente usará el prompt global por defecto."
                            />
                            <div className="flex items-center gap-2">
                              <Button variant="primary" size="sm" icon={Check} onClick={() => void handleSaveEdit(client.id!)}>
                                Guardar
                              </Button>
                              <Button variant="ghost" size="sm" icon={X} onClick={() => setEditingId(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Desktop: name + actions inline */}
                            <div className="hidden md:flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-medium text-slate-900">{client.name}</p>
                                <p className="mt-0.5 text-xs text-gray-500">Alta: {formatDate(client.createdAt)}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {client.generationPromptBase?.trim()
                                    ? 'Tiene prompt propio para el wizard.'
                                    : 'Usa el prompt global por defecto.'}
                                </p>
                                {summarizePrompt(client.generationPromptBase) ? (
                                  <p className="mt-1 text-xs text-slate-400 break-words">
                                    {summarizePrompt(client.generationPromptBase)}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">{actionButtons}</div>
                            </div>

                            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                    <Sheet className="h-4 w-4 text-emerald-600" />
                                    Spreadsheets del cliente
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Se usan en el wizard y luego se exportan completos por lote.
                                  </p>
                                </div>
                                {!isArchivedCatalogEntity(client) ? (
                                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                                    <input
                                      type="file"
                                      accept=".xlsx,.xls"
                                      className="hidden"
                                      disabled={uploadingTemplateClientId === client.id}
                                      onChange={(event) => {
                                        void handleTemplateUpload(client, event.target.files?.[0] || null);
                                        event.currentTarget.value = '';
                                      }}
                                    />
                                    {uploadingTemplateClientId === client.id ? 'Importando...' : 'Subir spreadsheet'}
                                  </label>
                                ) : null}
                              </div>

                              <div className="mt-3 space-y-2">
                                {(sortedTemplatesByClientId[client.id || ''] || []).length === 0 ? (
                                  <p className="text-xs text-slate-500">
                                    Este cliente todavía no tiene spreadsheets propios cargados.
                                  </p>
                                ) : (
                                  (sortedTemplatesByClientId[client.id || ''] || []).map((template) => (
                                    <div
                                      key={template.id}
                                      className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                                    >
                                      <p className="text-sm font-medium text-slate-900">{template.name}</p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {template.categories.length} categoría{template.categories.length === 1 ? '' : 's'} · {template.originalFileName}
                                      </p>
                                      <div className="mt-3">
                                        <label className="mb-1.5 block text-xs font-medium text-slate-600">
                                          Categoría por defecto para el wizard
                                        </label>
                                        <select
                                          value={template.defaultCategoryId || ''}
                                          disabled={isArchivedCatalogEntity(client) || savingTemplateCategoryId === template.id}
                                          onChange={(event) => {
                                            void handleTemplateCategoryChange(
                                              client,
                                              template,
                                              event.target.value || null,
                                            );
                                          }}
                                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          <option value="">Sin categoría por defecto</option>
                                          {template.categories.map((category) => (
                                            <option key={category.id} value={category.id}>
                                              {category.label}
                                            </option>
                                          ))}
                                        </select>
                                        <p className="mt-2 text-[11px] text-slate-500">
                                          Luego podrás cambiarla en el wizard, pero esta queda precargada para este spreadsheet.
                                        </p>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>

                            {/* Mobile: collapsible */}
                            <div className="md:hidden">
                              <button
                                type="button"
                                className="flex w-full items-center gap-3 text-left"
                                onClick={() => setExpandedId(isExpanded ? null : client.id!)}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4 shrink-0 text-gray-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
                                )}
                                <div>
                                  <p className="text-sm font-medium text-slate-900">{client.name}</p>
                                  <p className="mt-0.5 text-xs text-gray-500">Alta: {formatDate(client.createdAt)}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {client.generationPromptBase?.trim()
                                      ? 'Tiene prompt propio para el wizard.'
                                      : 'Usa el prompt global por defecto.'}
                                  </p>
                                </div>
                              </button>

                              {isExpanded && (
                                <div className="mt-3 space-y-3 pl-7">
                                  {summarizePrompt(client.generationPromptBase) ? (
                                    <p className="text-xs text-slate-400 break-words">
                                      {summarizePrompt(client.generationPromptBase)}
                                    </p>
                                  ) : null}
                                  <div className="flex items-center gap-2">{actionButtons}</div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {clientsTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <button
                  onClick={() => setClientsPage((p) => Math.max(1, p - 1))}
                  disabled={clientsPage === 1}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Página {clientsPage} de {clientsTotalPages}
                </span>
                <button
                  onClick={() => setClientsPage((p) => Math.min(clientsTotalPages, p + 1))}
                  disabled={clientsPage === clientsTotalPages}
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
