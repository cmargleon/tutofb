import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  RefreshCw,
  Upload,
  UserSquare2,
} from 'lucide-react';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { Client } from '../../../shared/src/types';
import { UseModelLibraryResult } from '../../features/models/hooks/useModelLibrary';
import { UseModelsCatalogResult } from '../../features/models/hooks/useModelsCatalog';
import { EmptyState, LoadingBlock, Button, ImageThumb } from '../ui';
import { ModelImportDialog } from './ModelImportDialog';

interface ModelLibrarySectionProps {
  catalog: UseModelsCatalogResult;
  library: UseModelLibraryResult;
}

export const ModelLibrarySection: React.FC<ModelLibrarySectionProps> = ({
  catalog,
  library,
}) => {
  const { search } = useLocation();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importClientId, setImportClientId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const activeClients = useMemo(
    () => catalog.clients.filter((client): client is Client & { id: string } => Boolean(client.id)),
    [catalog.clients],
  );

  const handleOpenImportDialog = () => {
    setImportClientId(activeClients[0]?.id || '');
    setImportFile(null);
    setIsImportDialogOpen(true);
  };

  const handleCloseImportDialog = () => {
    if (library.isImportingBundle) return;
    setIsImportDialogOpen(false);
    setImportFile(null);
  };

  const handleImportSubmit = async () => {
    if (!importClientId || !importFile) return;
    const imported = await library.handleImportModelBundle(importClientId, importFile);
    if (!imported) return;
    setIsImportDialogOpen(false);
    setImportFile(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-lg font-medium text-gray-900">
              <UserSquare2 className="h-5 w-5 text-indigo-600" />
              Biblioteca de modelos
              <span className="ml-2 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {catalog.filteredModelsCount}
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={catalog.showArchived}
                onChange={(event) => catalog.setShowArchived(event.target.checked)}
              />
              Mostrar archivados
            </label>
            <Button
              variant="secondary"
              size="sm"
              icon={Upload}
              onClick={handleOpenImportDialog}
              disabled={activeClients.length === 0}
              title={activeClients.length === 0 ? 'Necesitas al menos un cliente activo para importar modelos.' : 'Importar modelo'}
            >
              Importar
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <input
            type="search"
            value={catalog.modelSearch}
            onChange={(event) => catalog.handleModelSearchChange(event.target.value)}
            placeholder="Buscar modelo por nombre..."
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm transition-colors placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>
      </div>

      {catalog.loading ? (
        <LoadingBlock />
      ) : catalog.filteredModelsCount === 0 ? (
        <EmptyState
          title="No hay modelos"
          description="Todavía no hay modelos registrados. Crea el primero desde la vista Generar o importa un ZIP existente."
          icon={<UserSquare2 className="h-6 w-6" />}
          action={(
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                to="/models/generar"
                className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                Ir a Generar
              </Link>
              <Button
                variant="secondary"
                size="md"
                icon={Upload}
                onClick={handleOpenImportDialog}
                disabled={activeClients.length === 0}
              >
                Importar ZIP
              </Button>
            </div>
          )}
        />
      ) : (
        <ul className="grid grid-cols-3 gap-3 px-4 sm:grid-cols-4 sm:px-6 md:grid-cols-5">
          {catalog.pagedModels.map((model) => {
            const pose = model.poses[0];
            const archived = isArchivedCatalogEntity(model);
            const active = model.active !== false;
            const updating = Boolean(model.id && library.updatingModelIds.has(model.id));

            return (
              <li key={model.id} className="relative isolate flex flex-col rounded-lg bg-white ring-1 ring-gray-200 transition hover:ring-indigo-400 focus-within:ring-indigo-400">
                <Link
                  to={`/models/catalogo/${encodeURIComponent(model.id!)}${search}`}
                  aria-label={model.name}
                  className="flex flex-1 flex-col after:absolute after:inset-0 after:rounded-lg"
                >
                  <div className="px-2.5 pb-2 pt-2.5">
                    <h3 className="break-words text-sm font-semibold text-indigo-600">{model.name}</h3>
                    <p className="mt-1 break-words text-xs text-gray-500">{model.clientNameSnapshot}</p>
                    <p className="mt-1 text-xs text-gray-500">{model.poseCount ?? model.poses.length} poses</p>
                  </div>
                  <div className="mt-auto aspect-[3/4]">
                    {pose ? (
                      <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                    ) : (
                      <div className="grid h-full place-items-center rounded-md bg-gray-100 text-gray-400" aria-label="Sin foto">
                        <ImageIcon className="h-6 w-6" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex min-h-10 flex-wrap items-center justify-between gap-1 px-2.5 py-1.5 text-xs text-gray-500">
                  <span>{archived ? 'Archivado' : active ? 'Activo' : 'Inactivo'}</span>
                  {!archived && (
                    <button
                      type="button"
                      role="switch"
                      aria-label={`Modelo activo: ${model.name}`}
                      aria-checked={active}
                      title={active ? 'Desactivar modelo' : 'Activar modelo'}
                      disabled={updating}
                      onClick={() => void library.handleToggleModelActive(model)}
                      className={`relative inline-flex h-6 w-9 shrink-0 items-center rounded-full shadow-sm transition-colors disabled:opacity-40 sm:w-10 ${active ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-500 hover:bg-gray-600'}`}
                    >
                      <span className={`absolute left-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform ${active ? 'translate-x-3 sm:translate-x-4' : 'translate-x-0'}`}>
                        {updating && <RefreshCw className="h-3 w-3 animate-spin text-gray-500" />}
                      </span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {catalog.modelsTotalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4">
          <button
            onClick={() => catalog.setModelsPage(catalog.modelsPage - 1)}
            disabled={catalog.modelsPage === 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {catalog.modelsPage} de {catalog.modelsTotalPages}
          </span>
          <button
            onClick={() =>
              catalog.setModelsPage(catalog.modelsPage + 1)
            }
            disabled={catalog.modelsPage === catalog.modelsTotalPages}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {isImportDialogOpen ? (
        <ModelImportDialog
          clients={activeClients}
          selectedClientId={importClientId}
          onClientChange={setImportClientId}
          selectedFile={importFile}
          onFileChange={setImportFile}
          isImporting={library.isImportingBundle}
          onClose={handleCloseImportDialog}
          onSubmit={() => void handleImportSubmit()}
        />
      ) : null}
    </div>
  );
};
