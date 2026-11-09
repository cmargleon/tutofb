import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, MinusCircle, Loader2, X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
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

export const buttonClasses = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  `tuto-button tuto-button--${variant} tuto-button--${size}`;

export const INPUT_CLASS = 'tuto-field';

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
    aria-busy={loading || undefined}
    className={`${buttonClasses(variant as ButtonVariant, size as ButtonSize)} ${className}`}
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
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, icon: Icon, actions }) => (
  <header className="tuto-page-header">
   <div className="flex min-w-0 items-start gap-3">
    {Icon ? (
      <div className="tuto-page-icon">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
    ) : null}
    <div className="min-w-0">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
   </div>
   {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export const Surface = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={`tuto-surface ${className}`} {...props} />;

export const Breadcrumbs = ({ children, label = 'Ruta de navegación' }: { children: React.ReactNode; label?: string }) =>
  <nav aria-label={label} className="tuto-breadcrumbs">{children}</nav>;

export const SearchInput = ({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) =>
  <div className="tuto-search"><Search aria-hidden="true" /><input type="search" className={`${INPUT_CLASS} ${className}`} {...props} /></div>;

export const FilterBar = ({ children }: { children: React.ReactNode }) => <div className="tuto-filter-bar">{children}</div>;

export const DataTable = ({ children, caption, className = '' }: { children: React.ReactNode; caption: string; className?: string }) =>
  <div className="tuto-table-scroll" role="region" aria-label={caption} tabIndex={0}><table className={`tuto-table ${className}`}><caption className="sr-only">{caption}</caption>{children}</table></div>;

export const TableSkeleton = ({ message = 'Cargando datos…' }: { message?: string }) => <div role="status" aria-label={message} className="space-y-5 p-5"><span className="sr-only">{message}</span>{Array.from({ length: 5 }, (_, index) => <div key={index} aria-hidden="true" className="grid grid-cols-3 gap-8"><div className="app-skeleton h-9 rounded" /><div className="app-skeleton h-9 rounded" /><div className="app-skeleton h-9 rounded" /></div>)}</div>;

export const Pagination = ({ page, hasMore, loading, onPageChange, children }: {
  page: number; hasMore: boolean; loading: boolean; onPageChange: (page: number) => void; children?: React.ReactNode;
}) => <nav aria-label="Paginación" className="tuto-pagination"><div aria-live="polite">{children}</div><div className="tuto-pagination-controls"><Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Anterior</Button><span className="tuto-pagination-page">Página {page}</span><Button variant="secondary" size="sm" disabled={!hasMore || loading} onClick={() => onPageChange(page + 1)}>Siguiente<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></div></nav>;

export const SectionNav = ({ items, active, onSelect, label }: { items: readonly (readonly [string, string])[]; active: string; onSelect: (id: string) => void; label: string }) =>
  <nav aria-label={label} className="tuto-section-nav">{items.map(([id, name]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{name}</button>)}</nav>;

// ─── LoadingBlock ─────────────────────────────────────────────────────────────

export const LoadingBlock: React.FC<{ message?: string }> = ({ message }) => (
  <div className="app-loading-block" role="status" aria-label={message || 'Cargando'}>
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
  <div className="tuto-empty">
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
  active:        { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Activo', icon: CheckCircle2 },
  archived:      { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Archivado', icon: MinusCircle },
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
  previewOnClick?: boolean;
}

export const ImageThumb: React.FC<ImageThumbProps> = ({
  storagePath,
  alt = 'Thumbnail',
  fit = 'cover',
  imgClassName = '',
  previewOnClick = false,
}) => {
  const { url, loading } = useStorageAssetUrl(storagePath);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

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

  const image = (
    <img
      src={url}
      alt={alt}
      className={`h-full w-full rounded-md border border-gray-200 bg-white ${fit === 'contain' ? 'object-contain' : 'object-cover'} ${imgClassName}`.trim()}
      referrerPolicy="no-referrer"
    />
  );

  if (!previewOnClick) return image;

  return (
    <>
      <button
        type="button"
        aria-label={`Ampliar foto: ${alt}`}
        aria-haspopup="dialog"
        className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500"
        onClick={() => setIsPreviewOpen(true)}
      >
        {image}
      </button>
      {isPreviewOpen && <ImagePreview url={url} alt={alt} onClose={() => setIsPreviewOpen(false)} />}
    </>
  );
};

const ImagePreview: React.FC<{ url: string; alt: string; onClose: () => void }> = ({ url, alt, onClose }) => {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Foto ampliada: ${alt}`}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-black/95 p-0 text-white backdrop:bg-black"
      onClose={onClose}
    >
      <div
        className="grid h-full place-items-center"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div
          className="group cursor-zoom-in overflow-hidden"
          onPointerMove={(event) => {
            if (event.pointerType !== 'mouse') return;

            const frame = event.currentTarget;
            const { left, top, width, height } = frame.getBoundingClientRect();
            if (!width || !height) return;

            frame.style.setProperty('--image-origin', `${(event.clientX - left) / width * 100}% ${(event.clientY - top) / height * 100}%`);
            frame.dataset.zoomed = 'true';
          }}
          onPointerLeave={(event) => delete event.currentTarget.dataset.zoomed}
        >
          <img
            src={url}
            alt={alt}
            referrerPolicy="no-referrer"
            className="pointer-events-none block max-h-dvh max-w-full origin-(--image-origin) transition-transform group-data-[zoomed=true]:scale-200 motion-reduce:transition-none"
          />
        </div>
        <button
          type="button"
          autoFocus
          aria-label="Cerrar foto"
          className="absolute top-4 right-4 cursor-pointer rounded-full bg-black/70 p-2 hover:bg-black focus-visible:outline-2 focus-visible:outline-white"
          onClick={() => dialogRef.current?.close()}
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
};
