import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rows3, Search, UserSquare2, Users } from 'lucide-react';
import { useGlobalSearch, type GlobalSearchResult } from '../../features/search/useGlobalSearch';
import { useRole } from '../../features/auth/AuthProvider';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const getSearchResultIcon = (type: GlobalSearchResult['type']) => {
  switch (type) {
    case 'client': return Users;
    case 'model': return UserSquare2;
    case 'batch': return Rows3;
    default: return Search;
  }
};

const getSearchResultTypeLabel = (type: GlobalSearchResult['type']) => {
  switch (type) {
    case 'client': return 'Cliente';
    case 'model': return 'Modelo';
    case 'batch': return 'Batch';
    default: return 'Resultado';
  }
};

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const role = useRole();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { recentResults, search } = useGlobalSearch({
    enabledClients: role.canManageClients,
    enabledModels: role.canManageModels,
    enabledBatches: role.canEvaluate,
  });

  const searchResults = useMemo(() => search(searchQuery), [search, searchQuery]);
  const hasResults = searchResults.length > 0;
  const selectedResult = searchResults[selectedIndex] ?? null;

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (selectedIndex <= searchResults.length - 1) return;
    setSelectedIndex(0);
  }, [searchResults.length, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedIndex(0);
    const focusId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(focusId);
  }, [isOpen]);

  const submitResult = (result: GlobalSearchResult | null) => {
    if (!result) return;
    onClose();
    navigate(result.href);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!hasResults) return;
      setSelectedIndex((current) => (current + 1) % searchResults.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hasResults) return;
      setSelectedIndex((current) => (current - 1 + searchResults.length) % searchResults.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submitResult(selectedResult);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[70] bg-slate-950/45 px-4 py-8 backdrop-blur-sm sm:px-6 ${isOpen ? '' : 'hidden'}`}
      onClick={onClose}
    >
      <div
        className="mx-auto mt-[8vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 shrink-0 text-slate-400" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Busca clientes, modelos o batches por nombre, cliente o ID..."
              className="w-full border-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              Esc
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {hasResults ? (
            <ul className="space-y-1">
              {searchResults.map((result, index) => {
                const Icon = getSearchResultIcon(result.type);
                const isSelected = index === selectedIndex;
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      type="button"
                      onClick={() => submitResult(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                        isSelected ? 'bg-indigo-50 text-indigo-950' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                        isSelected ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{result.title}</p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {getSearchResultTypeLabel(result.type)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{result.subtitle}</p>
                      </div>
                      {result.meta ? (
                        <div className="hidden shrink-0 text-right text-xs text-slate-400 sm:block">
                          {result.meta}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Search className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-900">
                {searchQuery.trim() ? 'No encontramos coincidencias' : 'Empieza a escribir para buscar'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {searchQuery.trim()
                  ? 'Prueba con nombre de cliente, modelo o ID del batch.'
                  : 'Puedes abrir clientes, modelos y batches recientes desde aquí.'}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-400 sm:px-5">
          <span>{searchQuery.trim() ? `${searchResults.length} resultado${searchResults.length === 1 ? '' : 's'}` : `${recentResults.length} accesos rápidos`}</span>
          <span>Usa ↑ ↓ para navegar y Enter para abrir</span>
        </div>
      </div>
    </div>
  );
};
