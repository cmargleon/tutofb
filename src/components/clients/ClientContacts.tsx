import React from 'react';
import type { Client } from '../../../shared/src/types';
import { MAX_CLIENT_CONTACTS } from '../../../shared/src/clientContacts';
import { useClientContacts } from '../../features/clients/useClientContacts';
import { Button } from '../ui';
import { INPUT_BASE } from './clientUtils';

export const ClientContacts = ({ client }: { client: Client }) => {
  const state = useClientContacts(client);
  const archived = client.status === 'archived';
  return <form className="max-w-3xl space-y-4" onSubmit={event => { event.preventDefault(); void state.save(); }}>
    <fieldset disabled={archived || state.saving} className="space-y-4">
      <legend className="sr-only">Contactos del cliente</legend>
      {state.value.length === 0 && <p className="text-sm text-slate-500">Todavía no hay contactos. Agrega las personas de contacto de este cliente.</p>}
      {state.value.map((contact, index) => <fieldset key={index} className="space-y-3 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Contacto {index + 1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2 text-sm">Nombre<input required maxLength={500} autoComplete="name" className={INPUT_BASE} value={contact.name} onChange={event => state.setValue(current => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></label>
          <label className="block space-y-2 text-sm">Correo electrónico<input required type="email" maxLength={254} autoComplete="email" className={INPUT_BASE} value={contact.email} onChange={event => state.setValue(current => current.map((item, position) => position === index ? { ...item, email: event.target.value } : item))} /></label>
        </div>
        <Button type="button" variant="ghost" onClick={() => void state.remove(index)}>Quitar contacto {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={state.value.length >= MAX_CLIENT_CONTACTS} onClick={() => state.setValue(current => [...current, { name: '', email: '' }])}>Agregar contacto</Button>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={state.saving} disabled={!state.dirty}>Guardar contactos</Button>
        {state.dirty && <><p className="text-xs text-amber-700">Cambios sin guardar · borrador conservado en esta sesión</p><Button type="button" variant="ghost" onClick={state.discard}>Descartar cambios de contactos</Button></>}
      </div>
    </fieldset>
    {state.conflict && <div className="space-y-2 rounded-lg border border-amber-300 p-3 text-sm">
      <p>Contactos actuales en el servidor:</p>
      {state.conflict.length ? state.conflict.map((contact, index) => <p key={index}>{contact.name} · {contact.email}</p>) : <p>Sin contactos</p>}
      <Button type="button" variant="secondary" onClick={state.keepDraft}>Conservar mi borrador y revisar antes de guardar</Button>
      <Button type="button" variant="ghost" onClick={state.discard}>Usar valores actuales</Button>
    </div>}
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    {state.saved && <p role="status" className="text-sm text-emerald-700">Contactos guardados</p>}
  </form>;
};
