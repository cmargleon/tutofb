import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, Menu, Rows3, Search, Wand2 } from 'lucide-react';
import type { UseNotificationsReturn } from '../../features/notifications/useNotifications';
import type { RoleCapabilities } from '../../features/auth/AuthProvider';
import { NotificationMenu } from './NotificationMenu';

interface TopbarProps {
  currentPageTitle: string;
  isDesktop: boolean;
  pathname: string;
  role: RoleCapabilities;
  notificationsState: UseNotificationsReturn;
  retryingBatchIds: Record<string, boolean>;
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
  onBellClick: () => void;
  onOpenBatchNotification: (batchId: string, clientId: string) => void;
  onRetryFailedBatch: (batchId: string) => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentPageTitle,
  isDesktop,
  pathname,
  role,
  notificationsState,
  retryingBatchIds,
  onOpenMobileMenu,
  onOpenSearch,
  onBellClick,
  onOpenBatchNotification,
  onRetryFailedBatch,
}) => {
  const {
    queueCount,
    notifications,
    unreadCount,
    isNotifOpen,
    notifRef,
    onCloseNotif,
  } = notificationsState;

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 xl:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (!isDesktop) onOpenMobileMenu();
          }}
          className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 xl:hidden"
          aria-label="Abrir menú lateral"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="hidden text-sm font-medium text-slate-700 sm:block">{currentPageTitle}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm transition hover:border-gray-300 hover:text-slate-700"
          aria-label="Abrir búsqueda global"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden md:inline">Buscar clientes, modelos, batches</span>
          <span className="hidden rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 md:inline-flex">
            ⌘K
          </span>
        </button>

        {role.canCreateBatches && pathname !== '/generate' ? (
          <Link
            to="/generate"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            <Wand2 className="h-4 w-4" /> Nuevo lote
          </Link>
        ) : null}

        {queueCount > 0 ? (
          <Link
            to="/cola"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
          >
            <Rows3 className="h-3.5 w-3.5" /> {queueCount} en cola
          </Link>
        ) : null}

        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={onBellClick}
            className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Notificaciones"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>

          {isNotifOpen ? (
            <NotificationMenu
              notifications={notifications}
              retryingBatchIds={retryingBatchIds}
              onOpenBatch={onOpenBatchNotification}
              onRetryFailedBatch={onRetryFailedBatch}
              onClose={onCloseNotif}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
