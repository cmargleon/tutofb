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
  <div className="tuto-surface overflow-hidden">
    <div className="tuto-card-header">
      <div className="flex min-w-0 items-start gap-3">
        <span className="tuto-stat-icon tuto-tone--success h-8 w-8" aria-hidden="true"><Sheet /></span>
        <div className="min-w-0">
        <h3>Spreadsheets del cliente</h3>
        <p className="max-w-2xl">
          Plantillas heredadas del wizard. Administra las nuevas plantillas de salida en Marketplaces; los archivos Excel fuente se cargan por separado durante la generación.
        </p>
        </div>
      </div>
      {!isArchivedCatalogEntity(client) ? (
        <label className="tuto-button tuto-button--secondary tuto-button--sm cursor-pointer focus-within:ring-2 focus-within:ring-[var(--color-accent)]">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
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

    <div className="divide-y divide-slate-100">
      {templates.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-[var(--color-text-muted)]">
          Este cliente todavía no tiene spreadsheets propios cargados.
        </p>
      ) : (
        templates.map((template) => (
          <div key={template.id} className="px-5 py-4">
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
                  className="tuto-button tuto-button--ghost tuto-button--sm !text-[var(--color-danger)] hover:!bg-[var(--color-danger-soft)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingTemplateId === template.id ? 'Eliminando...' : 'Eliminar'}
                </button>
              ) : null}
            </div>
            <div className="mt-3 max-w-md">
              <label htmlFor={`template-category-${template.id}`} className="mb-1.5 block text-xs font-medium text-slate-600">
                Categoría por defecto para el wizard
              </label>
              <select
                id={`template-category-${template.id}`}
                value={template.defaultCategoryId || ''}
                disabled={isArchivedCatalogEntity(client) || savingTemplateCategoryId === template.id}
                onChange={(event) => onCategoryChange(client, template, event.target.value || null)}
                className="tuto-field"
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
