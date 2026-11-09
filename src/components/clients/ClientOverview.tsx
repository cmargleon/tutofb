import React from 'react';
import type { Client, SpreadsheetTemplate } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';

export const ClientOverview = ({ client, templates }: { client: Client; templates: SpreadsheetTemplate[] }) => {
  const channels = MARKETPLACES.filter(channel => client.marketplaces?.[channel.id]?.enabled === true);
  const fields = [
    ['Creado', formatDateTimeLong(client.createdAt)],
    ['Marketplaces habilitados', channels.map(channel => channel.name).join(', ') || 'Ninguno'],
    ['Fuentes', `${templates.length} plantillas · ${client.automation?.driveFolderIds?.length ?? 0} carpetas autorizadas de Drive`],
    ['Automatización', client.automation?.enabled === false ? 'Desactivada' : client.automation?.enabled === true ? 'Activada' : 'Sin configuración explícita'],
    ['Lotes de generación', Number.isFinite(client.batchCount) ? String(client.batchCount) : 'No disponible'],
    ['Último lote creado', client.lastBatchCreatedAt ? formatDateTimeLong(client.lastBatchCreatedAt) : 'Sin lotes registrados'],
  ];
  return <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label, value]) => <div key={label} className="min-w-0 border-b border-slate-100 pb-5"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-2 break-words text-sm font-semibold text-slate-900">{value}</dd></div>)}</dl>;
};
