import React, { useEffect, useState } from 'react';
import type { User, Client, SetUserClientAccessRequest, SetUserClientAccessResponse } from '../../../shared/src/types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { subscribeToClients } from '../../features/clients/firebase';
import { Button } from '../ui';
import { useToast } from '../../features/feedback/FeedbackProvider';

export function UserClientAccess({ user }: { user: User }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [mode, setMode] = useState(user.clientAccess?.mode ?? 'assigned');
  const [ids, setIds] = useState(user.clientAccess?.mode === 'assigned' ? user.clientAccess.clientIds : []);
  const [base, setBase] = useState(user.clientAccess ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => subscribeToClients(setClients, err => setError(err.message), { includeArchived: true }), []);
  if (user.role === 'admin') return <p className="mt-4 text-sm text-slate-500">Alcance humano: global (administrador).</p>;
  const save = async () => {
    setSaving(true); setError('');
    const clientAccess = mode === 'global' ? { mode: 'global' as const } : { mode: 'assigned' as const, clientIds: ids };
    try {
      await httpsCallable<SetUserClientAccessRequest, SetUserClientAccessResponse>(functions, 'setUserClientAccess')({ uid: user.uid, clientAccess, expected: base });
      setBase(clientAccess); toast({ tone: 'success', title: 'Alcance de clientes guardado' });
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  return <fieldset disabled={saving} className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
    <legend className="px-2 text-sm font-medium">Alcance humano por cliente</legend>
    {!user.clientAccess && <p className="text-xs text-amber-700">Pendiente de definir. Esta cuenta necesita una selección explícita para acceder a clientes.</p>}
    <label className="block text-sm">Acceso<select className="tuto-field ml-3" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="assigned">Clientes asignados</option><option value="global">Global explícito</option></select></label>
    {mode === 'assigned' && <div className="max-h-48 space-y-2 overflow-auto">{clients.map(client => <label className="flex gap-2 text-sm" key={client.id}><input type="checkbox" checked={ids.includes(client.id!)} onChange={event => setIds(current => event.target.checked ? [...current, client.id!] : current.filter(id => id !== client.id))} />{client.name}{client.status === 'archived' ? ' (archivado)' : ''}</label>)}</div>}
    {mode === 'assigned' && !ids.length && <p className="text-xs text-slate-500">Sin clientes asignados: no permite consultar datos de clientes.</p>}
    <Button type="button" size="sm" loading={saving} onClick={() => void save()}>Guardar alcance humano</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </fieldset>;
}
