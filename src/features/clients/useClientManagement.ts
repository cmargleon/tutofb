import React, { useEffect, useMemo, useState } from 'react';
import {
  subscribeToClients,
  subscribeToClient,
  subscribeToClientSpreadsheetTemplates,
  createClient,
  archiveClient,
  restoreClient,
  importClientSpreadsheetTemplate,
  deleteClientSpreadsheetTemplate,
  updateClientSpreadsheetTemplateCategory,
} from './firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { Client, SpreadsheetTemplate } from '../../../shared/src/types';

export { CLIENTS_PAGE_SIZE } from './clientListState';

export const useClientManagement = (clientId?: string) => {
  const toast = useToast();
  const confirm = useConfirm();

  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPrompt, setNewClientPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [uploadingTemplateClientId, setUploadingTemplateClientId] = useState<string | null>(null);
  const [savingTemplateCategoryId, setSavingTemplateCategoryId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const onError = (err: Error) => { setError(err.message || 'Error al cargar los clientes.'); setLoading(false); };
    const onData = (data: Client[]) => { setClients(data); setLoading(false); };
    return clientId
      ? subscribeToClient(clientId, client => onData(client ? [client] : []), onError)
      : subscribeToClients(onData, onError, { includeArchived: true });
  }, [clientId]);

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
      toast({ tone: 'success', title: 'Cliente reactivado', description: `"${client.name}" volvió al catálogo operativo.` });
    } catch (err: any) {
      setClients(snapshot);
      toast({ tone: 'error', title: 'No pudimos reactivar el cliente', description: err.message || 'Inténtalo de nuevo en un momento.' });
    }
  };

  const handleTemplateUpload = async (client: Client, file: File | null) => {
    if (!file || !client.id) return;
    setUploadingTemplateClientId(client.id);
    try {
      const result = await importClientSpreadsheetTemplate(client.id, file);
      toast({ tone: 'success', title: 'Spreadsheet importado', description: `"${file.name}" quedó vinculado a ${client.name} con ${result.categoryCount} categoría${result.categoryCount === 1 ? '' : 's'}.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos importar el spreadsheet', description: err.message || 'Revisa el archivo y vuelve a intentarlo.' });
    } finally {
      setUploadingTemplateClientId(null);
    }
  };

  const handleTemplateCategoryChange = async (client: Client, template: SpreadsheetTemplate, categoryId: string | null) => {
    if (!client.id || !template.id) return;
    setSavingTemplateCategoryId(template.id);
    try {
      await updateClientSpreadsheetTemplateCategory(client.id, template.id, categoryId);
      toast({ tone: 'success', title: 'Categoría por defecto actualizada', description: categoryId ? `El wizard usará la categoría elegida para "${template.name}" por defecto.` : `Se limpió la categoría por defecto de "${template.name}".` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos actualizar la categoría por defecto', description: err.message || 'Vuelve a intentarlo en un momento.' });
    } finally {
      setSavingTemplateCategoryId(null);
    }
  };

  const handleTemplateDelete = async (client: Client, template: SpreadsheetTemplate) => {
    if (!client.id || !template.id) return;
    const accepted = await confirm({
      title: 'Eliminar spreadsheet',
      description: `Vas a eliminar "${template.name}" del cliente "${client.name}".`,
      impact: 'Se borrará la plantilla importada y sus categorías. Si algún lote ya la usa, el sistema no permitirá eliminarla.',
      confirmLabel: 'Sí, eliminar spreadsheet',
      cancelLabel: 'Mantener plantilla',
      tone: 'danger',
    });
    if (!accepted) return;
    setDeletingTemplateId(template.id);
    try {
      await deleteClientSpreadsheetTemplate(client.id, template.id);
      toast({ tone: 'success', title: 'Spreadsheet eliminado', description: `"${template.name}" ya no está disponible para este cliente.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos eliminar el spreadsheet', description: err.message || 'Vuelve a intentarlo en un momento.' });
    } finally {
      setDeletingTemplateId(null);
    }
  };

  return {
    // state
    clients, templates, loading, error,
    newClientName, setNewClientName, newClientPrompt, setNewClientPrompt,
    isCreating, createSuccess,
    uploadingTemplateClientId, savingTemplateCategoryId, deletingTemplateId,
    // computed
    sortedTemplatesByClientId,
    // handlers
    handleCreate,
    handleArchive, handleRestore,
    handleTemplateUpload, handleTemplateCategoryChange, handleTemplateDelete,
  };
};
