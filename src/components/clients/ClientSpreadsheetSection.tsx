import React from 'react';
import { Sheet, Trash2 } from 'lucide-react';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { Client, SpreadsheetTemplate } from '../../../shared/src/types';

interface ClientSpreadsheetSectionProps {
  client: Client;
  templates: SpreadsheetTemplate[];
  uploadingTemplateClientId: string | null;
  savingTemplateCategoryId: string | null;
  deletingTemplateId: string | null;
  onUpload: (client: Client, file: File | null) => void;
  onCategoryChange: (client: Client, template: SpreadsheetTemplate, categoryId: string | null) => void;
  onDelete: (client: Client, template: SpreadsheetTemplate) => void;
}

export const ClientSpreadsheetSection: React.FC<ClientSpreadsheetSectionProps> = ({
  client, templates,
  uploadingTemplateClientId, savingTemplateCategoryId, deletingTemplateId,
  onUpload, onCategoryChange, onDelete,
}) => (
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
              onUpload(client, event.target.files?.[0] || null);
              event.currentTarget.value = '';
            }}
          />
          {uploadingTemplateClientId === client.id ? 'Importando...' : 'Subir spreadsheet'}
        </label>
      ) : null}
    </div>

    <div className="mt-3 space-y-2">
      {templates.length === 0 ? (
        <p className="text-xs text-slate-500">
          Este cliente todavía no tiene spreadsheets propios cargados.
        </p>
      ) : (
        templates.map((template) => (
          <div key={template.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{template.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {template.categories.length} categoría{template.categories.length === 1 ? '' : 's'} · {template.originalFileName}
                </p>
              </div>
              {!isArchivedCatalogEntity(client) ? (
                <button
                  type="button"
                  onClick={() => onDelete(client, template)}
                  disabled={!template.id || deletingTemplateId === template.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingTemplateId === template.id ? 'Eliminando...' : 'Eliminar'}
                </button>
              ) : null}
            </div>
            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Categoría por defecto para el wizard
              </label>
              <select
                value={template.defaultCategoryId || ''}
                disabled={isArchivedCatalogEntity(client) || savingTemplateCategoryId === template.id}
                onChange={(event) => onCategoryChange(client, template, event.target.value || null)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Sin categoría por defecto</option>
                {template.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
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
);
