import React from 'react';
import type { Client } from '../../../shared/src/types';
import { useClientSettings } from '../../features/clients/useClientSettings';
import { Button } from '../ui';
import { INPUT_BASE } from './clientUtils';

export const ClientSettings = ({ client }: { client: Client }) => {
  const state = useClientSettings(client);
  return <form onSubmit={event => { event.preventDefault(); void state.save(); }} className="max-w-3xl space-y-4">
    <fieldset disabled={state.saving} className="space-y-4"><label className="block space-y-2 text-sm">Nombre del cliente<input required maxLength={500} className={INPUT_BASE} value={state.value.name} onChange={e => state.setValue({ ...state.value, name: e.target.value })} /></label><label className="block space-y-2 text-sm">Prompt base del cliente<textarea className={INPUT_BASE} maxLength={30000} rows={8} value={state.value.prompt} onChange={e => state.setValue({ ...state.value, prompt: e.target.value })} /><span className="block text-xs text-slate-500">Si está vacío, se hereda el prompt global. Se precarga al seleccionar este cliente en el wizard.</span></label></fieldset>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" loading={state.saving} disabled={!state.dirty || !state.value.name.trim()}>Guardar datos generales</Button>{state.dirty && <><p className="text-xs text-amber-700">Cambios sin guardar · borrador conservado en esta sesión</p><Button type="button" variant="ghost" onClick={state.discard}>Descartar borrador de datos generales</Button></>}</div>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}{state.saved && <p role="status" className="text-sm text-emerald-700">Datos generales guardados</p>}
  </form>;
};
