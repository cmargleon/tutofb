import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Bell, Menu, Rows3, Search, Wand2 } from 'lucide-react';
import { useRole } from '../features/auth/AuthProvider';
import { useNotifications } from '../features/notifications/useNotifications';
import { ImageThumb, StatusBadge } from './ui';
import { Sidebar } from './layout/Sidebar';
import { GlobalSearch } from './layout/GlobalSearch';
import { buildNavigation, getCurrentPageTitle } from './layout/navigation';

export const Layout: React.FC = () => {
  const role = useRole();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1280);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { queueCount, notifications, unreadCount, isNotifOpen, notifRef, onBellClick, onCloseNotif } =
    useNotifications();
  const navigation = buildNavigation(role);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)');
    const syncLayoutMode = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarCollapsed(!matches);
      setIsMobileMenuOpen(false);
    };
    syncLayoutMode(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => syncLayoutMode(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isDesktop) setIsMobileMenuOpen(false);
  }, [location.pathname, isDesktop]);

  useEffect(() => {
    setIsSearchOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onCloseNotif();
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
  }, [isSearchOpen, onCloseNotif]);

  const currentPageTitle = getCurrentPageTitle(location.pathname, navigation);

  const shellStyle = {
    ['--app-sidebar-width' as const]: isDesktop ? (isSidebarCollapsed ? '5rem' : '16rem') : '0rem',
  } as React.CSSProperties;

  const handleOpenSearch = () => {
    onCloseNotif();
    setIsSearchOpen(true);
  };

  const handleBellClick = () => {
    setIsSearchOpen(false);
    onBellClick();
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden" style={shellStyle}>
      {!isDesktop && isMobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-gray-900/40 xl:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <Sidebar
        isDesktop={isDesktop}
        isSidebarCollapsed={isSidebarCollapsed}
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleSidebar={() => setIsSidebarCollapsed((value) => !value)}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <main className="flex-1 overflow-auto min-w-0">
        {/* Topbar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 xl:px-6">
          {/* Left */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (!isDesktop ? setIsMobileMenuOpen(true) : null)}
              className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 xl:hidden"
              aria-label="Abrir menú lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="hidden sm:block text-sm font-medium text-slate-700">{currentPageTitle}</span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenSearch}
              className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm transition hover:border-gray-300 hover:text-slate-700"
              aria-label="Abrir búsqueda global"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Buscar clientes, modelos, batches</span>
              <span className="hidden rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 md:inline-flex">
                ⌘K
              </span>
            </button>

            {role.canCreateBatches && location.pathname !== '/generate' && (
              <Link
                to="/generate"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
              >
                <Wand2 className="w-4 h-4" /> Nuevo lote
              </Link>
            )}

            {queueCount > 0 && (
              <Link
                to="/cola"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
              >
                <Rows3 className="w-3.5 h-3.5" /> {queueCount} en cola
              </Link>
            )}

            {/* Notifications bell */}
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
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Notificaciones recientes</p>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin notificaciones recientes</div>
                  ) : (
                    <ul className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                      {notifications.map((job) => (
                        <li key={job.id}>
                          <Link
                            to={`/catalogo?clientId=${job.clientId}&batchId=${job.batchId}`}
                            onClick={onCloseNotif}
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
                  <div className="border-t border-gray-100 px-4 py-3">
                    <Link
                      to="/catalogo"
                      onClick={onCloseNotif}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Ver catálogo →
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

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};
