import React, { useState } from 'react';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { useClientMarketplace } from '../../features/clients/useClientMarketplace';
import { Button } from '../ui';
import { INPUT_BASE } from './clientUtils';

const MarketplaceCard: React.FC<{ client: Client; channel: typeof MARKETPLACES[number] }> = ({ client, channel }) => {
  const state = useClientMarketplace(client, channel.id);
  const [open, setOpen] = useState(false);
  const disabled = state.saving || client.status === 'archived';
  return <article className="rounded-xl border border-slate-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{channel.name}</h3><p className="mt-1 text-xs text-slate-500">{state.enabled ? 'Habilitado administrativamente' : 'Deshabilitado administrativamente'}</p></div>
      <div className="flex items-center gap-3"><button type="button" role="switch" aria-label={`Habilitar ${channel.name} administrativamente`} aria-checked={state.enabled} disabled={disabled} onClick={() => void state.save({ enabled: !state.enabled })} className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${state.enabled ? 'bg-indigo-600' : 'bg-slate-300'}`}><span style={{ backgroundColor: '#fff' }} className={`absolute top-0.5 h-5 w-5 rounded-full shadow-sm transition-all ${state.enabled ? 'left-5.5' : 'left-0.5'}`} /></button><Button variant="secondary" size="sm" aria-expanded={open} aria-controls={`config-${channel.id}`} onClick={() => setOpen(!open)}>Configurar</Button></div>
    </div>
    <p className="mt-3 text-xs text-slate-500">Conexión autenticada: no implementada · Preparado para publicar: no</p>
    <div hidden={!open} id={`config-${channel.id}`} className="mt-4 border-t border-slate-100 pt-4"><fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">País o región<input className={INPUT_BASE} maxLength={80} value={state.value.region} onChange={e => state.setValue({ ...state.value, region: e.target.value })} /></label><label className="space-y-1 text-sm">Identificador de vendedor<input className={INPUT_BASE} maxLength={200} value={state.value.sellerId} onChange={e => state.setValue({ ...state.value, sellerId: e.target.value })} /></label></fieldset><div className="mt-3 flex flex-wrap items-center gap-3"><Button size="sm" disabled={disabled || !state.dirty} onClick={() => void state.save({ settings: state.value })}>Guardar ajustes de {channel.name}</Button>{state.dirty && <><span className="text-xs text-amber-700">Cambios sin guardar · borrador conservado en esta sesión</span><Button size="sm" variant="ghost" onClick={state.discard}>Descartar borrador de {channel.name}</Button></>}</div></div>
    <div aria-live="polite" className="mt-2 text-xs">{state.saving ? 'Guardando…' : state.error ? <p role="alert" className="text-red-700">{state.error}</p> : state.saved ? <p className="text-emerald-700">Guardado</p> : null}</div>
  </article>;
};
export const ClientMarketplaces = ({ client }: { client: Client }) => <div className="space-y-4"><p className="text-sm text-slate-500">Estos ajustes solo habilitan canales administrativamente. La conexión real se implementará en una fase posterior. No introduzcas credenciales.</p><div className="grid gap-4 lg:grid-cols-2">{MARKETPLACES.map(channel => <MarketplaceCard key={channel.id} client={client} channel={channel} />)}</div></div>;
