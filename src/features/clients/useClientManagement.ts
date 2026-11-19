import React, { useEffect, useMemo, useState } from 'react';
import {
  listClients,
  subscribeToClient,
  subscribeToClientSpreadsheetTemplates,
  createClient,
  archiveClient,
  restoreClient,
} from './firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { Client, SpreadsheetTemplate } from '../../../shared/src/types';

export { CLIENTS_PAGE_SIZE } from './clientListState';

export const useClientManagement = (clientId?: string, filters?: import('../../../shared/src/types').ListClientsRequest, skipList = false) => {
  const toast = useToast();
  const confirm = useConfirm();

  const [pageInfo, setPageInfo] = useState({ page: filters?.page ?? 1, hasMore: false, queryKey: '' });
  const [refresh, setRefresh] = useState(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPrompt, setNewClientPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const onError = (err: Error) => { setError(err.message || 'Error al cargar los clientes.'); setLoading(false); };
    const onData = (data: Client[]) => { setClients(data); setLoading(false); };
    if (clientId) return subscribeToClient(clientId, client => onData(client ? [client] : []), onError);
    if (skipList) { setLoading(false); return; }
    let active = true;
    setClients([]);
    void listClients(filters ?? {}).then(result => {
      if (active) { onData(result.clients); setPageInfo({ page: result.page, hasMore: result.hasMore, queryKey: JSON.stringify(filters) }); }
    }, err => { if (active) onError(err); });
    return () => { active = false; };
  }, [clientId, JSON.stringify(filters), skipList, refresh]);

  useEffect(() => {
    if (!clientId) return;
    return subscribeToClientSpreadsheetTemplates(clientId, setTemplates,
      err => setError(`No se pudieron cargar las plantillas: ${err.message}`));
  }, [clientId]);

  const templatesByClientId = useMemo(
    () => templates.reduce<Record<string, SpreadsheetTemplate[]>>((acc, t) => {
      if (!t.clientId) return acc;
      acc[t.clientId] = [...(acc[t.clientId] || []), t];
      return acc;
    }, {}),
    [templates],
  );

  const sortedTemplatesByClientId = useMemo(
    () => Object.keys(templatesByClientId).reduce<Record<string, SpreadsheetTemplate[]>>((acc, clientId) => {
      const ts = templatesByClientId[clientId] || [];
      acc[clientId] = [...ts].sort((a, b) => (a.name?.toLowerCase() || '').localeCompare(b.name?.toLowerCase() || '', 'es'));
      return acc;
    }, {}),
    [templatesByClientId],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newClientName.trim();
    if (!trimmedName) return;
    setIsCreating(true);
    setError(null);
    setCreateSuccess(false);
    try {
      await createClient(trimmedName, newClientPrompt);
      setNewClientName('');
      setNewClientPrompt('');
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al crear cliente');
    } finally {
      setIsCreating(false);
    }
  };

  const handleArchive = async (client: Client) => {
    const accepted = await confirm({
      title: 'Archivar cliente',
      description: `Vas a archivar "${client.name}" y sacarlo del catálogo operativo.`,
      impact: 'El cliente dejará de aparecer en los flujos de generación. Su historial se conserva y podrás restaurarlo después.',
      confirmLabel: 'Sí, archivar cliente',
      cancelLabel: 'Mantener activo',
      tone: 'warning',
    });
    if (!accepted || !client.id) return;
    const snapshot = clients;
    setClients((prev) => prev.map((c) => c.id === client.id ? { ...c, status: 'archived' as const } : c));
    try {
      await archiveClient(client.id);
      setRefresh(value => value + 1);
      toast({ tone: 'success', title: 'Cliente archivado', description: `"${client.name}" salió del catálogo operativo pero su historial sigue disponible.` });
    } catch (err: any) {
      setClients(snapshot);
      toast({ tone: 'error', title: 'No pudimos archivar el cliente', description: err.message || 'Inténtalo de nuevo en un momento.' });
    }
  };

  const handleRestore = async (client: Client) => {
    if (!client.id) return;
    const snapshot = clients;
    setClients((prev) => prev.map((c) => c.id === client.id ? { ...c, status: 'active' as const } : c));
    try {
      await restoreClient(client.id);
      setRefresh(value => value + 1);
      toast({ tone: 'success', title: 'Cliente reactivado', description: `"${client.name}" volvió al catálogo operativo.` });
    } catch (err: any) {
      setClients(snapshot);
      toast({ tone: 'error', title: 'No pudimos reactivar el cliente', description: err.message || 'Inténtalo de nuevo en un momento.' });
    }
  };

  return {
    // state
    clients, templates, loading, error, pageInfo,
    newClientName, setNewClientName, newClientPrompt, setNewClientPrompt,
    isCreating, createSuccess,
    // computed
    sortedTemplatesByClientId,
    // handlers
    handleCreate,
    handleArchive, handleRestore,
  };
};
