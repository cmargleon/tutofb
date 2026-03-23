import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useTheme } from '../features/theme/ThemeProvider';
import { useGlobalSearch, type GlobalSearchResult } from '../features/search/useGlobalSearch';
import {
  LayoutDashboard,
  Users,
  UserSquare2,
  Wand2,
  Archive,
  Eye,
  Rows3,
  BarChart3,
  Shield,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Sun,
  Moon,
  Bell,
  Search,
} from 'lucide-react';
import { AnalyticsSummary, Batch, Job } from '../../shared/src/types';
import { ImageThumb, StatusBadge } from './ui';
import { useToast } from '../features/feedback/FeedbackProvider';

export const Layout: React.FC = () => {
  const { appUser } = useAuth();
  const role = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1280);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Topbar state
  const [queueCount, setQueueCount] = useState(0);
  const [notifications, setNotifications] = useState<Job[]>([]);
  const [notifSeenAt, setNotifSeenAt] = useState(() => {
    const stored = localStorage.getItem('notifSeenAt');
    return stored ? parseInt(stored, 10) : 0;
  });
  const sessionStartRef = useRef(Date.now());
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const toast = useToast();
  const isFirstBatchSnapshotRef = useRef(true);
  const { recentResults, search } = useGlobalSearch({
    enabledClients: role.canManageClients,
    enabledModels: role.canManageModels,
    enabledBatches: role.canEvaluate,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const syncLayoutMode = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarCollapsed(!matches);
      setIsMobileMenuOpen(false);
    };

    syncLayoutMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncLayoutMode(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      setIsMobileMenuOpen(false);
    }
  }, [location.pathname, isDesktop]);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSelectedSearchIndex(0);
  }, [location.pathname, location.search, location.hash]);

  // Firebase subscriptions: queue count + notifications
  useEffect(() => {
    const unsubQueue = onSnapshot(doc(db, 'analytics_summary', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as AnalyticsSummary;
        setQueueCount((data.pendingJobs ?? 0) + (data.processingJobs ?? 0));
      } else {
        setQueueCount(0);
      }
    });

    const unsubNotif = onSnapshot(
      query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(30)),
      (snap) => {
        const jobs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Job))
          .filter((j) => j.status === 'completed' || j.status === 'failed');
        setNotifications(jobs.slice(0, 8));
      },
    );

    const unsubBatches = onSnapshot(
      query(collection(db, 'batches'), orderBy('updatedAt', 'desc'), limit(20)),
      (snap) => {
        if (isFirstBatchSnapshotRef.current) {
          isFirstBatchSnapshotRef.current = false;
          return;
        }
        snap.docChanges().forEach((change) => {
          if (change.type !== 'modified') return;
          const batch = { id: change.doc.id, ...change.doc.data() } as Batch;
          const client = batch.clientNameSnapshot;
          const model = batch.modelNameSnapshot;
          if (batch.status === 'completed') {
            toast({
              title: 'Lote completado',
              description: `${client} · ${model} · ${batch.completedJobs} imágenes`,
              tone: 'success',
              durationMs: 6000,
            });
          } else if (batch.status === 'partial_failed') {
            toast({
              title: 'Lote parcialmente completado',
              description: `${client} · ${model} · ${batch.failedJobs} jobs fallaron`,
              tone: 'warning',
              durationMs: 6000,
            });
          } else if (batch.status === 'failed') {
            toast({
              title: 'Lote fallido',
              description: `${client} · ${model}`,
              tone: 'error',
              durationMs: 6000,
            });
          }
        });
      },
    );

    return () => { unsubQueue(); unsubNotif(); unsubBatches(); };
  }, [toast]);

  // Click-outside to close notification dropdown
  useEffect(() => {
    if (!isNotifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isNotifOpen]);

  useEffect(() => {
    if (!isSearchOpen) return;

    const focusId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(focusId);
  }, [isSearchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsNotifOpen(false);
        setIsSearchOpen((open) => !open);
        return;
      }

      if (event.key === 'Escape' && isSearchOpen) {
        event.preventDefault();
        setIsSearchOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSearchOpen]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard',   path: '/',          icon: LayoutDashboard, visible: role.isActive           },
    { name: 'Generar',     path: '/generate',   icon: Wand2,           visible: role.canCreateBatches  },
    { name: 'Cola',        path: '/cola',       icon: Rows3,           visible: role.canEvaluate        },
    { name: 'Evaluación',  path: '/evaluacion', icon: Eye,             visible: role.canEvaluate        },
    { name: 'Clientes',    path: '/clients',    icon: Users,           visible: role.canManageClients   },
    { name: 'Modelos',     path: '/models',     icon: UserSquare2,     visible: role.canManageModels    },
    { name: 'Archivo',     path: '/archivo',    icon: Archive,         visible: role.canAccessArchive   },
    { name: 'Analíticas',  path: '/analytics',  icon: BarChart3,       visible: role.canAccessAnalytics },
    { name: 'Usuarios',    path: '/users',      icon: Shield,          visible: role.canManageUsers     },
  ];

  const filteredNav = navItems.filter((item) => item.visible);
  const sidebarWidthClass = isSidebarCollapsed ? 'xl:w-20' : 'xl:w-64';
  const shellStyle = {
    ['--app-sidebar-width' as const]: isDesktop ? (isSidebarCollapsed ? '5rem' : '16rem') : '0rem',
  } as React.CSSProperties;

  const isActiveRoute = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const currentPageTitle = navItems.find((item) => isActiveRoute(item.path))?.name ?? '';

  const unreadCount = notifications.filter((j) => {
    const ms = j.createdAt && typeof (j.createdAt as any).toMillis === 'function'
      ? (j.createdAt as any).toMillis()
      : 0;
    return ms > Math.max(sessionStartRef.current, notifSeenAt);
  }).length;

  const handleBellClick = () => {
    setIsSearchOpen(false);
    setIsNotifOpen((open) => !open);
    const now = Date.now();
    setNotifSeenAt(now);
    localStorage.setItem('notifSeenAt', String(now));
  };

  const searchResults = useMemo(() => search(searchQuery), [search, searchQuery]);
  const hasSearchResults = searchResults.length > 0;
  const selectedSearchResult = searchResults[selectedSearchIndex] ?? null;

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (selectedSearchIndex <= searchResults.length - 1) return;
    setSelectedSearchIndex(0);
  }, [searchResults.length, selectedSearchIndex]);

  const openSearch = () => {
    setIsNotifOpen(false);
    setSearchQuery('');
    setSelectedSearchIndex(0);
    setIsSearchOpen(true);
  };

  const closeSearch = () => {
    setIsSearchOpen(false);
  };

  const submitSearchResult = (result: GlobalSearchResult | null) => {
    if (!result) return;
    closeSearch();
    navigate(result.href);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!hasSearchResults) return;
      setSelectedSearchIndex((current) => (current + 1) % searchResults.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hasSearchResults) return;
      setSelectedSearchIndex((current) => (current - 1 + searchResults.length) % searchResults.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      submitSearchResult(selectedSearchResult);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  };

  const getSearchResultIcon = (type: GlobalSearchResult['type']) => {
    switch (type) {
      case 'client':
        return Users;
      case 'model':
        return UserSquare2;
      case 'batch':
        return Rows3;
      default:
        return Search;
    }
  };

  const getSearchResultTypeLabel = (type: GlobalSearchResult['type']) => {
    switch (type) {
      case 'client':
        return 'Cliente';
      case 'model':
        return 'Modelo';
      case 'batch':
        return 'Batch';
      default:
        return 'Resultado';
    }
  };

  const renderSidebarContent = (collapsed: boolean) => (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 min-h-[73px]">
        <div className="min-w-0">
          <h1 className={`font-bold text-indigo-600 ${collapsed ? 'text-base' : 'text-xl'}`}>
            {collapsed ? 'VT' : 'Virtual Try-On'}
          </h1>
        </div>
        {!isDesktop ? (
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {filteredNav.map((item) => {
          const active = isActiveRoute(item.path);
          return (
            <Link
              key={item.name}
              to={item.path}
              title={collapsed ? item.name : undefined}
              className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : 'gap-3'
              } ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <item.icon
                className={`w-5 h-5 shrink-0 ${active ? 'text-indigo-600' : ''}`}
              />
              {!collapsed ? <span>{item.name}</span> : null}
              {active && !collapsed ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-600" aria-hidden="true" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Footer: user + theme toggle + logout */}
      <div className="p-3 border-t border-gray-200 space-y-0.5">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 ${
            collapsed ? 'justify-center' : 'gap-3'
          }`}
        >
          {isDark ? (
            <Sun className="w-4 h-4 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 shrink-0" />
          )}
          {!collapsed ? <span>{isDark ? 'Tema claro' : 'Tema oscuro'}</span> : null}
        </button>

        {/* User info */}
        <div className={`flex items-center px-3 py-2 ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-7 h-7 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
            {appUser?.displayName?.charAt(0) || 'A'}
          </div>
          {!collapsed ? (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{appUser?.displayName || 'Admin User'}</p>
              <p className="text-xs text-gray-500 truncate capitalize">{appUser?.role || 'sin rol'}</p>
            </div>
          ) : null}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
            collapsed ? 'justify-center' : 'gap-2'
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed ? <span>Cerrar sesión</span> : null}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={shellStyle}>
      {!isDesktop && isMobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white border-r border-gray-200 transition-transform duration-200 xl:static xl:translate-x-0 xl:transition-[width] ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${sidebarWidthClass}`}
      >
        {renderSidebarContent(isDesktop && isSidebarCollapsed)}
      </aside>

      <main className="flex-1 overflow-auto min-w-0">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 xl:px-6">
          {/* Left */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (isDesktop ? setIsSidebarCollapsed((value) => !value) : setIsMobileMenuOpen(true))}
              className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label={isDesktop ? 'Colapsar menú lateral' : 'Abrir menú lateral'}
            >
              {isDesktop ? (
                isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
            <span className="hidden sm:block text-sm font-medium text-slate-700">
              {currentPageTitle}
            </span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSearch}
              className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm transition hover:border-gray-300 hover:text-slate-700"
              aria-label="Abrir búsqueda global"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Buscar clientes, modelos, batches</span>
              <span className="hidden rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 md:inline-flex">
                ⌘K
              </span>
            </button>

            {/* Nuevo lote */}
            {role.canCreateBatches && location.pathname !== '/generate' && (
              <Link
                to="/generate"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
              >
                <Wand2 className="w-4 h-4" /> Nuevo lote
              </Link>
            )}

            {/* Queue indicator */}
            {queueCount > 0 && (
              <Link
                to="/cola"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
              >
                <Rows3 className="w-3.5 h-3.5" /> {queueCount} en cola
              </Link>
            )}

            {/* Bell / Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={handleBellClick}
                className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Notificaciones"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {isNotifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  {/* Header */}
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Notificaciones recientes</p>
                  </div>
                  {/* List */}
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin notificaciones recientes</div>
                  ) : (
                    <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                      {notifications.map((job) => (
                        <li key={job.id}>
                          <Link
                            to={`/archivo?batchId=${job.batchId}`}
                            onClick={() => setIsNotifOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                          >
                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-100">
                              {job.garmentFilePath
                                ? <ImageThumb storagePath={job.garmentFilePath} alt="" fit="contain" />
                                : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">{job.clientNameSnapshot}</p>
                              <p className="truncate text-xs text-slate-500">{job.modelNameSnapshot} · {job.id?.slice(0, 8)}</p>
                            </div>
                            <StatusBadge status={job.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Footer */}
                  <div className="border-t border-gray-100 px-4 py-3">
                    <Link
                      to="/archivo"
                      onClick={() => setIsNotifOpen(false)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Ver archivo →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="p-4 sm:p-6 xl:p-8">
          <Outlet />
        </div>
      </main>

      {isSearchOpen ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/45 px-4 py-8 backdrop-blur-sm sm:px-6" onClick={closeSearch}>
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
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Busca clientes, modelos o batches por nombre, cliente o ID..."
                  className="w-full border-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                >
                  Esc
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {hasSearchResults ? (
                <ul className="space-y-1">
                  {searchResults.map((result, index) => {
                    const Icon = getSearchResultIcon(result.type);
                    const isSelected = index === selectedSearchIndex;
                    return (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          type="button"
                          onClick={() => submitSearchResult(result)}
                          onMouseEnter={() => setSelectedSearchIndex(index)}
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
      ) : null}
    </div>
  );
};
