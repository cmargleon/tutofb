import React from 'react';
import { Check, ChevronDown, ChevronUp, Edit2, Trash2, X } from 'lucide-react';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { Client, SpreadsheetTemplate } from '../../../shared/src/types';
import { formatDateTimeLong as formatDate } from '../../../shared/src/utils/dateUtils';
import { Button } from '../ui';
import { INPUT_BASE, summarizePrompt } from './clientUtils';
import { ClientSpreadsheetSection } from './ClientSpreadsheetSection';

interface ClientListItemProps {
  client: Client;
  isExpanded: boolean;
  isEditing: boolean;
  highlightedClientId: string | null;
  editName: string;
  editPrompt: string;
  setEditName: (v: string) => void;
  setEditPrompt: (v: string) => void;
  templates: SpreadsheetTemplate[];
  uploadingTemplateClientId: string | null;
  savingTemplateCategoryId: string | null;
  deletingTemplateId: string | null;
  onToggleExpand: () => void;
  onStartEdit: (client: Client) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onArchive: (client: Client) => void;
  onRestore: (client: Client) => void;
  onPermanentDelete: (client: Client) => void;
  onTemplateUpload: (client: Client, file: File | null) => void;
  onTemplateCategoryChange: (client: Client, template: SpreadsheetTemplate, categoryId: string | null) => void;
  onTemplateDelete: (client: Client, template: SpreadsheetTemplate) => void;
}

export const ClientListItem: React.FC<ClientListItemProps> = ({
  client, isExpanded, isEditing, highlightedClientId,
  editName, editPrompt, setEditName, setEditPrompt,
  templates,
  uploadingTemplateClientId, savingTemplateCategoryId, deletingTemplateId,
  onToggleExpand, onStartEdit, onSaveEdit, onCancelEdit,
  onArchive, onRestore, onPermanentDelete,
  onTemplateUpload, onTemplateCategoryChange, onTemplateDelete,
}) => {
  const actionButtons = !isArchivedCatalogEntity(client) ? (
    <>
      <Button variant="secondary" size="sm" icon={Edit2} onClick={() => onStartEdit(client)}>Editar</Button>
      <Button variant="warning" size="sm" icon={Trash2} onClick={() => void onArchive(client)}>Archivar</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" onClick={() => void onRestore(client)} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800">
        Reactivar
      </Button>
      <Button variant="danger" size="sm" icon={Trash2} onClick={() => void onPermanentDelete(client)}>
        Borrar definitivo
      </Button>
    </>
  );

  return (
    <li
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
              <Button variant="primary" size="sm" icon={Check} onClick={() => void onSaveEdit(client.id!)}>
                Guardar
              </Button>
              <Button variant="ghost" size="sm" icon={X} onClick={onCancelEdit}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop layout */}
            <div className="hidden md:flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{client.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">Alta: {formatDate(client.createdAt)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {client.generationPromptBase?.trim() ? 'Tiene prompt propio para el wizard.' : 'Usa el prompt global por defecto.'}
                </p>
                {summarizePrompt(client.generationPromptBase) ? (
                  <p className="mt-1 text-xs text-slate-400 break-words">{summarizePrompt(client.generationPromptBase)}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">{actionButtons}</div>
            </div>

            <ClientSpreadsheetSection
              client={client}
              templates={templates}
              uploadingTemplateClientId={uploadingTemplateClientId}
              savingTemplateCategoryId={savingTemplateCategoryId}
              deletingTemplateId={deletingTemplateId}
              onUpload={onTemplateUpload}
              onCategoryChange={onTemplateCategoryChange}
              onDelete={onTemplateDelete}
            />

            {/* Mobile layout */}
            <div className="md:hidden">
              <button
                type="button"
                className="flex w-full items-center gap-3 text-left"
                onClick={onToggleExpand}
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
                    {client.generationPromptBase?.trim() ? 'Tiene prompt propio para el wizard.' : 'Usa el prompt global por defecto.'}
                  </p>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 space-y-3 pl-7">
                  {summarizePrompt(client.generationPromptBase) ? (
                    <p className="text-xs text-slate-400 break-words">{summarizePrompt(client.generationPromptBase)}</p>
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
};
