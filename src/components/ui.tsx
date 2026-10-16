import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, MinusCircle, Loader2 } from 'lucide-react';
import { useStorageAssetUrl } from '../features/storage/useStorageAssetUrl';

// ─── Button ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ElementType;
}

const BUTTON_BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:   'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 border border-transparent shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-indigo-500 shadow-sm',
  ghost:     'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:ring-slate-400 border border-transparent',
  danger:    'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500 border border-transparent shadow-sm',
  warning:   'bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500 border border-transparent shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-5 py-2.5 text-sm rounded-xl',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  disabled,
  className = '',
  ...props
}) => (
  <button
    disabled={disabled || loading}
    className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    {...props}
  >
    {loading ? (
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
    ) : Icon ? (
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
    ) : null}
    {children}
  </button>
);

// ─── PageHeader ──────────────────────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ElementType;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, icon: Icon }) => (
  <div className="mb-8 flex items-start gap-4">
    {Icon ? (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
        <Icon className="h-5 w-5" />
      </div>
    ) : null}
    <div>
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-gray-500">{description}</p>}
    </div>
  </div>
);

// ─── LoadingBlock ─────────────────────────────────────────────────────────────

export const LoadingBlock: React.FC<{ message?: string }> = ({ message }) => (
  <div className="app-loading-block">
    <span className="app-spinner app-spinner-lg" aria-hidden="true" />
    {message ? <p className="text-sm text-gray-500">{message}</p> : null}
  </div>
);

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action }) => (
  <div className="text-center p-12 bg-white rounded-xl border border-gray-100 shadow-sm">
    {icon && (
      <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 text-indigo-600 mb-4">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-gray-900">{title}</h3>
    <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">{description}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

// ─── StatusBadge ─────────────────────────────────────────────────────────────

interface StatusConfig {
  bg: string;
  text: string;
  label: string;
  icon: React.ElementType;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  importing:      { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Importando', icon: Loader2 },
  review:         { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Revisión', icon: Clock },
  needs_attention: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Requiere atención', icon: AlertTriangle },
  completed:      { bg: 'bg-green-100',   text: 'text-green-800',  label: 'Completado', icon: CheckCircle2  },
  processing:     { bg: 'bg-blue-100',    text: 'text-blue-800',   label: 'Procesando', icon: Loader2       },
  partial_failed: { bg: 'bg-amber-100',   text: 'text-amber-800',  label: 'Parcial',    icon: AlertTriangle },
  failed:         { bg: 'bg-red-100',     text: 'text-red-800',    label: 'Fallido',    icon: XCircle       },
  cancelled:      { bg: 'bg-slate-200',   text: 'text-slate-700',  label: 'Cancelado',  icon: MinusCircle   },
  pending:        { bg: 'bg-yellow-100',  text: 'text-yellow-800', label: 'Pendiente',  icon: Clock         },
};

const DEFAULT_STATUS: StatusConfig = { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pendiente', icon: Clock };

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_CONFIG[status] ?? DEFAULT_STATUS;
  const Icon = config.icon;
  const isSpinning = status === 'processing';

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <Icon className={`h-3 w-3 shrink-0 ${isSpinning ? 'animate-spin' : ''}`} aria-hidden="true" />
      {config.label}
    </span>
  );
};

// ─── ImageThumb ───────────────────────────────────────────────────────────────

interface ImageThumbProps {
  storagePath: string;
  alt?: string;
  fit?: 'cover' | 'contain';
  imgClassName?: string;
}

export const ImageThumb: React.FC<ImageThumbProps> = ({
  storagePath,
  alt = 'Thumbnail',
  fit = 'cover',
  imgClassName = '',
}) => {
  const { url, loading } = useStorageAssetUrl(storagePath);

  if (loading) {
    return <div className="app-skeleton h-full w-full rounded-md" />;
  }

  if (!url) {
    return (
      <div className="w-full h-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 rounded-md">
        Error
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={`h-full w-full rounded-md border border-gray-200 bg-white ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${imgClassName}`.trim()}
      referrerPolicy="no-referrer"
    />
  );
};
