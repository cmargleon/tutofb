import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'warning' | 'info';
type ConfirmTone = 'danger' | 'warning' | 'info';

interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ConfirmOptions {
  title: string;
  description: string;
  impact?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface ConfirmByNameOptions {
  title: string;
  description: string;
  entityName: string;
  entityLabel: string;
  impact?: string;
  confirmLabel?: string;
  tone?: ConfirmTone;
}

interface FeedbackContextValue {
  toast: (options: ToastOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmByName: (options: ConfirmByNameOptions) => Promise<boolean>;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'tone' | 'durationMs'>> {
  id: string;
  description?: string;
}

interface DialogState extends Required<Pick<ConfirmOptions, 'title' | 'description' | 'confirmLabel' | 'cancelLabel' | 'tone'>> {
  impact?: string;
  resolve: (result: boolean) => void;
}

interface NameInputDialogState {
  title: string;
  description: string;
  entityName: string;
  entityLabel: string;
  impact?: string;
  confirmLabel: string;
  tone: ConfirmTone;
  resolve: (result: boolean) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_STYLES: Record<
  ToastTone,
  {
    icon: React.ElementType;
    container: string;
    iconColor: string;
    titleColor: string;
    descriptionColor: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    container: 'border-emerald-200 bg-emerald-50/95',
    iconColor: 'text-emerald-600',
    titleColor: 'text-emerald-950',
    descriptionColor: 'text-emerald-800',
  },
  error: {
    icon: XCircle,
    container: 'border-red-200 bg-red-50/95',
    iconColor: 'text-red-600',
    titleColor: 'text-red-950',
    descriptionColor: 'text-red-800',
  },
  warning: {
    icon: TriangleAlert,
    container: 'border-amber-200 bg-amber-50/95',
    iconColor: 'text-amber-600',
    titleColor: 'text-amber-950',
    descriptionColor: 'text-amber-800',
  },
  info: {
    icon: Info,
    container: 'border-indigo-200 bg-indigo-50/95',
    iconColor: 'text-indigo-600',
    titleColor: 'text-indigo-950',
    descriptionColor: 'text-indigo-800',
  },
};

const DIALOG_STYLES: Record<
  ConfirmTone,
  {
    icon: React.ElementType;
    iconWrap: string;
    iconColor: string;
    confirmButton: string;
    impactBox: string;
    impactLabel: string;
    impactText: string;
  }
> = {
  danger: {
    icon: AlertTriangle,
    iconWrap: 'bg-red-100',
    iconColor: 'text-red-600',
    confirmButton: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    impactBox: 'border-red-200 bg-red-50',
    impactLabel: 'text-red-900',
    impactText: 'text-red-800',
  },
  warning: {
    icon: TriangleAlert,
    iconWrap: 'bg-amber-100',
    iconColor: 'text-amber-600',
    confirmButton: 'bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500',
    impactBox: 'border-amber-200 bg-amber-50',
    impactLabel: 'text-amber-900',
    impactText: 'text-amber-800',
  },
  info: {
    icon: Info,
    iconWrap: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    confirmButton: 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
    impactBox: 'border-indigo-200 bg-indigo-50',
    impactLabel: 'text-indigo-900',
    impactText: 'text-indigo-800',
  },
};

const NameInputDialog: React.FC<{
  dialog: NameInputDialogState;
  onClose: (result: boolean) => void;
}> = ({ dialog, onClose }) => {
  const [typedValue, setTypedValue] = useState('');
  const matches = typedValue === dialog.entityName;
  const style = DIALOG_STYLES[dialog.tone];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-4 sm:items-center"
      onClick={() => onClose(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-name-dialog-title"
        className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 p-6">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${style.iconWrap}`}>
            {React.createElement(style.icon, { className: `h-6 w-6 ${style.iconColor}` })}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="feedback-name-dialog-title" className="text-lg font-semibold text-slate-900">
              {dialog.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{dialog.description}</p>
          </div>
        </div>

        {dialog.impact ? (
          <div className="px-6 pb-2">
            <div className={`rounded-2xl border px-4 py-3 ${style.impactBox}`}>
              <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${style.impactLabel}`}>Impacto</p>
              <p className={`mt-2 text-sm leading-6 ${style.impactText}`}>{dialog.impact}</p>
            </div>
          </div>
        ) : null}

        <div className="px-6 pb-2">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Escribe {dialog.entityLabel} para confirmar:
          </label>
          <p className="mb-2 select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-900">
            {dialog.entityName}
          </p>
          <input
            type="text"
            autoFocus
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches) onClose(true); }}
            placeholder="Escribe aquí…"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!matches}
            onClick={() => onClose(true)}
            className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-40 ${style.confirmButton}`}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const buildToastId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameInputDialogState | null>(null);
  const timeoutIdsRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((currentToasts) => currentToasts.filter((toastItem) => toastItem.id !== id));

    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    ({ title, description, durationMs = 4500, tone = 'info' }: ToastOptions) => {
      const id = buildToastId();

      setToasts((currentToasts) => [...currentToasts, { id, title, description, durationMs, tone }]);

      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
      }, durationMs);

      timeoutIdsRef.current.set(id, timeoutId);
    },
    [dismissToast],
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        title: options.title,
        description: options.description,
        impact: options.impact,
        confirmLabel: options.confirmLabel || (options.tone === 'danger' ? 'Confirmar acción' : 'Continuar'),
        cancelLabel: options.cancelLabel || 'Cancelar',
        tone: options.tone || 'info',
        resolve,
      });
    });
  }, []);

  const closeDialog = useCallback((result: boolean) => {
    setDialog((currentDialog) => {
      currentDialog?.resolve(result);
      return null;
    });
  }, []);

  const confirmByName = useCallback((options: ConfirmByNameOptions) => {
    return new Promise<boolean>((resolve) => {
      setNameDialog({
        title: options.title,
        description: options.description,
        entityName: options.entityName,
        entityLabel: options.entityLabel,
        impact: options.impact,
        confirmLabel: options.confirmLabel || 'Confirmar',
        tone: options.tone || 'danger',
        resolve,
      });
    });
  }, []);

  const closeNameDialog = useCallback((result: boolean) => {
    setNameDialog((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!dialog && !nameDialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (nameDialog) closeNameDialog(false);
        else closeDialog(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dialog, nameDialog, closeDialog, closeNameDialog]);

  const value = useMemo<FeedbackContextValue>(
    () => ({
      toast,
      confirm,
      confirmByName,
    }),
    [toast, confirm, confirmByName],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex justify-center px-4 sm:justify-end sm:px-6"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex w-full max-w-sm flex-col gap-3">
          {toasts.map((toastItem) => {
            const style = TOAST_STYLES[toastItem.tone];
            const Icon = style.icon;

            return (
              <div
                key={toastItem.id}
                role={toastItem.tone === 'error' ? 'alert' : 'status'}
                className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${style.container}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 ${style.iconColor}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${style.titleColor}`}>{toastItem.title}</p>
                    {toastItem.description ? (
                      <p className={`mt-1 text-sm ${style.descriptionColor}`}>{toastItem.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(toastItem.id)}
                    className="rounded-full p-1 text-slate-400 hover:bg-white/70 hover:text-slate-600"
                    aria-label="Cerrar notificación"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {nameDialog && typeof document !== 'undefined'
        ? createPortal(
            <NameInputDialog dialog={nameDialog} onClose={closeNameDialog} />,
            document.body,
          )
        : null}

      {dialog && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/65 p-4 sm:items-center"
              onClick={() => closeDialog(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="feedback-dialog-title"
                className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start gap-4 p-6">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                      DIALOG_STYLES[dialog.tone].iconWrap
                    }`}
                  >
                    {React.createElement(DIALOG_STYLES[dialog.tone].icon, {
                      className: `h-6 w-6 ${DIALOG_STYLES[dialog.tone].iconColor}`,
                    })}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id="feedback-dialog-title" className="text-lg font-semibold text-slate-900">
                      {dialog.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{dialog.description}</p>
                  </div>
                </div>

                {dialog.impact ? (
                  <div className="px-6 pb-2">
                    <div className={`rounded-2xl border px-4 py-3 ${DIALOG_STYLES[dialog.tone].impactBox}`}>
                      <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${DIALOG_STYLES[dialog.tone].impactLabel}`}>
                        Impacto
                      </p>
                      <p className={`mt-2 text-sm leading-6 ${DIALOG_STYLES[dialog.tone].impactText}`}>{dialog.impact}</p>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => closeDialog(false)}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    {dialog.cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeDialog(true)}
                    className={`inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 ${DIALOG_STYLES[dialog.tone].confirmButton}`}
                  >
                    {dialog.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </FeedbackContext.Provider>
  );
};

const useFeedbackContext = () => {
  const context = useContext(FeedbackContext);

  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }

  return context;
};

export const useToast = () => useFeedbackContext().toast;

export const useConfirm = () => useFeedbackContext().confirm;

export const useConfirmByName = () => useFeedbackContext().confirmByName;
