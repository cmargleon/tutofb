import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, Menu, Rows3, Search, Wand2 } from 'lucide-react';
import type { UseNotificationsReturn } from '../../features/notifications/useNotifications';
import type { RoleCapabilities } from '../../features/auth/AuthProvider';
import { NotificationMenu } from './NotificationMenu';
import { Breadcrumbs, buttonClasses, IconButton } from '../ui';

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

  const segments = (currentPageTitle || 'Tuto').split(' / ');

  return (
    <header className="tuto-topbar flex items-center justify-between gap-3 px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          label="Abrir menú lateral"
          icon={Menu}
          className="xl:hidden"
          onClick={() => {
            if (!isDesktop) onOpenMobileMenu();
          }}
        />
        <Breadcrumbs label="Ubicación actual">
          {segments.map((segment, index) => {
            const last = index === segments.length - 1;
            return (
              <React.Fragment key={`${segment}-${index}`}>
                {index > 0 ? <span className="tuto-breadcrumb-sep hidden sm:inline" aria-hidden="true">{' / '}</span> : null}
                <span className={last ? 'tuto-breadcrumb-current' : 'hidden truncate sm:inline'}>{segment}</span>
              </React.Fragment>
            );
          })}
        </Breadcrumbs>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="tuto-search-trigger"
          aria-label="Abrir búsqueda global"
        >
          <Search aria-hidden="true" />
          <span className="hidden flex-1 text-left md:inline">Buscar en Tuto…</span>
          <kbd className="tuto-kbd hidden md:inline-flex">⌘K</kbd>
        </button>

        {queueCount > 0 ? (
          <Link to="/cola" className="tuto-badge tuto-badge--warning hidden min-h-7 sm:inline-flex" title="Abrir la cola de procesamiento">
            <Rows3 aria-hidden="true" /> {queueCount} en cola
          </Link>
        ) : null}

        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={onBellClick}
            className="tuto-icon-button relative"
            aria-label="Notificaciones"
            aria-expanded={isNotifOpen}
          >
            <Bell aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--color-bg-surface)]">
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

        {role.canCreateBatches && pathname !== '/generate' ? (
          <Link to="/generate" className={buttonClasses('primary', 'md')} aria-label="Nuevo lote">
            <Wand2 aria-hidden="true" /> <span className="hidden sm:inline">Nuevo lote</span>
          </Link>
        ) : null}
      </div>
    </header>
  );
};
