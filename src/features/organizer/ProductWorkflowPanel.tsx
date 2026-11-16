import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { OrganizerProductWorkflow } from '../../../shared/src/types';
import { Button } from '../../components/ui';
import { workflowUrl } from './productWorkflow';

const referenceLabels = { pending: 'Pendientes', suggested: 'Propuestas', approved: 'Aprobadas', rejected: 'Rechazadas' };

export function ProductWorkflowPanel({ workflow, batchId, canGenerate, canEditReferences, refresh }: {
  workflow: OrganizerProductWorkflow;
  batchId: string;
  canGenerate: boolean;
  canEditReferences: boolean;
  refresh: () => void;
}) {
  const navigate = useNavigate();
  const { context, variant, references, generations } = workflow;
  const selected = batchId ? generations.find(generation => generation.batchId === batchId) : generations[0];
  const generate = workflowUrl('/generate', context, { batchId });
  const photos = workflowUrl('/organizador', context, { batchId, view: 'photos' });
  const review = selected && workflowUrl('/catalogo', context, { batchId: selected.batchId });
  const exportUrl = selected?.masterProductIds.length === 1 && workflowUrl('/catalogo', context, { batchId: selected.batchId, view: 'export' });
  const next = batchId && !selected ? null
    : selected?.attention ? { to: review, label: 'Revisar fotos que requieren atención' }
    : selected?.inProgress ? { to: review, label: 'Consultar generación en curso' }
    : selected?.approved ? { to: exportUrl || review, label: exportUrl ? 'Validar exportación por canal' : 'Revisar resultados' }
    : workflow.pendingAutomation ? null
    : variant.referenceState !== 'approved' ? { to: photos, label: 'Revisar referencias' }
    : canGenerate && canEditReferences ? { to: generate, label: 'Preparar generación' }
    : null;
  return <section aria-label="Recorrido del producto" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-slate-600">Producto base · {variant.base}</p>
        <h2 className="text-xl font-semibold text-slate-900">{workflow.baseName}</h2>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Variante visual
          <select className="tuto-field mt-1" value={context.variantId} onChange={event =>
            navigate(workflowUrl('/organizador', { ...context, variantId: event.target.value }))}>
            {workflow.variants.map(item => <option key={item.id} value={item.id}>
              {[item.visual, item.color, item.pack, item.capacity].filter(Boolean).join(' · ')}
            </option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-col items-start gap-2">
        {next?.to && <Link className="tuto-link inline-flex items-center gap-2 font-semibold" to={next.to}>
          Siguiente paso · {next.label} <ArrowRight size={16} aria-hidden="true" />
        </Link>}
        {canGenerate && canEditReferences && variant.referenceState === 'approved' && next?.to !== generate &&
          <Link className="tuto-link text-sm" to={generate}>Preparar nueva generación</Link>}
      </div>
    </header>
    <div className="border-t border-slate-200 pt-4">
      <h3 className="font-semibold">Referencias <span className="ml-2 text-sm font-medium text-slate-600">{referenceLabels[variant.referenceState]}</span></h3>
      {references.length ? <ul className="my-2 grid gap-1 text-sm sm:grid-cols-2">{references.map(reference => <li key={reference.id}>
        <span className="text-slate-600">{reference.view} · </span>
        {reference.sourceUrl ? <a className="tuto-link break-all" href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.name}</a>
          : <span>{reference.name} (archivo no disponible)</span>}
      </li>)}</ul> : <p className="mt-2 text-sm text-slate-600">Sin referencias seleccionadas.</p>}
      <Link className="tuto-link text-sm" to={photos}>Ver fotografías de la variante</Link>
    </div>
    <div className="border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Historial de generaciones</h3>
        <Button variant="ghost" size="sm" onClick={refresh}>Actualizar historial</Button>
      </div>
      {workflow.pendingAutomation > 0 && <p className="text-sm text-slate-600">{workflow.pendingAutomation} solicitudes de Automatización pendientes de crear lote.</p>}
      {batchId && !selected && <p role="alert" className="text-sm text-amber-800">El lote de este enlace no está disponible para esta variante. <Link className="tuto-link" to={workflowUrl('/organizador', context)}>Ver historial de la variante</Link></p>}
      {!generations.length && <p className="mt-2 text-sm text-slate-600">Aún no hay lotes vinculados. La validación de exportación estará disponible cuando exista un lote.</p>}
      <ul className="mt-2 divide-y divide-slate-100">{generations.map(generation => <li key={generation.batchId}
        className="flex flex-wrap items-center justify-between gap-2 py-3" aria-current={batchId === generation.batchId ? 'true' : undefined}>
        <div>
          <p className="text-sm font-medium text-slate-900">{generation.createdAt ? new Date(generation.createdAt).toLocaleString('es') : 'Fecha no disponible'}
            <span className="ml-2 break-all font-mono text-xs text-slate-600">{generation.batchId}</span>
          </p>
          <p className="text-sm text-slate-600">{generation.approved} {generation.approved === 1 ? 'aprobada' : 'aprobadas'} · {generation.attention} {generation.attention === 1 ? 'requiere' : 'requieren'} atención · {generation.inProgress} en curso · {generation.cancelled} {generation.cancelled === 1 ? 'cancelada' : 'canceladas'}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="tuto-link" to={workflowUrl('/catalogo', context, { batchId: generation.batchId })}>Revisar lote</Link>
          {generation.masterProductIds.length === 1 && <Link className="tuto-link" to={workflowUrl('/catalogo', context, { batchId: generation.batchId, view: 'export' })}>Ver requisitos de exportación</Link>}
        </div>
      </li>)}</ul>
      <p className="mt-2 text-xs text-slate-600">El historial incluye lotes con un vínculo registrado a esta variante. Las generaciones antiguas sin ese vínculo siguen disponibles en el Catálogo.</p>
    </div>
  </section>;
}
