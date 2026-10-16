import React, { useRef } from 'react';
import { Layers3 } from 'lucide-react';
import { BatchOutputMode, Client, Model, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { WizardState, WizardSourceSpreadsheetState } from '../../features/generate/types';
import { EmptyState, ImageThumb } from '../ui';

interface Props {
  generationKind: WizardState['generationKind'];
  isBusy: boolean;
  onGenerationKindChange: (kind: NonNullable<WizardState['generationKind']>) => Promise<void>;
  clients: Client[];
  models: Model[];
  spreadsheetTemplates: SpreadsheetTemplate[];
  spreadsheetCategories: SpreadsheetTemplateCategory[];
  selectedClientId: string | null;
  selectedModelId: string | null;
  outputMode: BatchOutputMode;
  outputModeChosen: boolean;
  selectedClientHasSpreadsheetTemplates: boolean;
  loadingSpreadsheetTemplates: boolean;
  selectedSpreadsheetTemplateId: string | null;
  selectedSpreadsheetCategoryId: string | null;
  sourceSpreadsheet: WizardSourceSpreadsheetState | null;
  onClientChange: (clientId: string | null) => void;
  onOutputModeChange: (outputMode: BatchOutputMode) => void;
  onSpreadsheetTemplateChange: (templateId: string | null) => void;
  onSpreadsheetCategoryChange: (categoryId: string | null) => void;
  onSourceSpreadsheetFile: (file: File | null) => void | Promise<void>;
  onModelSelect: (modelId: string | null) => void;
}

export const ClientModelStep: React.FC<Props> = ({
  generationKind,
  isBusy,
  onGenerationKindChange,
  clients,
  models,
  spreadsheetTemplates,
  spreadsheetCategories,
  selectedClientId,
  selectedModelId,
  outputMode,
  outputModeChosen,
  selectedClientHasSpreadsheetTemplates,
  loadingSpreadsheetTemplates,
  selectedSpreadsheetTemplateId,
  selectedSpreadsheetCategoryId,
  sourceSpreadsheet,
  onClientChange,
  onOutputModeChange,
  onSpreadsheetTemplateChange,
  onSpreadsheetCategoryChange,
  onSourceSpreadsheetFile,
  onModelSelect,
}) => {
  const sourceSpreadsheetInputRef = useRef<HTMLInputElement | null>(null);
  const hideSpreadsheetControls = Boolean(
    selectedClientId && !loadingSpreadsheetTemplates && !selectedClientHasSpreadsheetTemplates,
  );
  const showModels = generationKind === 'garment' && (hideSpreadsheetControls || (!loadingSpreadsheetTemplates && outputModeChosen));

  return (
    <div className="space-y-6">
      <div className={`grid gap-5 ${showModels ? 'lg:grid-cols-[280px,1fr]' : ''}`}>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-slate-700">Cliente</label>
          <select
            aria-label="Cliente"
            disabled={isBusy}
            value={selectedClientId || ''}
            onChange={(event) => onClientChange(event.target.value || null)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
          >
            <option value="">Selecciona un cliente</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>

          {selectedClientId && <fieldset className="mt-5 min-w-0 space-y-2" disabled={isBusy}>
            <legend className="mb-2 text-sm font-medium text-slate-700">¿Qué quieres fotografiar?</legend>
            {([
              ['garment', 'Ropa con modelo', 'Prendas, modelo humano y poses.'],
              ['product', 'Objetos / productos', '6 fotos por objeto: 4 lifestyle y 2 con personas usándolo.'],
            ] as const).map(([kind, title, description]) => <button key={kind} type="button" aria-pressed={generationKind === kind}
              onClick={() => void onGenerationKindChange(kind)}
              className={`w-full rounded-2xl border p-4 text-left transition disabled:opacity-60 ${generationKind === kind ? 'border-emerald-600 bg-emerald-50 text-slate-900' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'}`}>
              <span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs">{description}</span>
            </button>)}
          </fieldset>}
          {selectedClientId && generationKind === 'product' && <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
            Salida: solo fotos. En los siguientes pasos cargarás los objetos y elegirás sus escenas.
          </p>}

          {selectedClientId && generationKind === 'garment' && (
            <div className="mt-4">
              <span className="mb-2 block text-sm font-medium text-slate-700">Salida final</span>
              {loadingSpreadsheetTemplates ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  Revisando si este cliente tiene un spreadsheet cargado.
                </div>
              ) : hideSpreadsheetControls ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  Este cliente no tiene spreadsheet cargado. El lote se generará solo con fotos. Si quieres usar
                  spreadsheet, primero cárgalo desde el menú de Clientes.
                </div>
              ) : (
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => onOutputModeChange('spreadsheet')}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      outputMode === 'spreadsheet' && outputModeChosen
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-semibold">Con spreadsheet</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Prepara product drafts y deja el lote listo para exportar el archivo al final.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOutputModeChange('photos_only')}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      outputMode === 'photos_only' && outputModeChosen
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-semibold">Solo guardar fotos</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Genera y guarda las imágenes sin asociar plantilla ni categoría de spreadsheet.
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          {generationKind === 'garment' && selectedClientId && outputModeChosen && !hideSpreadsheetControls && outputMode === 'spreadsheet' ? (
            <>
              <label className="mb-2 mt-4 block text-sm font-medium text-slate-700">Spreadsheet del cliente</label>
              <select
                value={selectedSpreadsheetTemplateId || ''}
                onChange={(event) => onSpreadsheetTemplateChange(event.target.value || null)}
                disabled={!selectedClientId}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Selecciona un spreadsheet</option>
                {spreadsheetTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>

              <label className="mb-2 mt-4 block text-sm font-medium text-slate-700">Categoría fallback del spreadsheet</label>
              <select
                value={selectedSpreadsheetCategoryId || ''}
                onChange={(event) => onSpreadsheetCategoryChange(event.target.value || null)}
                disabled={!selectedSpreadsheetTemplateId}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Detectar automáticamente por prenda</option>
                {spreadsheetCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11px] text-slate-500">
                Gemini intentará detectar la categoría correcta de cada prenda. Este valor solo se usa como fallback.
              </p>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Excel fuente opcional</label>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Si lo adjuntas, intentaremos matchear sus fotos con las prendas del wizard para rellenar el spreadsheet final.
                    </p>
                  </div>
                  <input
                    ref={sourceSpreadsheetInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      void onSourceSpreadsheetFile(file);
                      event.currentTarget.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => sourceSpreadsheetInputRef.current?.click()}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-100"
                  >
                    {sourceSpreadsheet ? 'Reemplazar' : 'Adjuntar Excel'}
                  </button>
                </div>

                {sourceSpreadsheet ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {sourceSpreadsheet.originalFileName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {sourceSpreadsheet.status === 'uploading'
                            ? 'Subiendo archivo...'
                            : sourceSpreadsheet.status === 'uploaded'
                              ? 'Listo para usar en el matching.'
                              : sourceSpreadsheet.error || 'No se pudo subir el archivo.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onSourceSpreadsheetFile(null)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : generationKind === 'garment' && selectedClientId && outputModeChosen && !hideSpreadsheetControls ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Este lote se guardará solo como imágenes. Más adelante no aparecerá la opción de exportar spreadsheet.
            </div>
          ) : null}
        </div>

        {showModels && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Modelos del cliente</h2>
                <p className="text-sm text-slate-500">
                  Elige el modelo primero. Las poses se sugerirán después de subir las prendas.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {models.length} modelo{models.length === 1 ? '' : 's'}
              </span>
            </div>

            {models.length === 0 ? (
              <EmptyState
                title="Este cliente aún no tiene modelos"
                description="Crea un modelo con poses antes de continuar con el lote."
                icon={<Layers3 className="w-6 h-6" />}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {models.map((model) => {
                  const coverPath = model.coverPosePath || model.poses[0]?.storagePath;
                  const isSelected = model.id === selectedModelId;
                  return (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => onModelSelect(model.id || null)}
                      className={`overflow-hidden rounded-3xl border text-left transition ${
                        isSelected
                          ? 'border-emerald-700 bg-emerald-600 text-white shadow-lg shadow-emerald-900/20'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="aspect-[4/3] bg-slate-100">
                        {coverPath ? (
                          <ImageThumb storagePath={coverPath} alt={model.name} />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin preview</div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <h3 className={`font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`}>{model.name}</h3>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              isSelected ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {model.poseCount} poses
                          </span>
                        </div>
                        <p className={`mt-2 text-sm ${isSelected ? 'text-emerald-100' : 'text-slate-500'}`}>
                          {model.clientNameSnapshot}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
