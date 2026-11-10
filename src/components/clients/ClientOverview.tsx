import React from 'react';
import { ChevronRight, Store } from 'lucide-react';
import type { Client, SpreadsheetTemplate } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { Badge, Card, CardHeader } from '../ui';

export const ClientOverview = ({ client, templates, onOpenTab }: { client: Client; templates: SpreadsheetTemplate[]; onOpenTab?: (tab: string) => void }) => {
  const channels = MARKETPLACES.filter(channel => client.marketplaces?.[channel.id]?.enabled === true);
  const fields = [
    ['Creado', formatDateTimeLong(client.createdAt)],
    ['Marketplaces habilitados', channels.map(channel => channel.name).join(', ') || 'Ninguno'],
    ['Fuentes', `${templates.length} plantillas · ${client.automation?.driveFolderIds?.length ?? 0} carpetas autorizadas de Drive`],
    ['Automatización', client.automation?.enabled === false ? 'Desactivada' : client.automation?.enabled === true ? 'Activada' : 'Sin configuración explícita'],
    ['Lotes de generación', Number.isFinite(client.batchCount) ? String(client.batchCount) : 'No disponible'],
    ['Último lote creado', client.lastBatchCreatedAt ? formatDateTimeLong(client.lastBatchCreatedAt) : 'Sin lotes registrados'],
  ];
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
    <Card className="overflow-hidden">
      <CardHeader title="Datos generales" description="Información operativa del cliente." />
      <dl className="tuto-dl px-5 pb-1 lg:!grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </Card>
    <Card className="overflow-hidden">
      <CardHeader title="Canales de venta" description="Estado administrativo por marketplace." />
      <ul className="divide-y divide-slate-100">
        {MARKETPLACES.map(channel => {
          const enabled = client.marketplaces?.[channel.id]?.enabled === true;
          return <li key={channel.id} className="flex items-center gap-3 px-5 py-3">
            <span className="tuto-avatar tuto-avatar--sm" aria-hidden="true"><Store /></span>
            <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">{channel.name}</span>
            <Badge tone={enabled ? 'success' : 'neutral'} dot>{enabled ? 'Habilitado' : 'Deshabilitado'}</Badge>
          </li>;
        })}
      </ul>
      {onOpenTab ? <div className="border-t border-slate-100 px-5 py-3"><button type="button" className="tuto-link inline-flex items-center gap-1 text-sm" onClick={() => onOpenTab('marketplaces')}>Gestionar marketplaces<ChevronRight className="h-4 w-4" aria-hidden="true" /></button></div> : null}
    </Card>
  </div>;
};
