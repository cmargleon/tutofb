import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, Download } from 'lucide-react';
import type { Batch } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTime } from '../../../shared/src/utils/dateUtils';
import { StatCard } from '../../components/ui';
import { catalogBatchUrl } from './attention';
import { ACTION_BATCH_LIMIT, ACTION_JOB_LIMIT, GENERATION_STATUSES } from './firebase';
import type { DashboardResult, useDashboard } from './useDashboard';

const stateLabels = { loading: 'Cargando…', error: 'Error de consulta', unavailable: 'No disponible' } as const;
const formatCount = new Intl.NumberFormat('es');

export const countLabel = (result: DashboardResult<number>) =>
  result.status === 'ready' ? formatCount.format(result.data) : stateLabels[result.status];

type BatchAction = { batch: Batch; detail: string };

const BatchActionList = ({ items, label }: { items: BatchAction[]; label: string }) => (
  <ul className="divide-y divide-slate-100 px-4" aria-label={label}>
    {items.map(({ batch, detail }) => (
      <li key={batch.id}>
        <Link to={catalogBatchUrl(batch.clientId, batch.id!)} className="block rounded px-1 py-2.5 hover:bg-slate-50">
          <p className="break-words text-sm font-semibold text-slate-800">{batch.clientNameSnapshot || batch.clientId} · {formatDateTime(batch.createdAt)}</p>
          <p className="text-xs text-slate-600">{detail} <span className="font-medium text-sky-700">· {label}</span></p>
        </Link>
      </li>
    ))}
  </ul>
);

const AttentionCard = ({ label, icon, tone, count, hint, actions, actionLabel, children }: {
  label: string;
  icon: React.ElementType;
  tone: 'info' | 'warning' | 'success';
  count: DashboardResult<number>;
  hint: string;
  actions: BatchAction[];
  actionLabel: string;
  children?: React.ReactNode;
}) => (
  <article aria-label={label} className="min-w-0 rounded-2xl border border-slate-200 bg-white">
    <StatCard label={label} value={<span aria-live="polite" className={count.status === 'ready' ? 'tabular-nums' : 'text-base'}>{countLabel(count)}</span>} icon={icon} tone={tone} hint={hint} className="!border-0 !shadow-none" />
    {actions.length > 0 && <BatchActionList items={actions} label={actionLabel} />}
    {children}
  </article>
);

const checkedCount = <T,>(checks: DashboardResult<{ result: DashboardResult<T> }[]>, value: number): DashboardResult<number> => {
  if (checks.status !== 'ready') return checks;
  if (checks.data.some(({ result }) => result.status === 'error')) return { status: 'error' };
  if (checks.data.some(({ result }) => result.status === 'unavailable')) return { status: 'unavailable' };
  return { status: 'ready', data: value };
};

export const DashboardAttention = ({ attention, exports, canRegenerate }: Pick<
  ReturnType<typeof useDashboard>, 'attention' | 'exports'
> & { canRegenerate: boolean }) => {
  const checked = attention.status === 'ready' ? attention.data : [];
  const checks = checked.flatMap(({ result }) => result.status === 'ready' ? [result.data] : []);
  const review = checks.filter(check => check.pendingReview > 0);
  const incidents = checks.filter(check => check.incidents > 0);
  const unverified = checked.filter(({ result }) => result.status !== 'ready');

  const exportChecks = exports.status === 'ready' ? exports.data : [];
  const ready: BatchAction[] = [];
  const exportIssues: BatchAction[] = [];
  for (const { batch, result } of exportChecks) {
    if (result.status !== 'ready') {
      exportIssues.push({ batch, detail: stateLabels[result.status] });
      continue;
    }
    const channels = result.data.channels.filter(channel => channel.ready);
    if (channels.length > 0) {
      const names = channels.map(channel => MARKETPLACES.find(item => item.id === channel.marketplaceId)?.name || channel.marketplaceId);
      ready.push({ batch, detail: names.join(', ') });
    } else {
      const issue = result.data.channels.flatMap(channel => channel.issues)[0];
      exportIssues.push({ batch, detail: issue?.message || 'Sin destinos habilitados' });
    }
  }

  return (
    <section aria-labelledby="dashboard-attention">
      <h2 id="dashboard-attention" className="text-lg font-semibold text-slate-900">Requiere atención</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">Hasta {ACTION_BATCH_LIMIT} lotes más recientes de tus clientes autorizados.</p>
      <div className="grid gap-3 lg:grid-cols-3">
        <AttentionCard label="Pendiente de revisión" icon={ClipboardCheck} tone="info"
          count={checkedCount(attention, review.reduce((total, check) => total + check.pendingReview, 0))}
          hint="Trabajos terminados con imagen, sin aprobación automática ni selección manual."
          actions={review.map(({ batch, pendingReview }) => ({ batch, detail: `${formatCount.format(pendingReview)} por revisar` }))}
          actionLabel="Revisar lote"
        />
        <AttentionCard label="Bloqueado o con incidencias" icon={AlertTriangle} tone="warning"
          count={checkedCount(attention, incidents.reduce((total, check) => total + check.incidents, 0))}
          hint="Trabajos fallidos, marcados, sin imagen al terminar o con procesamiento vencido. Las cancelaciones manuales quedan fuera del recuento de fallos."
          actions={incidents.map(({ batch, incidents: count }) => ({ batch, detail: `${formatCount.format(count)} con incidencias` }))}
          actionLabel={canRegenerate ? 'Gestionar lote' : 'Ver lote'}
        />
        <AttentionCard label="Listo para exportar" icon={Download} tone="success"
          count={checkedCount(exports, ready.length)}
          hint="Lotes sin generación activa que superan la validación de al menos un destino habilitado."
          actions={ready} actionLabel="Ver lote y exportar"
        >
          {exportIssues.length > 0 && (
            <details className="border-t border-slate-100 py-2">
              <summary className="cursor-pointer px-4 py-1 text-sm font-medium text-slate-600">Lotes para comprobar ({exportIssues.length})</summary>
              <BatchActionList items={exportIssues} label="Ver lote y sus requisitos" />
            </details>
          )}
        </AttentionCard>
      </div>
      {unverified.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 py-2">
          <p className="px-4 text-sm font-medium text-slate-800">La revisión de lotes quedó incompleta.</p>
          <BatchActionList items={unverified.map(({ batch, result }) => ({
            batch,
            detail: result.status === 'unavailable' ? `Supera el límite de ${formatCount.format(ACTION_JOB_LIMIT)} trabajos de Inicio` : 'No se pudieron consultar los trabajos',
          }))} label="Abrir lote" />
        </div>
      )}
    </section>
  );
};

const generationLabels = { pending: 'En espera', processing: 'Procesando', completed: 'Generación completada', failed: 'Fallidos o cancelados' };

export const DashboardGeneration = ({ counts }: Pick<ReturnType<typeof useDashboard>, 'counts'>) => (
  <section aria-labelledby="dashboard-generation" className="tuto-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 id="dashboard-generation" className="font-semibold text-slate-900">Totales de generación</h2>
        <p className="text-sm text-slate-600">Todos los trabajos de tus clientes autorizados, por estado actual.</p>
      </div>
      <Link to="/cola" className="text-sm font-semibold text-sky-700 hover:underline">Abrir cola operativa</Link>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-live="polite">
      {GENERATION_STATUSES.map(status => (
        <div key={status} className="rounded-xl bg-slate-50 px-3 py-2">
          <dt className="text-sm text-slate-600">{generationLabels[status]}</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{countLabel(counts[status])}</dd>
        </div>
      ))}
    </dl>
  </section>
);
