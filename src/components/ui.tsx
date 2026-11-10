import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Clock, MinusCircle, Loader2, X, Search, ChevronLeft, ChevronRight, Info, Check } from 'lucide-react';
import { useStorageAssetUrl } from '../features/storage/useStorageAssetUrl';

/*
 * Tuto shared UI primitives. Visual rules live in src/styles/design-system.css;
 * these components only compose semantic `tuto-*` classes.
 */

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

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

/** Square, icon-only button. `label` is required and becomes the accessible name. */
export const IconButton: React.FC<Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string; icon: React.ElementType; size?: 'sm' | 'md';
}> = ({ label, icon: Icon, size = 'md', className = '', type = 'button', ...props }) => (
  <button type={type} aria-label={label} title={props.title ?? label} className={cx('tuto-icon-button', size === 'sm' && 'tuto-icon-button--sm', className)} {...props}>
    <Icon aria-hidden="true" />
  </button>
);

// ─── Page layout ─────────────────────────────────────────────────────────────

/** Standard page wrapper: consistent width and vertical rhythm between sections. */
export const Page = ({ width = 'full', className = '', children, as: Tag = 'div', ...props }: React.HTMLAttributes<HTMLElement> & {
  width?: 'full' | 'medium' | 'narrow'; as?: 'div' | 'main' | 'section';
}) => <Tag className={cx('tuto-page', width !== 'full' && `tuto-page--${width}`, className)} {...props}>{children}</Tag>;

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  /** Small elements rendered under the title (status badges, counters). */
  meta?: React.ReactNode;
  /** Rendered above the title (e.g. <Breadcrumbs/>). */
  breadcrumbs?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, icon: Icon, actions, meta, breadcrumbs }) => (
  <header className="tuto-page-header">
    {breadcrumbs ? <div className="w-full">{breadcrumbs}</div> : null}
    <div className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-3">
      {Icon ? (
        <div className="tuto-page-icon">
          <Icon aria-hidden="true" />
        </div>
      ) : null}
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="tuto-page-header-meta">{meta}</div>}
      </div>
    </div>
    {actions && <div className="tuto-page-header-actions">{actions}</div>}
  </header>
);

// ─── Surfaces ────────────────────────────────────────────────────────────────

export const Surface = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) =>
  <div className={`tuto-surface ${className}`} {...props} />;

/** Alias kept for readability in new code: a Card is a Surface. */
export const Card = Surface;

export const CardHeader: React.FC<{
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ElementType; as?: 'h2' | 'h3'; className?: string;
}> = ({ title, description, actions, icon: Icon, as: Heading = 'h2', className = '' }) => (
  <div className={cx('tuto-card-header', className)}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon ? <span className="tuto-stat-icon tuto-tone--accent h-8 w-8"><Icon aria-hidden="true" /></span> : null}
      <div className="min-w-0"><Heading>{title}</Heading>{description ? <p>{description}</p> : null}</div>
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const CardBody = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cx('tuto-card-body', className)} {...props} />;
export const CardFooter = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cx('tuto-card-footer', className)} {...props} />;

/** Heading + description for a section inside a page or card. */
export const SectionHeading: React.FC<{ title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; as?: 'h2' | 'h3' }> = ({ title, description, actions, as: Heading = 'h2' }) => (
  <div className="tuto-toolbar mb-4">
    <div className="min-w-0"><Heading className="tuto-section-title">{title}</Heading>{description ? <p className="tuto-section-description">{description}</p> : null}</div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

// ─── Navigation primitives ───────────────────────────────────────────────────

export const Breadcrumbs = ({ children, label = 'Ruta de navegación' }: { children: React.ReactNode; label?: string }) =>
  <nav aria-label={label} className="tuto-breadcrumbs">{children}</nav>;

export const SectionNav = ({ items, active, onSelect, label }: { items: readonly (readonly [string, string])[]; active: string; onSelect: (id: string) => void; label: string }) =>
  <nav aria-label={label} className="tuto-section-nav">{items.map(([id, name]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}>{name}</button>)}</nav>;

/** Segmented view switch. Children are links/buttons; mark the active one with aria-current="page" or aria-pressed. */
export const Segmented = ({ children, label }: { children: React.ReactNode; label: string }) =>
  <nav aria-label={label} className="tuto-segmented">{children}</nav>;

// ─── Forms ───────────────────────────────────────────────────────────────────

export const SearchInput = ({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) =>
  <div className="tuto-search"><Search aria-hidden="true" /><input type="search" className={`${INPUT_CLASS} ${className}`} {...props} /></div>;

/**
 * Label + control + hint. The label wraps the control, so the control's accessible
 * name is the label text (same semantics as the existing inline <label> pattern).
 */
export const Field: React.FC<{
  label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string;
}> = ({ label, hint, error, children, className = '' }) => (
  <label className={cx('tuto-form-field', className)}>
    <span className="tuto-label">{label}</span>
    {children}
    {hint ? <span className="tuto-hint">{hint}</span> : null}
    {error ? <span className="tuto-error-text" role="alert">{error}</span> : null}
  </label>
);

export const Switch: React.FC<{
  checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean; className?: string;
}> = ({ checked, onCheckedChange, label, disabled, className = '' }) => (
  <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onCheckedChange(!checked)} className={cx('tuto-switch', className)}>
    <span aria-hidden="true" />
  </button>
);

export const FilterBar = ({ children }: { children: React.ReactNode }) => <div className="tuto-filter-bar">{children}</div>;

// ─── Data display ────────────────────────────────────────────────────────────

export const DataTable = ({ children, caption, className = '' }: { children: React.ReactNode; caption: string; className?: string }) =>
  <div className="tuto-table-scroll" role="region" aria-label={caption} tabIndex={0}><table className={`tuto-table ${className}`}><caption className="sr-only">{caption}</caption>{children}</table></div>;

export const Skeleton = ({ className = '' }: { className?: string }) => <div aria-hidden="true" className={cx('app-skeleton rounded-md', className)} />;

export const TableSkeleton = ({ message = 'Cargando datos…', rows = 6 }: { message?: string; rows?: number }) => <div role="status" aria-label={message} className="divide-y divide-slate-100"><span className="sr-only">{message}</span>{Array.from({ length: rows }, (_, index) => <div key={index} aria-hidden="true" className="flex items-center gap-4 px-5 py-3.5"><div className="app-skeleton h-8 w-8 rounded-md" /><div className="app-skeleton h-3.5 w-48 max-w-[30%] rounded" /><div className="app-skeleton ml-auto h-3.5 w-20 rounded-full" /><div className="app-skeleton hidden h-3.5 w-32 rounded sm:block" /></div>)}</div>;

export const Pagination = ({ page, hasMore, loading, onPageChange, children }: {
  page: number; hasMore: boolean; loading: boolean; onPageChange: (page: number) => void; children?: React.ReactNode;
}) => <nav aria-label="Paginación" className="tuto-pagination"><div aria-live="polite">{children}</div><div className="tuto-pagination-controls"><Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Anterior</Button><span className="tuto-pagination-page">Página {page}</span><Button variant="secondary" size="sm" disabled={!hasMore || loading} onClick={() => onPageChange(page + 1)}>Siguiente<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></div></nav>;

export const Badge: React.FC<{
  tone?: Tone; dot?: boolean; icon?: React.ElementType; children: React.ReactNode; className?: string;
}> = ({ tone = 'neutral', dot = false, icon: Icon, children, className = '' }) => (
  <span className={cx('tuto-badge', tone !== 'neutral' && `tuto-badge--${tone}`, className)}>
    {dot ? <span className="tuto-badge-dot" aria-hidden="true" /> : Icon ? <Icon aria-hidden="true" /> : null}
    {children}
  </span>
);

const ALERT_ICON: Record<Exclude<Tone, 'neutral' | 'accent'>, React.ElementType> = { info: Info, success: Check, warning: AlertTriangle, danger: XCircle };

export const Alert: React.FC<{
  tone?: 'info' | 'success' | 'warning' | 'danger'; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string;
}> = ({ tone = 'info', title, children, action, className = '' }) => {
  const Icon = ALERT_ICON[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('tuto-alert', `tuto-alert--${tone}`, className)}>
      <Icon aria-hidden="true" />
      <div className="min-w-0 flex-1">{title ? <p className="tuto-alert-title">{title}</p> : null}{children ? <div className={title ? 'mt-0.5' : undefined}>{children}</div> : null}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
};

export const StatCard: React.FC<{
  label: React.ReactNode; value: React.ReactNode; icon?: React.ElementType; tone?: Tone; hint?: React.ReactNode; className?: string;
}> = ({ label, value, icon: Icon, tone = 'neutral', hint, className = '' }) => (
  <div className={cx('tuto-surface tuto-stat', className)}>
    <div className="min-w-0">
      <p className="tuto-stat-label">{label}</p>
      <p className="tuto-stat-value">{value}</p>
      {hint ? <p className="tuto-stat-hint">{hint}</p> : null}
    </div>
    {Icon ? <span className={`tuto-stat-icon tuto-tone--${tone}`}><Icon aria-hidden="true" /></span> : null}
  </div>
);

// ─── Wizard stepper ──────────────────────────────────────────────────────────

export const Stepper = ({ steps, current, onSelect, canSelect, label = 'Pasos' }: {
  steps: readonly { id: number; label: string; caption?: string }[];
  current: number;
  onSelect?: (id: number) => void;
  canSelect?: (id: number) => boolean;
  label?: string;
}) => (
  <nav aria-label={label}>
    <ol className="tuto-stepper">
      {steps.map((step, index) => {
        const state = step.id === current ? 'current' : step.id < current ? 'done' : 'upcoming';
        const enabled = !!onSelect && (canSelect ? canSelect(step.id) : step.id < current);
        return (
          <li key={step.id} className="flex min-w-0 flex-1">
            <button type="button" className="tuto-step w-full" data-state={state} aria-current={state === 'current' ? 'step' : undefined} disabled={!enabled && state !== 'current'} onClick={() => enabled && onSelect?.(step.id)}>
              <span className="tuto-step-index" aria-hidden="true">{state === 'done' ? <Check /> : index + 1}</span>
              <span className="min-w-0"><span className="tuto-step-label">{step.label}</span>{step.caption ? <span className="tuto-step-caption">{step.caption}</span> : null}</span>
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);

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
    {icon && <div className="tuto-empty-icon" aria-hidden="true">{icon}</div>}
    <h3>{title}</h3>
    <p>{description}</p>
    {action && <div className="tuto-empty-action">{action}</div>}
  </div>
);

// ─── StatusBadge ─────────────────────────────────────────────────────────────

interface StatusConfig {
  tone: Tone;
  label: string;
  icon: React.ElementType;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  active:          { tone: 'success', label: 'Activo', icon: CheckCircle2 },
  archived:        { tone: 'neutral', label: 'Archivado', icon: MinusCircle },
  importing:       { tone: 'info', label: 'Importando', icon: Loader2 },
  review:          { tone: 'warning', label: 'Revisión', icon: Clock },
  needs_attention: { tone: 'warning', label: 'Requiere atención', icon: AlertTriangle },
  completed:       { tone: 'success', label: 'Completado', icon: CheckCircle2 },
  processing:      { tone: 'info', label: 'Procesando', icon: Loader2 },
  partial_failed:  { tone: 'warning', label: 'Parcial', icon: AlertTriangle },
  failed:          { tone: 'danger', label: 'Fallido', icon: XCircle },
  cancelled:       { tone: 'neutral', label: 'Cancelado', icon: MinusCircle },
  pending:         { tone: 'warning', label: 'Pendiente', icon: Clock },
};

const DEFAULT_STATUS: StatusConfig = { tone: 'warning', label: 'Pendiente', icon: Clock };

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_CONFIG[status] ?? DEFAULT_STATUS;
  const Icon = config.icon;
  const isSpinning = status === 'processing' || status === 'importing';

  return (
    <span className={cx('tuto-badge', config.tone !== 'neutral' && `tuto-badge--${config.tone}`)}>
      <Icon className={isSpinning ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
      {config.label}
    </span>
  );
};

// ─── ImageThumb ───────────────────────────────────────────────────────────────

interface ImageThumbProps {
  storagePath: string | null | undefined;
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
