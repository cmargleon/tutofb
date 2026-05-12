import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useRole } from '../features/auth/AuthProvider';
import { useNotifications } from '../features/notifications/useNotifications';
import { regenerateFailedBatchJobsFromNotification } from '../features/evaluation/firebase';
import { useToast } from '../features/feedback/FeedbackProvider';
import { Sidebar } from './layout/Sidebar';
import { GlobalSearch } from './layout/GlobalSearch';
import { buildNavigation, getCurrentPageTitle } from './layout/navigation';
import { Topbar } from './layout/Topbar';
import { useResponsiveSidebar } from './layout/useResponsiveSidebar';

export const Layout: React.FC = () => {
  const role = useRole();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [retryingBatchIds, setRetryingBatchIds] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const toast = useToast();
  const {
    isDesktop,
    isSidebarCollapsed,
    isMobileMenuOpen,
    setIsSidebarCollapsed,
    setIsMobileMenuOpen,
  } = useResponsiveSidebar();

  const notificationsState = useNotifications();
  const { onBellClick, onCloseNotif } = notificationsState;
  const navigation = buildNavigation(role);

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
  const shellClassName = [
    'app-shell flex h-screen overflow-hidden bg-gray-50',
    isDesktop ? 'app-shell--desktop' : 'app-shell--mobile',
    isDesktop && isSidebarCollapsed ? 'app-shell--collapsed' : 'app-shell--expanded',
  ].join(' ');

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
    <div className={shellClassName}>
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
        <Topbar
          currentPageTitle={currentPageTitle}
          isDesktop={isDesktop}
          pathname={location.pathname}
          role={role}
          notificationsState={notificationsState}
          retryingBatchIds={retryingBatchIds}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenSearch={handleOpenSearch}
          onBellClick={handleBellClick}
          onOpenBatchNotification={handleOpenBatchNotification}
          onRetryFailedBatch={(batchId) => void handleRetryFailedBatch(batchId)}
        />

        <div className="p-4 sm:p-6 xl:p-8">
          <Outlet />
        </div>
      </main>

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
};
