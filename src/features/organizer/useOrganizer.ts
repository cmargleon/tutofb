import { useEffect, useRef, useState } from 'react';
import type { OrganizerClient, OrganizerConfig, OrganizerInterpretation, OrganizerMode, OrganizerPage, OrganizerPhoto, OrganizerPlanItem, OrganizerRequest, OrganizerResponse, OrganizerRun, OrganizerSettings, OrganizerTab, OrganizerVariant } from '../../../shared/src/types';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { organizer } from './firebase';

export type CatalogView = 'products' | 'photos' | 'conflicts' | 'tabs' | 'runs' | 'plan' | 'interpretations';
export type CatalogItem = OrganizerVariant | OrganizerPhoto | OrganizerRun | OrganizerTab | OrganizerPlanItem | OrganizerInterpretation;

export function useOrganizer() {
  const [clients, setClients] = useState<OrganizerPage<OrganizerClient>>({ items: [], next: null });
  const [clientId, setClientId] = useState('');
  const [config, setConfig] = useState<OrganizerConfig | null>(null);
  const [run, setRun] = useState<OrganizerRun | null>(null);
  const activeRunRef = useRef<string | null>(null);
  const [view, setView] = useState<CatalogView>('products');
  const [page, setPage] = useState<OrganizerPage<CatalogItem>>({ items: [], next: null });
  const [filterVariant, setFilterVariant] = useState('');
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
      if (current) { setClients(result); setClientId(old => old || result.items[0]?.id || ''); }
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
        const activeId = result?.activeRunId || activeRunRef.current;
        activeRunRef.current = result?.activeRunId || null;
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
  const simulation = run?.status === 'completed' && ['dry_run', 'inventory'].includes(run.mode) ? run.id : undefined;
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
    if (!configured) return;
    let current = true;
    if (view === 'plan' && !run?.id) return;
    const request: OrganizerRequest = view === 'plan' ? { action: 'plan', clientId, runId: run!.id } : view === 'interpretations' ? { action: view, clientId } :
      { action: view, clientId, variantId: filterVariant || undefined, runId: simulation, status: filterStatus || undefined };
    void organizer<OrganizerPage<CatalogItem>>(request).then(result => {
      if (current) setPage(result);
    }).catch(error => { if (current) setLoadError(error.message); });
    return () => { current = false; };
  }, [clientId, configured, revision, view, filterVariant, simulation, filterStatus, run?.id]);

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
    activeRunRef.current = null;
    setConfig(null); setRun(null); setProducts([]); setPlanRunId(undefined); setFilterVariant(''); setFilterStatus(''); setLoadError(''); setClientId(id);
  };
  const selectView = (value: CatalogView, variantId = '') => {
    if (value !== view || variantId !== filterVariant) setPage({ items: [], next: null });
    setFilterVariant(variantId); setView(value);
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
    const result = await perform<OrganizerRun>({ action: 'start', mode, clientId, requestId: crypto.randomUUID(),
      confirmedBudgetUsd: paid ? config?.budgetUsd : undefined, planRunId: paid && !selection ? planRunId : undefined, ...selection }, 'Ejecución en cola');
    if (result) { setRun(result); refresh(); }
  };
  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!run) return;
    if (action === 'cancel' && !await confirm({ title: 'Cancelar ejecución', description: 'Se detendrá el trabajo pendiente. Las copias y resultados guardados se conservan.',
      confirmLabel: 'Cancelar ejecución', tone: 'warning' })) return;
    const result = await perform<OrganizerRun>({ action, clientId, runId: run.id });
    if (result) { setRun(result); refresh(); }
  };
  return { clients, clientId, config, run, view, page, busy, loadError, products, simulation, filterStatus, setFilterStatus, selectClient, selectView, loadClients, loadMore, save, start, control, perform, refresh, setRun };
}
