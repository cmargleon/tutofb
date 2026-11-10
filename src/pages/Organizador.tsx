import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban, ChevronRight, CircleAlert, FolderOpen, Images, Play } from 'lucide-react';
import { ORGANIZER_DEFAULT_BUDGET_USD, ORGANIZER_DEFAULT_MODEL, ORGANIZER_DIRECTORIES,
  type OrganizerConfig, type OrganizerInterpretation, type OrganizerPlanItem, type OrganizerPhoto, type OrganizerProductRow, type OrganizerPage,
  type OrganizerRun, type OrganizerSettings, type OrganizerTab, type OrganizerVariant } from '../../shared/src/types';
import { Button, PageHeader } from '../components/ui';
import { useRole } from '../features/auth/AuthProvider';
import { useOrganizer, type CatalogView } from '../features/organizer/useOrganizer';
import { PhotoReview } from '../features/organizer/PhotoReview';

const pane = 'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6';
const input = 'tuto-field';
const link = 'text-sm font-medium text-indigo-700 underline underline-offset-4';
const date = (value: number | null) => value ? new Date(value).toLocaleString('es') : '—';
const money = (value: number) => value.toLocaleString('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const statuses: Record<string, string> = {
  queued: 'En cola', running: 'En ejecución', paused: 'En pausa', cancelled: 'Cancelada', budget_exhausted: 'Presupuesto agotado',
  failed: 'Interrumpida', completed: 'Completada', idle: 'En espera', disabled: 'Desactivada', collecting: 'Agrupando cambios', error: 'Requiere atención',
  pending: 'Pendiente', review: 'En revisión', uploaded: 'Subido según hoja', suggested: 'Sugeridas', approved: 'Aprobadas', rejected: 'Rechazadas',
};
const documentState = { ok: 'OK', pending: 'Pendiente', review: 'En revisión', unrecorded: 'Sin registro' };
const phases: Record<OrganizerRun['phase'], string> = {
  inventory: 'Inventario', catalog: 'Asociación', copy: 'Copias', vision: 'Análisis visual', organize: 'Organización', automation: 'Envío a automatización', report: 'Reporte',
};
const metrics: Record<string, string> = {
  files: 'Archivos', folders: 'Carpetas', new: 'Nuevos', modified: 'Modificados', photos: 'Fotos', workbooks: 'Libros',
  copied: 'Copias', verified: 'Verificadas', products: 'Productos', variants: 'Variantes', skcs: 'SKC', skus: 'SKU',
  associated: 'Asociadas', unassigned: 'Sin asignar', conflicts: 'Incidencias', errors: 'Errores',
  automationJobs: 'Artículos enviados a automatización', automationPhotos: 'Fotos nuevas procesadas', automationNeedsReview: 'Fotos pendientes de revisión para generar',
  automationSkippedPhotos: 'Fotos organizadas sin generación automática',
  selectedReferences: 'Referencias seleccionadas', missingReferences: 'Referencias pendientes', productsWithoutPhotos: 'Productos sin fotos', sharedPhotos: 'Fotos compartidas', humanReviewed: 'Revisión humana', identityNeedsReview: 'Decisiones por revalidar', inaccessibleSources: 'Fuentes inaccesibles',
};
const views: { id: CatalogView; label: string }[] = [
  { id: 'products', label: 'Productos' }, { id: 'photos', label: 'Fotografías' }, { id: 'conflicts', label: 'Conflictos' },
  { id: 'tabs', label: 'Pestañas de origen' }, { id: 'plan', label: 'Plan de cambios' }, { id: 'interpretations', label: 'Interpretación de estructura' }, { id: 'runs', label: 'Historial' },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-slate-700">{label}{children}</label>;
}
function Setup({ config, clientName, driveFolderIds, busy, save }: {
  config: OrganizerConfig | null; clientName: string; driveFolderIds: string[]; busy: boolean; save: (settings: OrganizerSettings) => void;
}) {
  const sourceOptions = [...new Set([...driveFolderIds, ...(config?.sourceIds ?? [])])];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (name: string) => String(data.get(name) || '').trim();
    const values = (name: string) => get(name).split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    save({ sourceIds: data.getAll('sourceIds').map(String), parentId: get('parent') || config?.parentId || '', folderName: get('name') || config?.folderName || '',
      debounceMinutes: Number(get('debounce')), budgetUsd: Number(get('budget')), model: get('model'), escalationModel: get('escalation') || null,
      enabled: data.has('enabled'), controlSheet: data.has('control'), allowInheritedAccess: data.has('inherit'),
      minimumConfidence: Number(get('confidence')), maxCalls: Number(get('maxCalls')), operatorUids: values('operators'),
      directories: Object.fromEntries(Object.keys(ORGANIZER_DIRECTORIES).map(key => [key, get(key)])) as typeof ORGANIZER_DIRECTORIES });
  };
  return <details className={pane} open={!config || undefined}>
    <summary className="cursor-pointer font-semibold text-slate-900">Configuración de Drive y vigilancia</summary>
    <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-semibold text-slate-900">Carpetas de origen</legend>
        <p className="text-sm text-slate-600">
          {sourceOptions.length ? 'Selecciona qué carpetas puede leer el Organizador.' : 'Este cliente aún no tiene carpetas autorizadas.'}{' '}
          <Link className={link} to="/clients/lista">Administrar carpetas en Clientes</Link>
        </p>
        {sourceOptions.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{sourceOptions.map(id =>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" key={id}>
            <input className="mt-1 accent-teal-700" type="checkbox" name="sourceIds" value={id} defaultChecked={config?.sourceIds.includes(id)} />
            <span className="min-w-0"><span className="break-all font-mono">{id}</span>
              {!driveFolderIds.includes(id) && <span className="block text-xs text-slate-500">Origen configurado previamente</span>}
            </span>
          </label>)}</div>}
      </fieldset>
      <Field label="Carpeta contenedora del destino"><input className={input} name="parent" required disabled={Boolean(config?.destinationId)} defaultValue={config?.parentId} placeholder="Enlace o ID de Drive" /></Field>
      <Field label="Nombre de la carpeta organizada"><input className={input} name="name" required disabled={Boolean(config?.destinationId)} defaultValue={config?.folderName || `${clientName} - ORGANIZADO POR MANGLAR`} /></Field>
      <Field label="Ventana de agrupación en minutos"><input className={input} name="debounce" type="number" min="2" max="1440" required defaultValue={config?.debounceMinutes ?? 10} /></Field>
      <Field label="Presupuesto estimado por ejecución en USD"><input className={input} name="budget" type="number" min=".11" max="40" step=".01" required defaultValue={config?.budgetUsd ?? ORGANIZER_DEFAULT_BUDGET_USD} /></Field>
      <Field label="Límite de llamadas por ejecución"><input className={input} name="maxCalls" type="number" min="1" max="1000" required defaultValue={config?.maxCalls ?? 300} /></Field>
      <Field label="Confianza mínima"><input className={input} name="confidence" type="number" min=".55" max=".99" step=".01" required defaultValue={config?.minimumConfidence ?? .75} /></Field>
      <Field label="Modelo Gemini principal"><select className={input} name="model" defaultValue={config?.model || ORGANIZER_DEFAULT_MODEL}>
        {[ORGANIZER_DEFAULT_MODEL, 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'].map(model => <option key={model}>{model}</option>)}
      </select></Field>
      <Field label="Modelo Gemini de escalamiento"><select className={input} name="escalation" defaultValue={config?.escalationModel || ''}>
        <option value="">Sin escalamiento</option>{[ORGANIZER_DEFAULT_MODEL, 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'].map(model => <option key={model}>{model}</option>)}
      </select></Field>
      <Field label="UID de operadores o revisores · uno por línea"><textarea className={input} name="operators" rows={2} defaultValue={config?.operatorUids.join('\n')} /></Field>
      <div className="grid content-start gap-2 text-sm text-slate-700">
        <label><input name="enabled" type="checkbox" defaultChecked={config?.enabled} /> Activar vigilancia automática</label>
        <p className="text-xs text-slate-600">Si está activado en Sistema y en la ficha del cliente, las fotos nuevas pasan a generación después de organizarse, aunque no coincidan con el Excel. Se usan el modelo, preset y presupuesto de automatización del cliente.</p>
        <label><input name="control" type="checkbox" defaultChecked={config?.controlSheet} /> Crear Google Sheet de control</label>
        <label><input name="inherit" type="checkbox" defaultChecked={config?.allowInheritedAccess} /> Autorizar el acceso heredado de la carpeta o unidad compartida</label>
      </div>
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-sm font-medium">Nombres de las carpetas de salida</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(ORGANIZER_DIRECTORIES).map(([key, name]) =>
          <div key={key}><Field label={name}><input className={input} name={key} required defaultValue={config?.directories[key as keyof typeof ORGANIZER_DIRECTORIES] || name} /></Field></div>)}</div>
      </details>
      <div><Button type="submit" loading={busy}>Guardar configuración</Button></div>
    </form>
  </details>;
}

function RunCard({ run, controller, busy, canRun, active }: { run: OrganizerRun; controller: (action: 'pause' | 'resume' | 'cancel') => void; busy: boolean; canRun: boolean; active: boolean }) {
  return <section className={pane} aria-label="Estado de ejecución">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{phases[run.phase]}</p>
        <h2 className="mt-1 text-lg font-semibold">{statuses[run.status]}</h2><p className="text-xs text-slate-500">{date(run.createdAt)} · {run.id.slice(0, 8)}</p></div>
      {canRun && active && <div className="flex flex-wrap gap-2">
        {['queued', 'running'].includes(run.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => controller('pause')}>Pausar</Button>}
        {['paused', 'failed'].includes(run.status) && <Button size="sm" disabled={busy} onClick={() => controller('resume')}>Reanudar</Button>}
        {['queued', 'paused', 'failed', 'budget_exhausted'].includes(run.status) && <Button size="sm" variant="warning" disabled={busy} onClick={() => controller('cancel')}>Cancelar</Button>}
      </div>}
    </div>
    {run.error && <p role="status" className="mt-3 text-sm text-amber-800">{run.error}</p>}
    {run.budgetUsd > 0 && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
      <div className="flex justify-between gap-3"><span>Consumo confirmado {money(run.estimatedUsd)} · reservado {money(run.reservedUsd)} · incierto {money(run.uncertainUsd)}</span>
        <strong>{money(run.budgetUsd)}</strong></div>
      <progress aria-label="Presupuesto estimado de Gemini" className="mt-2 h-2 w-full accent-indigo-600" max={run.budgetUsd} value={run.estimatedUsd + run.uncertainUsd + run.reservedUsd} />
      <p className="mt-1 text-xs text-slate-500">{run.calls} llamadas{run.alerts.length ? ` · Umbrales alcanzados: ${run.alerts.join(' %, ')} %` : ''}</p>
    </div>}
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{Object.entries(run.counts).map(([key, value]) =>
      <div className="rounded-lg border border-slate-100 p-2.5" key={key}><dt className="text-xs text-slate-500">{metrics[key] || key}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
    <div className="mt-3 flex flex-wrap gap-4">
      {run.counts.automationJobs > 0 && <Link className={link} to="/automation">Ver automatización</Link>}
      {run.reportUrl && <a className={link} href={run.reportUrl} target="_blank" rel="noreferrer">Abrir reporte JSON</a>}
      {run.controlSheetUrl && <a className={link} href={run.controlSheetUrl} target="_blank" rel="noreferrer">Abrir hoja de control</a>}
      <Button variant="ghost" size="sm" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `organizador-${run.id.slice(0, 8)}.json`; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Descargar resumen</Button>
    </div>
  </section>;
}

export function Organizador() {
  const access = useRole();
  const state = useOrganizer();
  const { config, run, clientId, busy } = state;
  const [provenance, setProvenance] = useState<{ id: string; page: OrganizerPage<OrganizerProductRow> } | null>(null);
  const client = state.clients.items.find(item => item.id === clientId);
  const locked = Boolean(config?.activeRunId);
  const hasSources = Boolean(config?.sourceIds.length);
  const canReplace = run?.status === 'budget_exhausted' && run.id === config?.activeRunId;
  const showProvenance = async (variantId: string, cursor?: string) => {
    const page = await state.perform<OrganizerPage<OrganizerProductRow>>({ action: 'provenance', clientId, variantId, cursor });
    if (page) setProvenance(old => ({ id: variantId, page: { ...page, items: cursor && old?.id === variantId ? [...old.page.items, ...page.items] : page.items } }));
  };
  return <div className="tuto-page">
    <PageHeader icon={FolderKanban} title="Organizador inteligente" description="Inventario, catálogo y referencias de Google Drive por cliente." />
    <section className="tuto-surface grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
      <div><p className="tuto-overline">Catálogo de origen</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select aria-label="Cliente" className={`${input} max-w-xs`} value={clientId} onChange={event => {
            setProvenance(null); state.selectClient(event.target.value);
          }}><option value="">Selecciona un cliente</option>{state.clients.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {state.clients.next && <Button size="sm" variant="secondary" onClick={state.loadClients}>Más clientes</Button>}
        </div>
      </div>
      {config && <div className="text-sm sm:text-right"><p className="font-semibold text-[var(--color-accent-light)]">{statuses[config.watcher]}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">Última comprobación · {date(config.lastPollAt)}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">Última sincronización · {date(config.lastSyncAt)}</p>
        <p className="mt-1 text-[var(--color-text-muted)]">Última clasificación · {date(config.lastClassifiedAt)}</p>
        {config.destinationId && <a className="tuto-link mt-2 inline-flex items-center gap-1" href={`https://drive.google.com/drive/folders/${config.destinationId}`} target="_blank" rel="noreferrer"><FolderOpen size={16} /> Carpeta organizada</a>}
      </div>}
    </section>
    {(state.loadError || config?.watcherError) && <p role="alert" className="tuto-alert tuto-alert--warning"><CircleAlert size={18} /> {state.loadError || config?.watcherError}</p>}
    {access.isAdmin && client && <p className="text-sm text-slate-600">La generación posterior se configura en <Link className={link} to={`/clients/${encodeURIComponent(clientId)}?tab=automatizaciones`}>Cliente → Automatizaciones</Link>.</p>}
    {access.isAdmin && client && !locked && <div key={`${clientId}-${config?.destinationId || 'setup'}-${config ? 'saved' : 'new'}`}><Setup config={config} clientName={client.name} driveFolderIds={client.driveFolderIds ?? []} busy={busy} save={state.save} /></div>}
    {config && <>
      {access.canCreateBatches && <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || locked || !hasSources} onClick={() => state.start('inventory')}>Inventario</Button>
        <Button variant="secondary" disabled={busy || locked || !hasSources} onClick={() => state.start('dry_run')}>Simular</Button>
        <Button icon={Play} disabled={busy || !hasSources || locked && !canReplace} onClick={() => state.start('classify')}>{canReplace ? 'Autorizar presupuesto nuevo' : 'Clasificar'}</Button>
        <Button variant="secondary" disabled={busy || locked || !hasSources} onClick={() => state.start('sync')}>Sincronizar cambios</Button>
      </div>}
      {run && <RunCard run={run} controller={state.control} busy={busy} canRun={access.canCreateBatches} active={run.id === config.activeRunId} />}
      <section className={pane} aria-label="Catálogo organizado">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">{views.map(view =>
          <Button key={view.id} variant={state.view === view.id ? 'primary' : 'ghost'} size="sm" onClick={() => { setProvenance(null); state.selectView(view.id); }}>{view.label}</Button>)}</div>
        {state.page.items.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Aún no hay registros en esta vista.</p>}
        {state.view === 'products' && <label className="mb-3 block text-sm">Estado del catálogo <select className={`${input} mt-1 max-w-xs`} value={state.filterStatus} onChange={event => state.setFilterStatus(event.target.value as OrganizerVariant['status'] | '')}>
          <option value="">Todos</option><option value="pending">Pendientes</option><option value="review">Revisar</option><option value="uploaded">Subidos según Excel</option>
        </select></label>}
        {state.simulation && <p className="mb-3 text-sm text-amber-800">Vista de simulación. Revisa el plan antes de clasificar; las correcciones estarán disponibles al terminar la ejecución aplicada.</p>}
        <ul className="divide-y divide-slate-100">
          {state.view === 'products' && (state.page.items as OrganizerVariant[]).map(item => <li key={item.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto]">
            <div><h3 className="font-semibold">{item.name} <span className="ml-1 text-sm font-normal text-slate-500">{item.visual}</span></h3>
              <p className="text-sm text-slate-600">{[item.color, item.pack, item.category, statuses[item.status], `Referencias ${statuses[item.referenceState].toLowerCase()}`].filter(Boolean).join(' · ')}</p>
              <p className="mt-1 text-xs text-slate-500">{[item.skcs.length && `SKC ${item.skcs.join(', ')}`, item.skus.length && `SKU ${item.skus.join(', ')}`, item.sizes.join(', ')].filter(Boolean).join(' · ')}</p>
              {item.documented && <p className="mt-1 text-xs text-slate-500">FOTO IA {documentState[item.documented.photo]} · UPLOAD {documentState[item.documented.upload]} · PUBLICAR {documentState[item.documented.publish]}</p>}
              {item.issues.map(issue => <p key={issue} className="mt-1 text-xs text-amber-800">{issue}</p>)}
              <p className="mt-1 text-xs text-slate-500">Referencias · {item.references.front.length} frontales · {item.references.back.length} traseras · {item.references.main.length} principales · {item.references.complementary?.length || 0} complementarias</p>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Button size="sm" variant="secondary" icon={Images} onClick={() => state.selectView('photos', item.id)}>Ver fotos</Button>
              <Button size="sm" variant="ghost" onClick={() => showProvenance(item.id)}>Ver celdas</Button>
              
              {access.canCreateBatches && <Button size="sm" variant="ghost" disabled={busy || locked || Boolean(state.simulation)} onClick={() => state.start('classify', { variantId: item.id })}>Reanalizar</Button>}
              {(['suggested', 'approved'] as string[]).includes(item.referenceState) && <div className="flex gap-1">
                {item.referenceState === 'suggested' && <Button size="sm" variant="secondary" disabled={busy || locked || Boolean(state.simulation)} onClick={async () => {
                  if (await state.perform({ action: 'references', clientId, variantId: item.id, decision: 'approve' }, 'Referencias aprobadas')) state.refresh();
                }}>Aprobar</Button>}
                <Button size="sm" variant="ghost" disabled={busy || locked || Boolean(state.simulation)} onClick={async () => {
                  if (await state.perform({ action: 'references', clientId, variantId: item.id, decision: 'reject' }, 'Referencias rechazadas')) state.refresh();
                }}>Rechazar</Button>
              </div>}
              {item.referenceState === 'rejected' && <Button size="sm" variant="ghost" disabled={busy || locked || Boolean(state.simulation)} onClick={async () => {
                if (await state.perform({ action: 'references', clientId, variantId: item.id, decision: 'reset' }, 'Revisión reabierta')) state.refresh();
              }}>Reabrir revisión</Button>}
              {access.canCreateBatches && item.referenceState === 'approved' && <Link className={link} to={`/generate?organizerClient=${clientId}&organizerVariant=${item.id}`}>Usar en el wizard</Link>}
            </div>
            {provenance?.id === item.id && <div className="space-y-2 rounded-xl bg-slate-50 p-4 lg:col-span-2">
              {provenance.page.items.map(row => <div key={`${row.fileId}-${row.tab}-${row.line}`}>
                <p className="text-sm font-medium">{row.fileName} · {row.tab} · fila {row.line}</p>
                <p className="break-words text-xs text-slate-600">{row.cells.map(cell => `${cell.column}=${cell.value}${String(cell.originalValue) !== cell.value ? ` [${cell.originalValue}]` : ''}`).join(' · ')}</p>
              </div>)}
              {provenance.page.next && <Button size="sm" variant="secondary" onClick={() => showProvenance(item.id, provenance.page.next!)}>Más filas</Button>}
            </div>}
          </li>)}
          {(state.view === 'photos' || state.view === 'conflicts') && (state.page.items as OrganizerPhoto[]).map(item => <li key={item.id} className="space-y-2 py-4">
            <h3 className="font-semibold">{item.name}</h3>
            <p className="break-words text-xs text-slate-500">{item.path.join(' / ')} · {item.method} · {Math.round(item.confidence * 100)} %</p>
            {item.issue && <p className="text-sm text-amber-800">{item.issue}</p>}
            {item.visualHint && <p className="text-xs text-slate-600">Grupo visual sugerido · {[item.visualHint.label, item.visualHint.color, item.visualHint.pack, item.visualHint.groupId.slice(0, 8)].filter(Boolean).join(' · ')}</p>}
            {item.evidence.length > 0 && <p className="text-xs text-slate-600">{item.evidence.join(' · ')}</p>}
            
            <div className="flex flex-wrap items-center gap-3">
              <a className={link} href={item.sourceUrl} target="_blank" rel="noreferrer">Origen</a>
              {item.copyUrl && <a className={link} href={item.copyUrl} target="_blank" rel="noreferrer">Copia</a>}
              {access.canCreateBatches && !state.simulation && <Button size="sm" variant="ghost" disabled={busy || locked || Boolean(state.simulation)} onClick={() => state.start('classify', { photoIds: [item.id] })}>Reanalizar</Button>}
            </div>
            <PhotoReview clientId={clientId} photo={item} products={state.products} disabled={locked || busy || Boolean(state.simulation)}
              group={(state.page.items as OrganizerPhoto[]).filter(other => other.path.slice(0, -1).join('/') === item.path.slice(0, -1).join('/') &&
                [...other.candidates].sort().join() === [...item.candidates].sort().join()).map(other => other.id).slice(0, 25)}
              correct={async (variantIds, photoIds, referenceVariantIds) => {
                if (await state.perform({ action: 'correct', clientId, photoId: item.id, variantId: variantIds.length === 1 ? variantIds[0] : null, variantIds, photoIds, referenceVariantIds }, 'Asociación guardada; se conservaron las excepciones humanas')) state.refresh();
              }} />
          </li>)}
          {state.view === 'tabs' && (state.page.items as OrganizerTab[]).map(item => <li key={item.id} className="py-4">
            <h3 className="font-semibold">{item.name}</h3><p className="text-sm text-slate-600">{item.fileName} · {item.imported} filas importadas · {item.skipped} omitidas</p>
            {item.issue && <p className="text-sm text-amber-800">{item.issue}</p>}
            {item.samples && item.samples.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm text-indigo-700">Muestra original y columnas</summary>
              <div className="mt-2 overflow-x-auto"><table className="text-xs"><tbody>{item.samples.map((row, index) => <tr key={index}>
                <th className="border p-2">{(item.sampleStartRow || 1) + index}</th>{row.values.map((value, column) => <td className="max-w-xs border p-2" key={column} title={String(row.originalValues?.[column] ?? value)}>{value}</td>)}
              </tr>)}</tbody></table></div>
            </details>}
            {item.links?.map((source, index) => <p key={index} className="text-xs"><a className={link} href={source.url} target="_blank" rel="noreferrer">Fuente adicional · {source.cell}</a> · {source.sourceId && config.sourceIds.includes(source.sourceId) ? 'Origen seleccionado' : 'Requiere autorización y selección en Clientes; no se importa automáticamente'}</p>)}
          </li>)}
          {state.view === 'plan' && (state.page.items as OrganizerPlanItem[]).map(item => <li key={item.id} className="space-y-1 py-3">
            <h3 className="font-semibold">{item.name} · {{ copy: 'Copiar', place: 'Organizar', reuse: 'Reutilizar', retain_legacy: 'Conservar destino existente' }[item.action]}</h3>
            <p className="text-xs text-slate-600">{item.sourcePath.join(' / ')} → {item.destination.join(' / ')}</p><p className="text-sm">{item.reason}</p>
            {item.currentFolderUrl && <a className={link} href={item.currentFolderUrl} target="_blank" rel="noreferrer">Ubicación actual de la copia</a>}
          </li>)}
          {state.view === 'interpretations' && (state.page.items as OrganizerInterpretation[]).map((item, index) => <li key={index} className="space-y-1 py-3">
            <h3 className="font-semibold">{item.resolved ? 'Interpretación con evidencia' : 'Estructura por resolver'}</h3>
            {item.conventions.map((value, i) => <p key={i} className="text-sm">{value.description}</p>)}
            {item.unresolved.map((value, i) => <p key={i} className="text-sm text-amber-800">{value}</p>)}
            <p className="text-xs text-slate-500">{item.folders.length} roles de carpetas · {item.columns.length} mapeos · {item.relationships.length} relaciones propuestas. Las propuestas no confirman identidades por sí solas.</p>
          </li>)}
          {state.view === 'runs' && (state.page.items as OrganizerRun[]).map(item => <li key={item.id} className="flex items-center justify-between gap-2 py-3">
            <span className="text-sm">{date(item.createdAt)} · {statuses[item.status]} · {item.id.slice(0, 8)}</span>
            <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => state.setRun(item)}>Detalles</Button>
          </li>)}
        </ul>
        {state.page.next && <Button className="mt-4" variant="secondary" disabled={busy} onClick={state.loadMore}>Cargar más</Button>}
      </section>
    </>}
  </div>;
}
