import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Images, Menu, RefreshCw, Rows3, Search, Wand2 } from 'lucide-react';
import { useRole } from '../features/auth/AuthProvider';
import { useNotifications } from '../features/notifications/useNotifications';
import { regenerateFailedBatchJobsFromNotification } from '../features/evaluation/firebase';
import { useToast } from '../features/feedback/FeedbackProvider';
import { buildBatchNotificationDescription } from '../features/notifications/batchNotifications';
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
  const [retryingBatchIds, setRetryingBatchIds] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const toast = useToast();

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

  const handleOpenBatchNotification = (batchId: string, clientId: string) => {
    onCloseNotif();
    navigate(`/catalogo?clientId=${clientId}&batchId=${batchId}`);
  };

  const handleRetryFailedBatch = async (batchId: string) => {
    setRetryingBatchIds((current) => ({ ...current, [batchId]: true }));

    try {
      const result = await regenerateFailedBatchJobsFromNotification(batchId);
      toast({
        title: 'Reintento encolado',
        description: result.queuedJobs > 0
          ? `${result.queuedJobs} jobs fallidos volverán a procesarse.`
          : 'No había jobs fallidos para reintentar.',
        tone: result.queuedJobs > 0 ? 'success' : 'info',
      });
    } catch (error) {
      console.error('Error retrying failed batch from notification:', error);
      toast({
        title: 'No se pudo reintentar el lote',
        description: error instanceof Error ? error.message : 'Intenta nuevamente.',
        tone: 'error',
      });
    } finally {
      setRetryingBatchIds((current) => {
        const next = { ...current };
        delete next[batchId];
        return next;
      });
    }
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
                      {notifications.map(({ batch, outcome, canRetry, showReviewIcon }) => (
                        <li key={batch.id}>
                          <div
                            role="link"
                            tabIndex={0}
                            onClick={() => handleOpenBatchNotification(batch.id, batch.clientId)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleOpenBatchNotification(batch.id, batch.clientId);
                              }
                            }}
                            className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                          >
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                              outcome === 'completed'
                                ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                                : 'border-rose-100 bg-rose-50 text-rose-600'
                            }`}>
                              <Images className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium text-slate-900">{batch.clientNameSnapshot}</p>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  outcome === 'completed'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}>
                                  {outcome === 'completed' ? 'Exitoso' : 'Fallido'}
                                </span>
                              </div>
                              <p className="truncate text-xs text-slate-500">{batch.modelNameSnapshot}</p>
                              <p className="truncate text-xs text-slate-400">{buildBatchNotificationDescription(batch)}</p>
                            </div>
                            {canRetry ? (
                              <button
                                type="button"
                                aria-label="Reintentar jobs fallidos"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRetryFailedBatch(batch.id);
                                }}
                                disabled={Boolean(retryingBatchIds[batch.id])}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <RefreshCw className={`h-4 w-4 ${retryingBatchIds[batch.id] ? 'animate-spin' : ''}`} />
                              </button>
                            ) : showReviewIcon ? (
                              <Search className="h-4 w-4 shrink-0 text-rose-500" aria-label="Revisar lote fallido" />
                            ) : null}
                          </div>
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
