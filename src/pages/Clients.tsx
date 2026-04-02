import React from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { ClientCreateForm } from '../components/clients/ClientCreateForm';
import { ClientListItem } from '../components/clients/ClientListItem';

export const Clients: React.FC = () => {
  const {
    loading, error,
    newClientName, setNewClientName, newClientPrompt, setNewClientPrompt,
    isCreating, createSuccess,
    editingId, setEditingId, editName, setEditName, editPrompt, setEditPrompt,
    expandedId, setExpandedId, showArchived, setShowArchived,
    clientSearch, setClientSearch, clientsPage, setClientsPage,
    uploadingTemplateClientId, savingTemplateCategoryId, deletingTemplateId,
    filteredClients, clientsTotalPages, pagedClients, highlightedClientId,
    sortedTemplatesByClientId,
    handleCreate, handleStartEdit, handleSaveEdit,
    handleArchive, handleRestore, handlePermanentDelete,
    handleTemplateUpload, handleTemplateCategoryChange, handleTemplateDelete,
  } = useClientManagement();

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
        <div>
          <ClientCreateForm
            newClientName={newClientName}
            setNewClientName={setNewClientName}
            newClientPrompt={newClientPrompt}
            setNewClientPrompt={setNewClientPrompt}
            isCreating={isCreating}
            createSuccess={createSuccess}
            onSubmit={handleCreate}
          />
        </div>

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
                {pagedClients.map((client) => (
                  <ClientListItem
                    key={client.id}
                    client={client}
                    isExpanded={expandedId === client.id}
                    isEditing={editingId === client.id}
                    highlightedClientId={highlightedClientId}
                    editName={editName}
                    editPrompt={editPrompt}
                    setEditName={setEditName}
                    setEditPrompt={setEditPrompt}
                    templates={sortedTemplatesByClientId[client.id || ''] || []}
                    uploadingTemplateClientId={uploadingTemplateClientId}
                    savingTemplateCategoryId={savingTemplateCategoryId}
                    deletingTemplateId={deletingTemplateId}
                    onToggleExpand={() => setExpandedId(expandedId === client.id ? null : client.id!)}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={() => setEditingId(null)}
                    onArchive={handleArchive}
                    onRestore={handleRestore}
                    onPermanentDelete={handlePermanentDelete}
                    onTemplateUpload={handleTemplateUpload}
                    onTemplateCategoryChange={handleTemplateCategoryChange}
                    onTemplateDelete={handleTemplateDelete}
                  />
                ))}
              </ul>
            )}

            {clientsTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <button
                  type="button"
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
                  type="button"
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
