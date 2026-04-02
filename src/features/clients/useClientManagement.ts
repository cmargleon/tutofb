import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  subscribeToClients,
  subscribeToSpreadsheetTemplates,
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  permanentlyDeleteClient,
  importClientSpreadsheetTemplate,
  deleteClientSpreadsheetTemplate,
  updateClientSpreadsheetTemplateCategory,
} from './firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { Client, SpreadsheetTemplate } from '../../../shared/src/types';

export const CLIENTS_PAGE_SIZE = 20;

export const useClientManagement = () => {
  const location = useLocation();
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsPage, setClientsPage] = useState(1);
  const [uploadingTemplateClientId, setUploadingTemplateClientId] = useState<string | null>(null);
  const [savingTemplateCategoryId, setSavingTemplateCategoryId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToClients(
      (data) => { setClients(data); setLoading(false); },
      (err) => { console.error('Error subscribing to clients:', err); setError('Error al cargar los clientes.'); setLoading(false); },
      { includeArchived: showArchived },
    );
    return () => unsubscribe();
  }, [showArchived]);

  useEffect(() => {
    const unsubscribe = subscribeToSpreadsheetTemplates(
      (data) => setTemplates(data),
      (err) => { console.error('Error subscribing to spreadsheet templates:', err); },
    );
    return () => unsubscribe();
  }, []);

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(query));
  }, [clients, clientSearch]);

  const clientsTotalPages = Math.max(1, Math.ceil(filteredClients.length / CLIENTS_PAGE_SIZE));
  const pagedClients = filteredClients.slice((clientsPage - 1) * CLIENTS_PAGE_SIZE, clientsPage * CLIENTS_PAGE_SIZE);

  const highlightedClientId = location.hash.startsWith('#client-') ? location.hash.slice('#client-'.length) : null;

  useEffect(() => {
    if (!highlightedClientId) return;
    const targetIndex = clients.findIndex((client) => client.id === highlightedClientId);
    if (targetIndex < 0) return;
    if (clientSearch) setClientSearch('');
    const targetPage = Math.floor(targetIndex / CLIENTS_PAGE_SIZE) + 1;
    if (clientsPage !== targetPage) setClientsPage(targetPage);
    setExpandedId(highlightedClientId);
    const scrollTarget = () => {
      const element = document.getElementById(`client-${highlightedClientId}`);
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };
    if (scrollTarget()) return;
    const timeoutId = window.setTimeout(() => { scrollTarget(); }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [clientSearch, clients, clientsPage, highlightedClientId]);

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

  const handleStartEdit = (client: Client) => {
    setEditingId(client.id!);
    setEditName(client.name);
    setEditPrompt(client.generationPromptBase ?? '');
  };

  const handleSaveEdit = async (id: string) => {
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    try {
      await updateClient(id, trimmedName, editPrompt);
      setEditingId(null);
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos actualizar el cliente', description: err.message || 'Vuelve a intentarlo en un momento.' });
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
    try {
      await archiveClient(client.id);
      toast({ tone: 'success', title: 'Cliente archivado', description: `"${client.name}" salió del catálogo operativo pero su historial sigue disponible.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos archivar el cliente', description: err.message || 'Inténtalo de nuevo en un momento.' });
    }
  };

  const handleRestore = async (client: Client) => {
    if (!client.id) return;
    try {
      await restoreClient(client.id);
      toast({ tone: 'success', title: 'Cliente reactivado', description: `"${client.name}" volvió al catálogo operativo.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos reactivar el cliente', description: err.message || 'Inténtalo de nuevo en un momento.' });
    }
  };

  const handlePermanentDelete = async (client: Client) => {
    if (!client.id) return;
    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente "${client.name}".`,
      impact: 'Esto elimina todos los datos del cliente de forma permanente. No se puede deshacer.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!accepted) return;
    const typedName = window.prompt(`Escribe el nombre exacto del cliente para confirmar el borrado permanente:\n${client.name}`);
    if (typedName !== client.name) {
      toast({ tone: 'warning', title: 'Borrado cancelado', description: 'El nombre no coincidió. No se eliminó nada.' });
      return;
    }
    try {
      await permanentlyDeleteClient(client.id);
      toast({ tone: 'success', title: 'Cliente eliminado definitivamente', description: `"${client.name}" se eliminó de forma permanente.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos borrar el cliente definitivamente', description: err.message || 'Revisa dependencias o permisos e inténtalo de nuevo.' });
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
    editingId, setEditingId, editName, setEditName, editPrompt, setEditPrompt,
    expandedId, setExpandedId, showArchived, setShowArchived,
    clientSearch, setClientSearch, clientsPage, setClientsPage,
    uploadingTemplateClientId, savingTemplateCategoryId, deletingTemplateId,
    // computed
    filteredClients, clientsTotalPages, pagedClients, highlightedClientId,
    sortedTemplatesByClientId,
    // handlers
    handleCreate, handleStartEdit, handleSaveEdit,
    handleArchive, handleRestore, handlePermanentDelete,
    handleTemplateUpload, handleTemplateCategoryChange, handleTemplateDelete,
  };
};
