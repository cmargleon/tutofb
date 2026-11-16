import { useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { OrganizerClient, OrganizerConfig, OrganizerInterpretation, OrganizerMode, OrganizerPage, OrganizerPhoto, OrganizerPlanItem, OrganizerRequest, OrganizerResponse, OrganizerRun, OrganizerSettings, OrganizerTab, OrganizerVariant } from '../../../shared/src/types';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { organizer } from './firebase';

export type CatalogView = 'products' | 'photos' | 'conflicts' | 'tabs' | 'runs' | 'plan' | 'interpretations';
export type CatalogItem = OrganizerVariant | OrganizerPhoto | OrganizerRun | OrganizerTab | OrganizerPlanItem | OrganizerInterpretation;

export function useOrganizer() {
  const [clients, setClients] = useState<OrganizerPage<OrganizerClient>>({ items: [], next: null });
  const [params, setParams] = useSearchParams();
  const [defaultClientId, setDefaultClientId] = useState('');
  const clientId = params.get('clientId') ?? defaultClientId;
  const variantId = params.get('variantId') || '';
  const baseProductId = params.get('baseProductId') || '';
  const batchId = params.get('batchId') || '';
  const [loadedConfig, setConfig] = useState<OrganizerConfig | null>(null);
  const [loadedRun, setRun] = useState<OrganizerRun | null>(null);
  const config = loadedConfig?.clientId === clientId ? loadedConfig : null;
  const run = loadedRun?.clientId === clientId ? loadedRun : null;
  const activeRunRef = useRef<{ clientId: string; id: string } | null>(null);
  const requestedView = params.get('view');
  const view: CatalogView = requestedView === 'photos' || (!variantId &&
    (requestedView === 'conflicts' || requestedView === 'tabs' || requestedView === 'runs' || requestedView === 'plan' || requestedView === 'interpretations'))
    ? requestedView : 'products';
  const [page, setPage] = useState<OrganizerPage<CatalogItem>>({ items: [], next: null });
  const filterVariant = view === 'photos' ? variantId || params.get('photoVariantId') || '' : '';
  const [filterStatus, setFilterStatus] = useState<OrganizerVariant['status'] | ''>('');
  const [products, setProducts] = useState<OrganizerVariant[]>([]);
  const [planRunId, setPlanRunId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();
  const refresh = () => setRevision(value => value + 1);

  useEffect(() => {
    let current = true;
    void organizer<OrganizerPage<OrganizerClient>>({ action: 'clients' }).then(result => {
      if (current) { setClients(result); setDefaultClientId(result.items[0]?.id || ''); }
    }).catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let current = true;
    const read = async () => {
      try {
        const result = await organizer<OrganizerConfig | null>({ action: 'config', clientId });
        if (!current) return;
        setConfig(result);
        const activeId = result?.activeRunId || (activeRunRef.current?.clientId === clientId ? activeRunRef.current.id : null);
        activeRunRef.current = result?.activeRunId ? { clientId, id: result.activeRunId } : null;
        if (!activeId) return;
        const active = await organizer<OrganizerRun>({ action: 'run', clientId, runId: activeId });
        if (current) {
          setRun(active);
          if (!result?.activeRunId) setRevision(value => value + 1);
        }
      } catch (error) { if (current) setLoadError((error as Error).message); }
    };
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 12_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [clientId, revision]);

  const configured = config?.clientId === clientId;
  const simulation = !variantId && run?.status === 'completed' && ['dry_run', 'inventory'].includes(run.mode) ? run.id : undefined;
  useEffect(() => {
    if (run?.status === 'completed' && run.mode === 'dry_run') setPlanRunId(run.id);
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (!configured) return;
    let current = true;
    void (async () => {
      const all: OrganizerVariant[] = []; let cursor: string | undefined;
      do {
        const result = await organizer<OrganizerPage<OrganizerVariant>>({ action: 'products', clientId, cursor, runId: simulation });
        if (!current) return;
        all.push(...result.items); cursor = result.next || undefined;
      } while (cursor);
      setProducts(all);
    })().catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [clientId, configured, revision, simulation]);
  useEffect(() => {
    setPage({ items: [], next: null });
    if (!configured || (variantId && view === 'products')) return;
    let current = true;
    if (view === 'plan' && !run?.id) return;
    const request: OrganizerRequest = view === 'plan' ? { action: 'plan', clientId, runId: run!.id } : view === 'interpretations' ? { action: view, clientId } :
      { action: view, clientId, variantId: filterVariant || undefined, runId: simulation, status: filterStatus || undefined };
    void organizer<OrganizerPage<CatalogItem>>(request).then(result => {
      if (current) setPage(result);
    }).catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [clientId, configured, revision, view, filterVariant, variantId, simulation, filterStatus, run?.id]);

  const perform = async <Result extends OrganizerResponse>(input: OrganizerRequest, success?: string) => {
    setBusy(true);
    try {
      const result = await organizer<Result>(input);
      if (success) toast({ tone: 'success', title: success });
      return result;
    } catch (error) {
      toast({ tone: 'error', title: 'Organizador inteligente', description: (error as Error).message });
      return undefined;
    } finally { setBusy(false); }
  };
  const selectClient = (id: string) => {
    setParams(new URLSearchParams({ clientId: id }));
  };
  useEffect(() => {
    setProducts([]); setPlanRunId(undefined); setFilterStatus(''); setLoadError('');
  }, [clientId]);
  const selectView = (value: CatalogView, targetVariantId = '') => {
    if (value !== view || targetVariantId !== filterVariant) setPage({ items: [], next: null });
    const next = new URLSearchParams(params);
    if (clientId) next.set('clientId', clientId);
    if (value === 'products') next.delete('view'); else next.set('view', value);
    next.delete('photoVariantId');
    if (!variantId && targetVariantId) next.set('photoVariantId', targetVariantId);
    setParams(next);
  };
  const loadClients = async () => {
    if (!clients.next) return;
    const next = await perform<OrganizerPage<OrganizerClient>>({ action: 'clients', cursor: clients.next });
    if (next) setClients(old => ({ next: next.next, items: [...old.items, ...next.items] }));
  };
  const loadMore = async () => {
    if (!page.next) return;
    const request: OrganizerRequest = view === 'plan' ? { action: 'plan', clientId, runId: run!.id, cursor: page.next } : view === 'interpretations' ? { action: view, clientId, cursor: page.next } :
      { action: view, clientId, cursor: page.next, variantId: filterVariant || undefined, runId: simulation, status: filterStatus || undefined };
    const result = await perform<OrganizerPage<CatalogItem>>(request);
    if (result) setPage(old => ({ items: [...old.items, ...result.items], next: result.next }));
  };
  const save = async (settings: OrganizerSettings) => {
    if (settings.enabled && !config?.enabled && !await confirm({ title: 'Activar vigilancia automática',
      description: `Tuto podrá copiar y clasificar los cambios de este cliente con un presupuesto de hasta USD ${settings.budgetUsd} por lote. Si está activada la generación después de organizar en Sistema → Configuración, enviará las fotos nuevas a generar con el presupuesto de automatización del cliente.`,
      confirmLabel: 'Activar vigilancia' })) return;
    const result = await perform<OrganizerConfig>({ action: 'configure', clientId, settings }, 'Configuración guardada');
    if (result) { setConfig(result); refresh(); }
  };
  const start = async (mode: OrganizerMode, selection?: { variantId?: string; photoIds?: string[] }) => {
    const paid = mode === 'classify' || mode === 'sync';
    if (paid && !selection && !planRunId) { toast({ tone: 'warning', title: 'Simula y revisa el plan antes de aplicar.' }); return; }
    if (paid && !selection && view !== 'plan') { selectView('plan'); toast({ tone: 'info', title: 'Revisa el plan y vuelve a pulsar Clasificar para aplicarlo.' }); return; }
    if (paid && (!config || !await confirm({ title: 'Iniciar clasificación',
      description: `Se aplicará ${selection ? 'el reanálisis seleccionado' : 'el plan de la simulación revisada'} conservando los originales. Puede usar hasta USD ${config.budgetUsd} de Gemini y crear copias verificadas en Drive. Si la generación después de organizar está activada, las fotos nuevas pasarán a automatización con el presupuesto del cliente.`,
      confirmLabel: 'Iniciar ejecución' }))) return;
    if (mode === 'generate' && (!config || !await confirm({ title: 'Generar desde las fotos originales',
      description: `Se leerá Drive y las referencias se guardarán en Tuto. Gemini puede usar hasta USD ${config.budgetUsd}. Las fotos se generarán con el presupuesto de automatización del cliente.`,
      confirmLabel: 'Generar fotos' }))) return;
    const result = await perform<OrganizerRun>({ action: 'start', mode, clientId, requestId: crypto.randomUUID(),
      confirmedBudgetUsd: paid || mode === 'generate' ? config?.budgetUsd : undefined, planRunId: paid && !selection ? planRunId : undefined, ...selection }, 'Ejecución en cola');
    if (result) { setRun(result); refresh(); }
  };
  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!run) return;
    if (action === 'cancel' && !await confirm({ title: 'Cancelar ejecución', description: 'Se detendrá el trabajo pendiente. Las copias y resultados guardados se conservan.',
      confirmLabel: 'Cancelar ejecución', tone: 'warning' })) return;
    const result = await perform<OrganizerRun>({ action, clientId, runId: run.id });
    if (result) { setRun(result); refresh(); }
  };
  return { clients, clientId, baseProductId, variantId, batchId, revision, config, run, view, page, busy, loadError, products, simulation, filterStatus, setFilterStatus, selectClient, selectView, loadClients, loadMore, save, start, control, perform, refresh, setRun };
}
