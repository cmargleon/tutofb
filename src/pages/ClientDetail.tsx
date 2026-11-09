import React, { Suspense, lazy } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Client } from '../../shared/src/types';
import { LoadingBlock, EmptyState, SectionNav, Surface } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { useClientAutomationConfig } from '../features/automation/useClientAutomationConfig';
import { clientListUrl } from '../features/clients/clientListState';
import { ClientDetailHeader } from '../components/clients/ClientDetailHeader';
import { ClientOverview } from '../components/clients/ClientOverview';
import { ClientMarketplaces } from '../features/marketplaces/ClientMarketplaces';
import { ClientSettings } from '../components/clients/ClientSettings';
import { ClientSpreadsheetSection } from '../components/clients/ClientSpreadsheetSection';
import { ClientAutomationFields, ClientAutomationSave, ClientDriveFolders } from '../components/clients/ClientAutomationSection';

const ClientCatalog = lazy(() => import('./Catalogo').then(module => ({ default: module.Catalogo })));

const TABS = [['resumen', 'Resumen'], ['productos', 'Productos'], ['marketplaces', 'Marketplaces'], ['fuentes', 'Fuentes de datos'], ['automatizaciones', 'Automatizaciones'], ['configuracion', 'Configuración'], ['historial', 'Historial']] as const;

const ClientDetailContent: React.FC<{ client: Client; management: ReturnType<typeof useClientManagement> }> = ({ client, management }) => {
  const automation = useClientAutomationConfig(client);
  const [params, setParams] = useSearchParams();
  const active = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab')! : 'resumen';
  const changeTab = (tab: string) => setParams(current => { const next = new URLSearchParams(current); next.set('tab', tab); return next; }, { replace: true });
  const templates = management.sortedTemplatesByClientId[client.id!] || [];
  return <div className="mx-auto max-w-6xl space-y-6">
    <ClientDetailHeader client={client} backUrl={clientListUrl(params)} onArchive={() => void management.handleArchive(client)} onRestore={() => void management.handleRestore(client)} onEdit={() => changeTab('configuracion')} />
    <SectionNav label="Secciones del cliente" items={TABS} active={active} onSelect={changeTab} />
    <Surface className="rounded-2xl p-4 sm:p-6">
      <section hidden={active !== 'resumen'} aria-label="Resumen"><h2 className="mb-4 text-lg font-semibold">Resumen</h2><ClientOverview client={client} templates={templates} /></section>
      <section hidden={active !== 'productos'} aria-label="Productos"><h2 className="mb-4 text-lg font-semibold">Productos</h2><Link className="text-sm font-medium text-indigo-700 hover:underline" to={`/catalogo?clientId=${encodeURIComponent(client.id!)}`}>Abrir catálogo de {client.name} →</Link>{active === 'productos' && <Suspense fallback={<LoadingBlock />}><ClientCatalog client={client} /></Suspense>}</section>
      <section hidden={active !== 'marketplaces'} aria-label="Marketplaces"><h2 className="mb-4 text-lg font-semibold">Marketplaces</h2><ClientMarketplaces client={client} /></section>
      <section hidden={active !== 'fuentes'} aria-label="Fuentes de datos"><h2 className="mb-4 text-lg font-semibold">Fuentes de datos</h2><fieldset disabled={client.status === 'archived' || automation.saving}><ClientDriveFolders state={automation} /></fieldset><ClientAutomationSave state={automation} section="sources" disabled={client.status === 'archived'} /><ClientSpreadsheetSection client={client} templates={templates.filter(t => !t.exportConfig)} uploadingTemplateClientId={management.uploadingTemplateClientId} savingTemplateCategoryId={management.savingTemplateCategoryId} deletingTemplateId={management.deletingTemplateId} onUpload={management.handleTemplateUpload} onCategoryChange={management.handleTemplateCategoryChange} onDelete={management.handleTemplateDelete} /></section>
      <section hidden={active !== 'automatizaciones'} aria-label="Automatizaciones"><h2 className="mb-4 text-lg font-semibold">Automatizaciones</h2><p className="text-sm text-slate-500">Guarda los ajustes de esta pestaña de forma independiente. La generación posterior al Organizador sigue controlada globalmente desde Configuración.</p><ClientAutomationFields client={client} state={automation} /><ClientAutomationSave state={automation} section="automation" disabled={client.status === 'archived'} /></section>
      <section hidden={active !== 'configuracion'} aria-label="Configuración"><h2 className="mb-4 text-lg font-semibold">Configuración</h2><ClientSettings client={client} /></section>
      <section hidden={active !== 'historial'} aria-label="Historial"><EmptyState title="Historial de eventos no disponible" description="No hay una fuente de eventos de cliente adecuada para esta ficha. El catálogo conserva los lotes y productos existentes." /></section>
    </Surface>
  </div>;
};

export const ClientDetail = () => {
  const { clientId = '' } = useParams();
  return /^[\w-]{1,200}$/.test(clientId) ? <ClientDetailLoader key={clientId} clientId={clientId} /> : <EmptyState title="Cliente no disponible" description="El identificador no es válido." action={<Link to="/clients/lista">Volver a la lista</Link>} />;
};
const ClientDetailLoader: React.FC<{ clientId: string }> = ({ clientId }) => {
  const management = useClientManagement(clientId);
  const [params] = useSearchParams();
  if (management.loading) return <LoadingBlock message="Cargando cliente…" />;
  if (management.error) return <div role="alert" className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700"><p>{management.error}</p><Link to={clientListUrl(params)}>Volver a la lista</Link></div>;
  const client = management.clients[0];
  if (!client) return <EmptyState title="Cliente no disponible" description="No existe o no tienes acceso a este cliente." action={<Link to={clientListUrl(params)}>Volver a la lista</Link>} />;
  return <ClientDetailContent key={clientId} client={client} management={management} />;
};
