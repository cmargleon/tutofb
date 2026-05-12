import React from 'react';
import { Link } from 'react-router-dom';
import { Images, RefreshCw, Search } from 'lucide-react';
import type { BatchNotificationItem } from '../../features/notifications/batchNotifications';
import { buildBatchNotificationDescription } from '../../features/notifications/batchNotifications';
import { formatDateTimeShortNumeric } from '../../../shared/src/utils/dateUtils';

interface NotificationMenuProps {
  notifications: BatchNotificationItem[];
  retryingBatchIds: Record<string, boolean>;
  onOpenBatch: (batchId: string, clientId: string) => void;
  onRetryFailedBatch: (batchId: string) => void;
  onClose: () => void;
}

export const NotificationMenu: React.FC<NotificationMenuProps> = ({
  notifications,
  retryingBatchIds,
  onOpenBatch,
  onRetryFailedBatch,
  onClose,
}) => (
  <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
    <div className="border-b border-gray-100 px-4 py-3">
      <p className="text-sm font-semibold text-slate-900">Notificaciones recientes</p>
    </div>

    {notifications.length === 0 ? (
      <div className="px-4 py-6 text-center text-sm text-slate-400">Sin notificaciones recientes</div>
    ) : (
      <ul className="max-h-72 divide-y divide-gray-50 overflow-y-auto">
        {notifications.map(({ batch, outcome, canRetry, showReviewIcon }) => {
          const isCompleted = outcome === 'completed';
          const isRetrying = Boolean(retryingBatchIds[batch.id]);

          return (
            <li key={batch.id}>
              <div
                role="link"
                tabIndex={0}
                onClick={() => onOpenBatch(batch.id, batch.clientId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenBatch(batch.id, batch.clientId);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-gray-50"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                    isCompleted
                      ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                      : 'border-rose-100 bg-rose-50 text-rose-600'
                  }`}
                >
                  <Images className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">{batch.clientNameSnapshot}</p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        isCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {isCompleted ? 'Exitoso' : 'Fallido'}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{batch.modelNameSnapshot}</p>
                  <p className="truncate text-xs text-slate-400">{buildBatchNotificationDescription(batch)}</p>
                  <p className="truncate text-[11px] text-slate-400">{formatDateTimeShortNumeric(batch.updatedAt)}</p>
                </div>

                {canRetry ? (
                  <button
                    type="button"
                    aria-label="Reintentar jobs fallidos"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryFailedBatch(batch.id);
                    }}
                    disabled={isRetrying}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
                  </button>
                ) : showReviewIcon ? (
                  <Search className="h-4 w-4 shrink-0 text-rose-500" aria-label="Revisar lote fallido" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    )}

    <div className="border-t border-gray-100 px-4 py-3">
      <Link
        to="/catalogo"
        onClick={onClose}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
      >
        Ver catálogo →
      </Link>
    </div>
  </div>
);
