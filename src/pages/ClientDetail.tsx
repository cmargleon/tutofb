import React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Client } from '../../shared/src/types';
import { History } from 'lucide-react';
import { LoadingBlock, EmptyState, SectionNav, Page, Card, CardHeader, CardBody, SectionHeading, Alert, Button, buttonClasses } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { useClientAutomationConfig } from '../features/automation/useClientAutomationConfig';
import { clientListUrl } from '../features/clients/clientListState';
import { ClientDetailHeader } from '../components/clients/ClientDetailHeader';
import { ClientOverview } from '../components/clients/ClientOverview';
import { ClientMarketplaces } from '../features/marketplaces/ClientMarketplaces';
import { ClientContacts } from '../components/clients/ClientContacts';
import { ClientEmail } from '../components/clients/ClientEmail';
import { ClientSettings } from '../components/clients/ClientSettings';
import { ClientAutomationFields, ClientAutomationSave, ClientDriveFolders } from '../components/clients/ClientAutomationSection';

const TABS = [['resumen', 'Resumen'], ['contactos', 'Contactos'], ['correos', 'Correos'], ['marketplaces', 'Marketplaces'], ['fuentes', 'Fuentes de datos'], ['automatizaciones', 'Automatizaciones'], ['configuracion', 'Configuración'], ['historial', 'Historial']] as const;

const ClientDetailContent: React.FC<{ client: Client; management: ReturnType<typeof useClientManagement> }> = ({ client, management }) => {
  const automation = useClientAutomationConfig(client);
  const [params, setParams] = useSearchParams();
  const active = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab')! : 'resumen';
  const changeTab = (tab: string) => setParams(current => { const next = new URLSearchParams(current); next.set('tab', tab); return next; }, { replace: true });
  const templates = management.sortedTemplatesByClientId[client.id!] || [];
  const archived = client.status === 'archived';
  return <Page>
    <ClientDetailHeader client={client} backUrl={clientListUrl(params)} onArchive={() => void management.handleArchive(client)} onRestore={() => void management.handleRestore(client)} onEdit={() => changeTab('configuracion')} />
    <SectionNav label="Secciones del cliente" items={TABS} active={active} onSelect={changeTab} />
    {archived && <Alert tone="warning">Cliente archivado: la configuración se conserva, pero las ediciones están deshabilitadas hasta reactivarlo.</Alert>}

    <section hidden={active !== 'resumen'} aria-label="Resumen">
      <h2 className="sr-only">Resumen</h2>
      <ClientOverview client={client} templates={templates} onOpenTab={changeTab} />
    </section>

    <section hidden={active !== 'contactos'} aria-label="Contactos">
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader title="Contactos" description="Personas de contacto del cliente, con su nombre y correo electrónico." />
        <CardBody><ClientContacts client={client} /></CardBody>
      </Card>
    </section>

    {active === 'correos' && <section aria-label="Correos"><ClientEmail key={client.id} client={client} /></section>}

    <section hidden={active !== 'marketplaces'} aria-label="Marketplaces">
      <SectionHeading title="Marketplaces" description="Activa canales y gestiona sus plantillas oficiales de exportación." />
      <ClientMarketplaces client={client} />
    </section>

    <section hidden={active !== 'fuentes'} aria-label="Fuentes de datos" className="space-y-5">
      <h2 className="sr-only">Fuentes de datos</h2>
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader as="h3" title="Google Drive" description="Carpetas de origen compartidas por la automatización y el Organizador inteligente." />
        <CardBody>
          <ClientDriveFolders state={automation} disabled={archived || automation.saving} />
        </CardBody>
      </Card>
      <Alert tone="info" action={<Button size="sm" variant="secondary" onClick={() => changeTab('marketplaces')}>Ir a Marketplaces</Button>}>Las plantillas Excel del cliente se gestionan por marketplace y son la fuente de verdad (estructura, categorías y mapeos) para el wizard y la exportación.</Alert>
    </section>

    <section hidden={active !== 'automatizaciones'} aria-label="Automatizaciones">
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader title="Automatizaciones" description="Guarda los ajustes de esta pestaña de forma independiente. Define las reglas y la generación posterior al Organizador para este cliente. Los valores vacíos heredan Sistema." />
        <CardBody className="pt-0">
          <ClientAutomationFields client={client} state={automation} />
          <ClientAutomationSave state={automation} disabled={archived} />
        </CardBody>
      </Card>
    </section>

    <section hidden={active !== 'configuracion'} aria-label="Configuración">
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader title="Configuración" description="Nombre y prompt base que se precargan en el wizard de generación." />
        <CardBody><ClientSettings client={client} /></CardBody>
      </Card>
    </section>

    <section hidden={active !== 'historial'} aria-label="Historial">
      <Card className="rounded-2xl"><EmptyState icon={<History />} title="Historial de eventos no disponible" description="No hay una fuente de eventos de cliente adecuada para esta ficha. El catálogo conserva los lotes y productos existentes." /></Card>
    </section>
  </Page>;
};

export const ClientDetail = () => {
  const { clientId = '' } = useParams();
  return /^[\w-]{1,200}$/.test(clientId) ? <ClientDetailLoader key={clientId} clientId={clientId} /> : <EmptyState title="Cliente no disponible" description="El identificador no es válido." action={<Link className={buttonClasses('secondary')} to="/clients/lista">Volver a la lista</Link>} />;
};
const ClientDetailLoader: React.FC<{ clientId: string }> = ({ clientId }) => {
  const management = useClientManagement(clientId);
  const [params] = useSearchParams();
  if (management.loading) return <LoadingBlock message="Cargando cliente…" />;
  if (management.error) return <Alert tone="danger" title="No se pudo cargar el cliente" action={<Link className={buttonClasses('secondary', 'sm')} to={clientListUrl(params)}>Volver a la lista</Link>}>{management.error}</Alert>;
  const client = management.clients[0];
  if (!client) return <EmptyState title="Cliente no disponible" description="No existe o no tienes acceso a este cliente." action={<Link className={buttonClasses('secondary')} to={clientListUrl(params)}>Volver a la lista</Link>} />;
  return <ClientDetailContent key={clientId} client={client} management={management} />;
};
