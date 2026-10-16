import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { PROVIDER_VALUES, PROVIDER_LABELS } from '../../shared/src/domain';
import { AutomationJob, Provider } from '../../shared/src/types';
import { PRODUCT_SCENES } from '../../shared/src/productGeneration';
import { Button, ImageThumb, PageHeader, StatusBadge } from '../components/ui';
import { useAutomation } from '../features/automation/useAutomation';

const date = (value: any) => value?.toDate ? value.toDate().toLocaleString('es') : '—';
const labelClass = 'flex flex-col gap-2 text-sm font-medium text-slate-700';
const inputClass = 'rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900';
const timestamps = (job: AutomationJob) => [
  ['Creado', job.createdAt], ['Actualizado', job.updatedAt], ['Iniciado', job.startedAt], ['Completado', job.completedAt], ['Fallo / atención', job.failedAt],
] as const;

export const Automation: React.FC<{ intake?: boolean }> = ({ intake = false }) => {
  const [search] = useSearchParams();
  const resume = search.get('resume') || undefined;
  const state = useAutomation(resume);
  const selected = state.jobs.find((job) => job.id === search.get('job'));
  const client = state.clients.find((entry) => entry.id === state.clientId);
  return <div className="mx-auto max-w-6xl space-y-6">
    <PageHeader title="Automatización" description="Producción de imágenes desde una entrada mínima o un sistema externo." icon={Workflow} />
    <nav className="flex gap-3 text-sm" aria-label="Automatización">
      <Link className="rounded-xl border bg-white px-4 py-2" to="/automation">Trabajos</Link>
      {state.canCreate && <Link className="rounded-xl border bg-white px-4 py-2" to="/automation/intake">Nueva entrada</Link>}
    </nav>
    {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{state.error}</p>}
    {intake ? <form className="max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={(event) => { event.preventDefault(); void state.submit(resume); }}>
      <h2 className="text-lg font-semibold">{resume ? 'Completar entrada pendiente' : 'Enviar a producción'}</h2>
      {resume && <p className="break-all text-sm text-slate-600">Trabajo: {resume}. El cliente y el tipo originales se conservarán.</p>}
      <label className={labelClass}>Cliente<select className={inputClass} required={!resume} disabled={Boolean(resume) || state.busy} value={state.clientId} onChange={(event) => { state.setClientId(event.target.value); state.setModelId(''); state.setPreset(''); }}>
        <option value="">Seleccionar cliente</option>{state.clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <label className={labelClass}>Tipo<select className={inputClass} disabled={Boolean(resume) || state.busy} value={state.jobType} onChange={(event) => { state.setJobType(event.target.value as 'garment' | 'product'); state.setPreset(''); }}>
        <option value="garment">Prendas</option><option value="product">Productos generales</option>
      </select></label>
      {state.jobType === 'garment' && <label className={labelClass}>Modelo humano<select className={inputClass} value={state.modelId} onChange={(event) => state.setModelId(event.target.value)}>
        <option value="">Usar configuración del cliente</option>{state.models.filter((entry) => entry.clientId === state.clientId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select><span className="text-xs font-normal text-slate-500">Si no hay modelo configurado, el trabajo requerirá atención.</span></label>}
      <label className={labelClass}>Preset<select className={inputClass} value={state.preset} onChange={(event) => state.setPreset(event.target.value)}>
        <option value="">Default del cliente</option><option value={state.jobType === 'product' ? 'generic_product' : 'standard'}>{state.jobType === 'product' ? `Producto genérico · ${PRODUCT_SCENES.length} escenas (4 lifestyle + 2 con personas)` : 'Standard · poses del modelo'}</option>
        {Object.keys(client?.automation?.presets || {}).filter((name) => name !== 'standard' && name !== 'generic_product').map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label className={labelClass}>Modelo de generación<select className={inputClass} value={state.provider} disabled={state.busy} onChange={(event) => state.setProvider(event.target.value as Provider | '')}>
        <option value="">Usar el modelo del preset del cliente</option>
        {PROVIDER_VALUES.map((provider) => <option key={provider} value={provider} disabled={state.disabledProviders.includes(provider)}>{PROVIDER_LABELS[provider]}{state.disabledProviders.includes(provider) ? ' (deshabilitado)' : ''}</option>)}
      </select></label>
      <label className={labelClass}>Imágenes<input className={inputClass} required={!resume} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={state.busy} onChange={(event) => state.changeFiles(Array.from(event.target.files || []))} /></label>
      <label className="flex gap-2 text-sm text-slate-600"><input type="checkbox" checked={state.sameItem} disabled={state.busy} onChange={(event) => { state.setSameItem(event.target.checked); state.changeFiles(state.files); }} />Todas las fotos muestran el mismo artículo (hasta 4 vistas)</label>
      <p className="text-xs text-slate-500">{state.files.length} fotos. Sin agrupar, cada foto es un artículo independiente.</p>
      <Button type="submit" loading={state.busy} disabled={!resume && !state.files.length}>{resume ? 'Reintentar AutomationJob' : 'Crear AutomationJob'}</Button>
    </form> : <>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-slate-600"><tr>{['Fecha / cliente', 'Origen / tipo', 'Estado', 'Imágenes', 'Reintentos', 'Detalle'].map((label) => <th className="p-4" key={label}>{label}</th>)}</tr></thead>
          <tbody>{state.jobs.map((job) => <tr key={job.id} className="border-b border-slate-100">
            <td className="p-4">{date(job.createdAt)}<div className="font-medium">{state.clients.find((client) => client.id === job.clientId)?.name || job.clientId}</div></td>
            <td className="p-4">{job.source}<div className="text-slate-500">{job.jobType}</div></td>
            <td className="p-4"><StatusBadge status={job.status} /></td><td className="p-4">{job.inputImages.length} entradas · {job.outputImages.length} salidas</td><td className="p-4">{job.retryCount}</td>
            <td className="p-4"><Link className="font-medium text-indigo-600" to={`/automation?job=${job.id}`}>Abrir</Link></td>
          </tr>)}</tbody></table>
        {!state.jobs.length && <p className="p-8 text-sm text-slate-500">Aún no hay trabajos. Se muestran los 100 más recientes.</p>}
      </div>
      {selected && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6" aria-label="Detalle de AutomationJob">
        <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="break-all font-semibold">{selected.id}</h2><StatusBadge status={selected.status} /></div>
        <p className="text-sm">{selected.progress.completed} / {selected.progress.total} completados · {selected.progress.failed} fallidos · preset {selected.requestedPreset || 'default'}</p>
        {selected.driveUrl && <a className="text-sm text-indigo-600" href={selected.driveUrl} target="_blank" rel="noreferrer">Abrir fuente de Drive</a>}
        {(selected.sourceImages || selected.inputImages).filter((image) => image.url).map((image, index) => <a key={index} className="block text-sm text-indigo-600" href={image.url} target="_blank" rel="noreferrer">Fuente: {image.fileName}</a>)}
        {selected.batchId && <Link className="block text-sm text-indigo-600" to={`/catalogo?clientId=${selected.clientId}&batchId=${selected.batchId}`}>Batch: {selected.batchId}</Link>}
        {selected.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{selected.error.code}: {selected.error.message}</p>}
        {!selected.batchId && ['failed', 'needs_attention'].includes(selected.status) && <div className="flex flex-wrap gap-3">
          <Button variant="secondary" loading={state.busy} disabled={selected.retryCount >= 2} onClick={() => void state.retry(selected)}>Reintentar entrada</Button>
          <Link className="px-3 py-2 text-sm text-indigo-600" to={`/automation/intake?resume=${selected.id}`}>Completar modelo / sustituir imágenes</Link>
        </div>}
        <dl className="grid gap-3 text-xs text-slate-600 sm:grid-cols-3">{timestamps(selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 font-medium">{date(value)}</dd></div>)}</dl>
        <h3 className="font-medium">Entradas</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-6">{selected.inputImages.map((image, index) => <figure key={index}><div className="aspect-square"><ImageThumb storagePath={image.storagePath} alt={image.fileName} fit="contain" /></div><figcaption className="mt-1 truncate text-xs">{image.fileName}</figcaption></figure>)}</div>
        <h3 className="font-medium">Resultados aprobados</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{selected.outputImages.map((image) => <figure key={image.jobId}><div className="aspect-square"><ImageThumb storagePath={image.storagePath} alt={image.type} fit="contain" /></div><figcaption className="mt-1 text-xs">{image.type}</figcaption></figure>)}</div>
        {selected.batchId && <p className="text-xs text-slate-500">Abre el batch para revisar intentos, costos y reintentar jobs de generación.</p>}
      </section>}
    </>}
  </div>;
};
