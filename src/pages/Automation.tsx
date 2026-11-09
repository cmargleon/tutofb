import { MarketplaceExportAction } from '../features/marketplaces/MarketplaceExportDrawer';
import { remainingAutomationBudget } from '../../shared/src/automationPolicy';
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { DEFAULT_IMAGE_PROVIDER, PROVIDER_VALUES, PROVIDER_LABELS } from '../../shared/src/domain';
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
  const state = useAutomation(resume, search.get('job') || undefined);
  const selected = state.selectedJob || state.jobs.find((job) => job.id === search.get('job'));
  const client = state.clients.find((entry) => entry.id === state.clientId);
  const driveFolderIds = client?.automation?.driveFolderIds ?? [];
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
      </select><span className="text-xs font-normal text-slate-500">Se elegirá el predeterminado masculino o femenino del cliente según la prenda. Si solo hay uno disponible, se usará ese modelo.</span></label>}
      <label className={labelClass}>Preset<select className={inputClass} value={state.preset} onChange={(event) => state.setPreset(event.target.value)}>
        <option value="">Default del cliente</option><option value={state.jobType === 'product' ? 'generic_product' : 'standard'}>{state.jobType === 'product' ? `Producto genérico · ${PRODUCT_SCENES.length} escenas (4 lifestyle + 2 con personas)` : 'Standard · poses del modelo'}</option>
        {Object.keys(client?.automation?.presets || {}).filter((name) => name !== 'standard' && name !== 'generic_product').map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label className={labelClass}>Modelo de generación<select className={inputClass} value={state.provider} disabled={state.busy} onChange={(event) => state.setProvider(event.target.value as Provider | '')}>
        <option value="">Usar preset del cliente o {PROVIDER_LABELS[DEFAULT_IMAGE_PROVIDER]}</option>
        {PROVIDER_VALUES.map((provider) => <option key={provider} value={provider} disabled={state.disabledProviders.includes(provider)}>{PROVIDER_LABELS[provider]}{state.disabledProviders.includes(provider) ? ' (deshabilitado)' : ''}</option>)}
      </select></label>
      <label className={labelClass}>Origen de fotografías<select className={inputClass} value={state.inputSource} disabled={state.busy} onChange={(e) => state.setInputSource(e.target.value as 'uploads' | 'drive')}><option value="uploads">Subir fotografías</option><option value="drive">Google Drive autorizado</option></select></label>
      {state.inputSource === 'uploads' && <><label className={labelClass}>Imágenes<input className={inputClass} required={!resume} type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={state.busy} onChange={(event) => state.changeFiles(Array.from(event.target.files || []))} /></label>
      <label className="flex gap-2 text-sm text-slate-600"><input type="checkbox" checked={state.sameItem} disabled={state.busy} onChange={(event) => { state.setSameItem(event.target.checked); state.changeFiles(state.files); }} />Todas las fotos muestran el mismo artículo (hasta 4 vistas)</label>
      <p className="text-xs text-slate-500">{state.files.length} fotos. Sin agrupar, cada foto es un artículo independiente.</p>
      </>}
      {state.inputSource === 'drive' && <div className="space-y-3"><p className="text-sm text-slate-600">Asocia cada fotografía a su artículo. Varias filas pueden compartir el mismo artículo.</p>
        {!driveFolderIds.length && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {client ? 'Este cliente aún no tiene carpetas de Google Drive autorizadas.' : 'Selecciona un cliente para ver sus carpetas autorizadas.'}
        </p>}
        {state.driveRows.map((row, index) => <fieldset disabled={state.busy} key={index} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
          <label className={labelClass}>Artículo<input required className={inputClass} value={row.itemId} onChange={(e) => state.setDriveRows(state.driveRows.map((r, i) => i === index ? { ...r, itemId: e.target.value } : r))} /></label>
          <label className={labelClass}>ID del archivo<input required className={inputClass} value={row.fileId} onChange={(e) => state.setDriveRows(state.driveRows.map((r, i) => i === index ? { ...r, fileId: e.target.value } : r))} /></label>
          <label className={labelClass}>Carpeta autorizada<select required className={inputClass} value={driveFolderIds.includes(row.folderId) ? row.folderId : ''} onChange={(e) => state.setDriveRows(state.driveRows.map((r, i) => i === index ? { ...r, folderId: e.target.value } : r))}><option value="">Seleccionar carpeta</option>{driveFolderIds.map((id) => <option key={id}>{id}</option>)}</select></label>
          <label className={labelClass}>Revisión (opcional)<input className={inputClass} value={row.revisionId} onChange={(e) => state.setDriveRows(state.driveRows.map((r, i) => i === index ? { ...r, revisionId: e.target.value } : r))} /></label>
          {state.driveRows.length > 1 && <Button type="button" variant="ghost" onClick={() => state.setDriveRows(state.driveRows.filter((_, i) => i !== index))}>Quitar fotografía del pedido</Button>}
        </fieldset>)}
        <Button type="button" variant="secondary" disabled={state.busy || state.driveRows.length >= 40} onClick={() => state.setDriveRows([...state.driveRows, { itemId: '', fileId: '', folderId: '', revisionId: '' }])}>Añadir fotografía</Button>
      </div>}
      {!resume && <>
        <label className={labelClass}>Presupuesto del pedido (USD)<input type="number" min="0.01" step="0.01" className={inputClass} value={state.budgetUsd} placeholder="Usar presupuesto del cliente / Sistema" onChange={(e) => state.setBudgetUsd(e.target.value)} /></label>
        <label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={state.allowEstimatedCosts} onChange={(e) => state.setAllowEstimatedCosts(e.target.checked)} />Autorizo operaciones con tarifas estimadas. El presupuesto controla reservas; no garantiza un máximo contractual de cobro del proveedor.</label>
        {state.jobType === 'garment' && <label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={state.authorizeClassification} onChange={(e) => state.setAuthorizeClassification(e.target.checked)} />Autorizar la clasificación pagada de referencias al ejecutar.</label>}
      </>}
      <Button type="submit" loading={state.busy} disabled={!resume && state.inputSource === 'uploads' && !state.files.length}>{resume ? 'Reintentar entrada' : 'Preparar plan sin generar'}</Button>
      {state.preparedPlan && <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" aria-label="Plan preparado">
        <h3 className="font-semibold">Plan preparado · {state.preparedPlan.clientName}</h3>
        <p className="text-sm">{state.preparedPlan.items.length} artículos · {state.preparedPlan.modelOptions?.length > 1 ? 'hasta ' : ''}{state.preparedPlan.imageCount} imágenes · escenas independientes · {state.preparedPlan.policy.maxReviewAttempts} intentos por imagen.</p>
        <p className="text-sm">Costo estimado USD {state.preparedPlan.estimatedCostUsd.toFixed(3)} · presupuesto USD {state.preparedPlan.policy.budgetUsd.toFixed(2)}. Las reservas conservadoras pueden detener el trabajo antes de completar todas las escenas.</p>
        {state.preparedPlan.classificationRequired && <p className="text-xs">Gemini analizará el género y las vistas de cada prenda al ejecutar. Se usará el modelo correspondiente y se excluirán las poses incompatibles. La cantidad y el costo estimados contemplan el modelo con más poses.</p>}
        <Button type="button" loading={state.busy} disabled={!state.preparedPlan.policy.allowEstimatedCosts || (state.preparedPlan.classificationRequired && !state.preparedPlan.policy.authorizeClassification)} onClick={() => void state.execute()}>Ejecutar plan</Button>
      </section>}
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
        {(selected.batchIds || (selected.batchId ? [selected.batchId] : [])).map(batchId => <Link key={batchId} className="block text-sm text-indigo-600" to={`/catalogo?clientId=${selected.clientId}&batchId=${batchId}`}>Ver resultados · lote {batchId}</Link>)}
        {(selected.batchIds?.length || selected.batchId) && <MarketplaceExportAction key={selected.id} scope={{ clientId: selected.clientId, batchIds: selected.batchIds?.length ? selected.batchIds : [selected.batchId!] }} />}
        {selected.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{selected.error.code}: {selected.error.message}</p>}
        {!selected.batchId && ['failed', 'needs_attention'].includes(selected.status) && <div className="flex flex-wrap gap-3">
          <Button variant="secondary" loading={state.busy} disabled={selected.retryCount >= 2} onClick={() => void state.retry(selected)}>Reintentar entrada</Button>
          <Link className="px-3 py-2 text-sm text-indigo-600" to={`/automation/intake?resume=${selected.id}`}>Completar modelo / sustituir imágenes</Link>
        </div>}
        <dl className="grid gap-3 text-xs text-slate-600 sm:grid-cols-3">{timestamps(selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 font-medium">{date(value)}</dd></div>)}</dl>
        {state.selectedPlan && <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Plan guardado · {state.selectedPlan.preset}</summary><div className="mt-3 space-y-2 text-sm"><p>Proveedor: {state.selectedPlan.provider} · modelo humano: {state.selectedPlan.modelId || (state.selectedPlan.jobType === 'garment' ? 'Según el género de cada prenda' : 'No aplica')}</p><p>{state.selectedPlan.imageCount} imágenes · costo estimado USD {state.selectedPlan.estimatedCostUsd.toFixed(3)}</p>{state.selectedPlan.items.map((item) => <p key={item.itemId}><strong>{item.itemId}</strong>: {item.sceneIds.join(', ')} · USD {item.estimatedCostUsd.toFixed(3)}</p>)}</div></details>}
        {selected.effectivePolicy && <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
          <p>Escenas independientes</p><p>Calidad: {selected.effectivePolicy.maxReviewAttempts} intentos</p><p>Reintentos operativos: {selected.effectivePolicy.maxOperationalRetries}</p>
          {selected.budget && <><p>Presupuesto USD {selected.budget.limitUsd.toFixed(2)}</p><p>Registrado USD {selected.budget.recordedUsd.toFixed(4)}</p><p>Disponible USD {remainingAutomationBudget(selected.budget).toFixed(4)}</p><p>Comprometido USD {selected.budget.spentUsd.toFixed(4)}</p><p>Reservado USD {selected.budget.reservedUsd.toFixed(4)}</p><p>Tarifas estimadas; cobros del proveedor sin confirmar.</p></>}
          {selected.planId && <p className="break-all text-xs sm:col-span-3">Plan: {selected.planId}</p>}
        </div>}
        {selected.items?.map((item) => <div key={item.itemId} className="overflow-auto rounded-xl border border-slate-200"><div className="flex justify-between bg-slate-50 p-3 text-sm"><strong>{item.itemId}</strong><span>{item.status}</span></div>{(item.garmentGender || item.modelId) && <p className="px-3 py-2 text-xs text-slate-600">{item.garmentGender ? { male: 'Prenda masculina', female: 'Prenda femenina', unisex: 'Prenda unisex' }[item.garmentGender] : 'Género sin determinar'}{item.modelId && ` · Modelo: ${(state.models || []).find(model => model.id === item.modelId)?.name || item.modelId}`}</p>}{item.issue && <p className="bg-amber-50 p-3 text-sm text-amber-900">{item.issue.code}: {item.issue.message}</p>}<table className="w-full text-left text-xs"><thead><tr>{['Escena', 'Estado', 'Intentos', 'Gemini / incidencia'].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{item.scenes.map((scene) => <tr key={scene.jobId} className="border-t"><td className="p-3">{scene.scene}</td><td className="p-3">{scene.status}</td><td className="p-3">{scene.attempts}</td><td className="p-3">{scene.verdict || '—'}<p>{scene.reason}</p></td></tr>)}</tbody></table></div>)}
        {state.canCreate && (selected.spendingPaused || selected.items?.some((item) => item.scenes.some((scene) => scene.status === 'budget'))) && <div className="flex flex-wrap items-center gap-3"><label className={labelClass}>Presupuesto autorizado (USD)<input className={inputClass} type="number" min="0.01" step="0.01" placeholder={String(selected.budget?.limitUsd || '')} value={state.resumeBudgetUsd} onChange={(e) => state.setResumeBudgetUsd(e.target.value)} /></label><Button loading={state.busy} variant="secondary" onClick={() => void state.resume(selected)}>Reanudar con límites vigentes</Button></div>}
        {selected.outputImages.length > 0 && <Button loading={state.busy} variant="secondary" onClick={() => void state.download(selected)}>Descargar aprobadas + manifiesto ZIP</Button>}
        <h3 className="font-medium">Entradas</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-6">{selected.inputImages.map((image, index) => <figure key={index}><div className="aspect-square"><ImageThumb storagePath={image.storagePath} alt={image.fileName} fit="contain" /></div><figcaption className="mt-1 truncate text-xs">{image.fileName}</figcaption></figure>)}</div>
        <h3 className="font-medium">Resultados aprobados</h3><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{selected.outputImages.map((image) => <figure key={image.jobId}><div className="aspect-square"><ImageThumb storagePath={image.storagePath} alt={image.type} fit="contain" /></div><figcaption className="mt-1 text-xs">{image.type}</figcaption></figure>)}</div>
        {selected.batchId && <p className="text-xs text-slate-500">Abre el batch para revisar intentos, costos y reintentar jobs de generación.</p>}
      </section>}
    </>}
  </div>;
};
