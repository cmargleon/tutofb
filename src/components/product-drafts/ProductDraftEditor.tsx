import React, { useMemo, useState } from 'react';
import {
  ProductDraft,
  ProductDraftInput,
  ProductDraftRow,
  SpreadsheetTemplateCategory,
  SpreadsheetTemplateCategoryColumn,
} from '../../../shared/src/types';
import {
  getProductDraftColumnAllowedValues,
  getProductDraftColumnDefaultValue,
  isProductDraftDropdownColumn,
  resolveProductDraftColumnValue,
} from '../../../shared/src/utils/spreadsheetDraftColumns';

type EditableDraft = ProductDraft | ProductDraftInput;
type ProductDraftEditorLayout = 'table' | 'form';

interface ProductDraftEditorProps {
  categories: SpreadsheetTemplateCategory[];
  drafts: EditableDraft[];
  loading?: boolean;
  error?: string | null;
  emptyCopy?: string;
  saveLabel?: string;
  savingDraftId?: string | null;
  layout?: ProductDraftEditorLayout;
  showDraftTabs?: boolean;
  showSummaryCard?: boolean;
  showGeneratedImagesSummary?: boolean;
  showAddRowButton?: boolean;
  showRowActions?: boolean;
  resolveVisibleColumns?: (
    draft: EditableDraft,
    category: SpreadsheetTemplateCategory,
  ) => SpreadsheetTemplateCategoryColumn[];
  onChangeRows: (draft: EditableDraft, rows: ProductDraftRow[]) => void;
  onSaveDraft?: (draft: EditableDraft) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

const buildEmptyRow = (category: SpreadsheetTemplateCategory): ProductDraftRow => ({
  id: `row-${crypto.randomUUID()}`,
  values: Object.fromEntries(category.columns.map((column) => [column.key, ''])),
});

const getMissingRequiredKeys = (category: SpreadsheetTemplateCategory, row: ProductDraftRow): string[] =>
  category.columns
    .filter((column) => column.required)
    .filter((column) => !resolveProductDraftColumnValue({
      category,
      column,
      rowValues: row.values,
      candidates: [row.values[column.key]],
    }))
    .map((column) => column.key);

const getFieldState = (
  activeCategory: SpreadsheetTemplateCategory,
  activeDraft: EditableDraft,
  row: ProductDraftRow,
  column: SpreadsheetTemplateCategoryColumn,
) => {
  const allowedValues = Array.from(new Set(getProductDraftColumnAllowedValues(activeCategory, column, row.values)));
  const defaultValue = getProductDraftColumnDefaultValue(activeCategory, column);
  const resolvedValue = resolveProductDraftColumnValue({
    category: activeCategory,
    column,
    rowValues: row.values,
    candidates: [row.values[column.key], activeDraft.inferredValues?.[column.key]?.value],
  });
  const isDropdown = isProductDraftDropdownColumn(activeCategory, column, row.values);
  const isFixedDropdown = Boolean(defaultValue && allowedValues.length === 1 && allowedValues[0] === defaultValue);
  const placeholder =
    activeDraft.inferredValues?.[column.key]?.value
    || column.guidance
    || column.validation
    || '';

  return {
    allowedValues,
    resolvedValue,
    isDropdown,
    isFixedDropdown,
    placeholder,
  };
};

export const ProductDraftEditor: React.FC<ProductDraftEditorProps> = ({
  categories,
  drafts,
  loading = false,
  error = null,
  emptyCopy = 'Todavía no hay drafts para mostrar.',
  saveLabel = 'Guardar draft',
  savingDraftId = null,
  layout = 'table',
  showDraftTabs = true,
  showSummaryCard = true,
  showGeneratedImagesSummary = true,
  showAddRowButton = true,
  showRowActions = true,
  resolveVisibleColumns,
  onChangeRows,
  onSaveDraft,
}) => {
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  const resolvedActiveDraft = useMemo(() => {
    const preferredId = activeDraftId || drafts[0]?.garmentId || (drafts[0] as ProductDraft | undefined)?.id || null;
    return drafts.find((draft) => draft.garmentId === preferredId || (draft as ProductDraft).id === preferredId) || drafts[0] || null;
  }, [activeDraftId, drafts]);

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === resolvedActiveDraft?.categoryId) || null,
    [categories, resolvedActiveDraft?.categoryId],
  );
  const activeColumns = useMemo(() => {
    if (!activeCategory || !resolvedActiveDraft) {
      return [];
    }

    return resolveVisibleColumns?.(resolvedActiveDraft, activeCategory) || activeCategory.columns;
  }, [activeCategory, resolveVisibleColumns, resolvedActiveDraft]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Preparando drafts del producto...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
        {error}
      </div>
    );
  }

  if (!activeCategory || drafts.length === 0 || !resolvedActiveDraft) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        {emptyCopy}
      </div>
    );
  }

  const activeDraft = resolvedActiveDraft;
  const activeDraftIdValue = activeDraft.garmentId || (activeDraft as ProductDraft).id || null;

  const patchRows = (updater: (rows: ProductDraftRow[]) => ProductDraftRow[]) => {
    onChangeRows(activeDraft, updater(activeDraft.rows));
  };

  const renderField = (row: ProductDraftRow, column: SpreadsheetTemplateCategoryColumn, forceResolvedValue = false) => {
    const {
      allowedValues,
      resolvedValue,
      isDropdown,
      isFixedDropdown,
      placeholder,
    } = getFieldState(activeCategory, activeDraft, row, column);

    const updateValue = (nextValue: string) => {
      patchRows((rows) =>
        rows.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                values: {
                  ...entry.values,
                  [column.key]: nextValue,
                },
              }
            : entry,
        ),
      );
    };

    if (isDropdown) {
      return (
        <select
          value={resolvedValue}
          onChange={(event) => updateValue(event.target.value)}
          disabled={isFixedDropdown}
          className={INPUT_CLASS}
        >
          {!isFixedDropdown ? (
            <option value="">
              {placeholder || 'Selecciona una opción'}
            </option>
          ) : null}
          {allowedValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type="text"
        value={forceResolvedValue ? resolvedValue : (row.values[column.key] || '')}
        onChange={(event) => updateValue(event.target.value)}
        className={INPUT_CLASS}
        placeholder={placeholder}
      />
    );
  };

  const renderTabs = showDraftTabs && drafts.length > 1 ? (
    <div className="flex flex-wrap gap-2">
      {drafts.map((draft) => {
        const draftId = draft.garmentId || (draft as ProductDraft).id || '';
        const isActive = draftId === activeDraftIdValue;
        return (
          <button
            key={draftId}
            type="button"
            onClick={() => setActiveDraftId(draftId)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              isActive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {draft.garmentName}
          </button>
        );
      })}
    </div>
  ) : null;

  const renderSummaryCard = showSummaryCard ? (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{activeDraft.garmentName}</p>
          <p className="mt-1 text-xs text-slate-500">
            {activeDraft.rows.length} fila{activeDraft.rows.length === 1 ? '' : 's'} para exportar en {activeCategory.label}
          </p>
          {activeDraft.matchedColor ? (
            <p className="mt-1 text-[11px] text-slate-500">Color detectado: {activeDraft.matchedColor}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {showAddRowButton ? (
            <button
              type="button"
              onClick={() => patchRows((rows) => [...rows, buildEmptyRow(activeCategory)])}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Agregar fila
            </button>
          ) : null}
          {onSaveDraft ? (
            <button
              type="button"
              onClick={() => onSaveDraft(activeDraft)}
              disabled={savingDraftId === activeDraftIdValue}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingDraftId === activeDraftIdValue ? 'Guardando...' : saveLabel}
            </button>
          ) : null}
        </div>
      </div>

      {showGeneratedImagesSummary && activeDraft.generatedImages && activeDraft.generatedImages.length > 0 ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs font-semibold text-emerald-800">Imágenes aprobadas disponibles</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeDraft.generatedImages.map((image) => (
              <a
                key={`${image.jobId}-${image.outputId}`}
                href={image.downloadUrl || '#'}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700"
              >
                {image.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  if (layout === 'form') {
    return (
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {renderTabs}
        {renderSummaryCard}

        <div className="space-y-6">
          {activeDraft.rows.map((row, rowIndex) => {
            const missingRequiredKeys = getMissingRequiredKeys(
              {
                ...activeCategory,
                columns: activeColumns,
              },
              row,
            );
            return (
              <div key={row.id} className="space-y-4">
                {activeDraft.rows.length > 1 ? (
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Fila {rowIndex + 1}</p>
                      <p className={`text-xs ${missingRequiredKeys.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {missingRequiredKeys.length > 0
                          ? `Faltan ${missingRequiredKeys.length} campo${missingRequiredKeys.length === 1 ? '' : 's'} requerido${missingRequiredKeys.length === 1 ? '' : 's'}`
                          : 'Completa'}
                      </p>
                    </div>
                    {showRowActions ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            patchRows((rows) => [
                              ...rows,
                              {
                                id: `row-${crypto.randomUUID()}`,
                                values: { ...row.values },
                              },
                            ])
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => patchRows((rows) => rows.filter((entry) => entry.id !== row.id))}
                          disabled={activeDraft.rows.length === 1}
                          className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {activeColumns.map((column) => (
                    <div key={`${row.id}-${column.key}`} className="grid items-start gap-2 lg:grid-cols-[minmax(0,10rem)_1fr]">
                      <div className="pt-2">
                        <div className="text-xs font-semibold text-slate-700">{column.label}</div>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">{column.key}</div>
                        {column.required ? (
                          <div className="mt-1 text-[10px] uppercase tracking-wide text-rose-500">Requerido</div>
                        ) : null}
                      </div>
                      <div>{renderField(row, column, true)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {onSaveDraft ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onSaveDraft(activeDraft)}
              disabled={savingDraftId === activeDraftIdValue}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingDraftId === activeDraftIdValue ? 'Guardando...' : saveLabel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      {renderTabs}
      {renderSummaryCard}

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Fila</th>
              {activeCategory.columns.map((column) => (
                <th key={column.key} className="min-w-[220px] px-3 py-2 text-left text-[11px] font-semibold text-slate-600">
                  <div>{column.label}</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-400">{column.key}</div>
                  {column.required ? <div className="mt-1 text-[10px] uppercase tracking-wide text-rose-500">Requerido</div> : null}
                </th>
              ))}
              {showRowActions ? (
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Acciones</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {activeDraft.rows.map((row, rowIndex) => {
              const missingRequiredKeys = getMissingRequiredKeys(
                {
                  ...activeCategory,
                  columns: activeColumns,
                },
                row,
              );
              return (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-3 text-xs text-slate-700">
                    <div className="font-semibold">#{rowIndex + 1}</div>
                    {missingRequiredKeys.length > 0 ? (
                      <div className="mt-1 text-[11px] text-rose-600">
                        Faltan {missingRequiredKeys.length} requerido{missingRequiredKeys.length === 1 ? '' : 's'}
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-emerald-600">Completa</div>
                    )}
                  </td>
                  {activeColumns.map((column) => (
                    <td key={`${row.id}-${column.key}`} className="px-3 py-3">
                      {renderField(row, column)}
                    </td>
                  ))}
                  {showRowActions ? (
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            patchRows((rows) => [
                              ...rows,
                              {
                                id: `row-${crypto.randomUUID()}`,
                                values: { ...row.values },
                              },
                            ])
                          }
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => patchRows((rows) => rows.filter((entry) => entry.id !== row.id))}
                          disabled={activeDraft.rows.length === 1}
                          className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
