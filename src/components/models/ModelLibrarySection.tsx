import React from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  UserSquare2,
} from 'lucide-react';
import { UseModelLibraryResult } from '../../features/models/hooks/useModelLibrary';
import { UseModelsCatalogResult } from '../../features/models/hooks/useModelsCatalog';
import { EmptyState, LoadingBlock } from '../ui';
import { ModelLibraryItem } from './ModelLibraryItem';

interface ModelLibrarySectionProps {
  catalog: UseModelsCatalogResult;
  library: UseModelLibraryResult;
}

export const ModelLibrarySection: React.FC<ModelLibrarySectionProps> = ({
  catalog,
  library,
}) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
    <div className="border-b border-gray-200 bg-gray-50 p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-medium text-gray-900">
          <UserSquare2 className="h-5 w-5 text-indigo-600" />
          Biblioteca de modelos
          <span className="ml-2 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
            {catalog.filteredModelsCount}
          </span>
        </h2>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={catalog.showArchived}
            onChange={(event) => catalog.setShowArchived(event.target.checked)}
          />
          Mostrar archivados
        </label>
      </div>
      <div className="mt-3">
        <input
          type="search"
          value={catalog.modelSearch}
          onChange={(event) => catalog.handleModelSearchChange(event.target.value)}
          placeholder="Buscar modelo por nombre..."
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>
    </div>

    {catalog.loading ? (
      <LoadingBlock />
    ) : catalog.filteredModelsCount === 0 ? (
      <EmptyState
        title="No hay modelos"
        description="Todavía no hay modelos registrados. Crea el primero desde la vista Generar."
        icon={<UserSquare2 className="h-6 w-6" />}
        action={(
          <Link
            to="/models/generar"
            className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            Ir a Generar
          </Link>
        )}
      />
    ) : (
      <ul className="divide-y divide-gray-200">
        {catalog.pagedModels.map((model) => (
          <ModelLibraryItem
            key={model.id}
            model={model}
            clients={catalog.clients}
            isEditing={library.editingId === model.id}
            isExpanded={catalog.expandedId === model.id}
            isHighlighted={catalog.highlightedModelId === model.id}
            expandedId={catalog.expandedId}
            setExpandedId={catalog.setExpandedId}
            library={library}
          />
        ))}
      </ul>
    )}

    {catalog.modelsTotalPages > 1 && (
      <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
        <button
          onClick={() => catalog.setModelsPage((page) => Math.max(1, page - 1))}
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
            catalog.setModelsPage((page) => Math.min(catalog.modelsTotalPages, page + 1))
          }
          disabled={catalog.modelsPage === catalog.modelsTotalPages}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )}
  </div>
);
