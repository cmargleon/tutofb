import React, { useEffect, useMemo, useState } from 'react';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { Role, User } from '../../../shared/src/types';
import {
  archiveAppUser,
  createAppUser,
  permanentlyDeleteAppUser,
  restoreAppUser,
  subscribeToUsers,
  updateAppUser,
} from './firebase';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import {
  buildEditFormState,
  CreateFieldName,
  EditFieldName,
  EditFormState,
  FieldErrors,
  FieldTouched,
  INITIAL_CREATE_FORM,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from './userValidation';
import { CreateAppUserInput } from './firebase';

const USERS_PAGE_SIZE = 15;

export const useUserManagement = () => {
  const { user: currentUser } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateAppUserInput>(INITIAL_CREATE_FORM);
  const [createTouched, setCreateTouched] = useState<FieldTouched<CreateFieldName>>({});
  const [createSubmitAttempted, setCreateSubmitAttempted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editTouched, setEditTouched] = useState<FieldTouched<EditFieldName>>({});
  const [editSubmitAttempted, setEditSubmitAttempted] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [usersPage, setUsersPage] = useState(1);

  const showArchived = statusFilter !== 'active';

  useEffect(() => {
    const unsubscribe = subscribeToUsers(
      (data) => { setUsers(data); setLoading(false); },
      (loadError) => { console.error(loadError); setError('No se pudieron cargar los usuarios.'); setLoading(false); },
      { includeArchived: showArchived },
    );
    return () => unsubscribe();
  }, [showArchived]);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (a.role !== 'admin' && b.role === 'admin') return 1;
        return a.displayName.localeCompare(b.displayName, 'es');
      }),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sortedUsers.filter((u) => {
      if (query && !u.displayName.toLowerCase().includes(query) && !u.email.toLowerCase().includes(query)) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && isArchivedCatalogEntity(u)) return false;
      if (statusFilter === 'archived' && !isArchivedCatalogEntity(u)) return false;
      return true;
    });
  }, [sortedUsers, searchQuery, roleFilter, statusFilter]);

  const usersTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const pagedUsers = filteredUsers.slice((usersPage - 1) * USERS_PAGE_SIZE, usersPage * USERS_PAGE_SIZE);

  const createErrors = useMemo<FieldErrors<CreateFieldName>>(
    () => ({
      displayName: validateDisplayName(form.displayName) || undefined,
      email: validateEmail(form.email) || undefined,
      password: validatePassword(form.password, true) || undefined,
    }),
    [form.displayName, form.email, form.password],
  );
  const createFormIsValid = !createErrors.displayName && !createErrors.email && !createErrors.password;

  const editErrors = useMemo<FieldErrors<EditFieldName>>(
    () =>
      editForm
        ? {
            displayName: validateDisplayName(editForm.displayName) || undefined,
            email: validateEmail(editForm.email) || undefined,
            password: validatePassword(editForm.password, false) || undefined,
          }
        : {},
    [editForm],
  );
  const editFormIsValid = !editErrors.displayName && !editErrors.email && !editErrors.password;

  const shouldShowCreateError = (field: CreateFieldName) =>
    (createTouched[field] || createSubmitAttempted) ? createErrors[field] : null;
  const shouldShowEditError = (field: EditFieldName) =>
    (editTouched[field] || editSubmitAttempted) ? editErrors[field] : null;

  const handleCreateFieldChange = (field: keyof CreateAppUserInput, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateSubmitAttempted(true);
    if (!createFormIsValid) return;
    setIsCreating(true);
    setError(null);
    setCreateSuccess(null);
    try {
      const createdUser = await createAppUser(form);
      setForm(INITIAL_CREATE_FORM);
      setCreateTouched({});
      setCreateSubmitAttempted(false);
      setCreateSuccess(`Usuario ${createdUser.displayName} creado correctamente.`);
      setTimeout(() => setCreateSuccess(null), 4000);
    } catch (createError: any) {
      setError(createError.message || 'No se pudo crear el usuario.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (selectedUser: User) => {
    setExpandedId(selectedUser.uid);
    setEditingUserId(selectedUser.uid);
    setEditForm(buildEditFormState(selectedUser));
    setEditTouched({});
    setEditSubmitAttempted(false);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setEditForm(null);
    setEditTouched({});
    setEditSubmitAttempted(false);
    setIsSavingEdit(false);
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editForm) return;
    setEditSubmitAttempted(true);
    if (!editFormIsValid) return;
    setIsSavingEdit(true);
    setError(null);
    try {
      await updateAppUser({
        uid: editForm.uid,
        email: editForm.email,
        displayName: editForm.displayName,
        role: editForm.role,
        active: editForm.active,
        password: editForm.password.trim() ? editForm.password : undefined,
      });
      handleCancelEdit();
    } catch (saveError: any) {
      setError(saveError.message || 'No se pudo actualizar el usuario.');
      setIsSavingEdit(false);
    }
  };

  const handleQuickToggle = async (selectedUser: User) => {
    setError(null);
    if (isArchivedCatalogEntity(selectedUser)) {
      setError('Primero restaura el usuario archivado antes de cambiar su estado.');
      return;
    }
    try {
      await updateAppUser({ uid: selectedUser.uid, email: selectedUser.email, displayName: selectedUser.displayName, role: selectedUser.role, active: !selectedUser.active });
      toast({
        tone: 'success',
        title: selectedUser.active ? 'Usuario desactivado' : 'Usuario reactivado',
        description: selectedUser.active
          ? `"${selectedUser.displayName}" ya no podrá entrar hasta reactivarlo.`
          : `"${selectedUser.displayName}" volvió a quedar habilitado.`,
      });
    } catch (toggleError: any) {
      setError(toggleError.message || 'No se pudo cambiar el estado del usuario.');
    }
  };

  const handleArchive = async (selectedUser: User) => {
    if (currentUser?.uid === selectedUser.uid) { setError('No puedes archivar tu propia cuenta desde este panel.'); return; }
    const accepted = await confirm({
      title: 'Archivar usuario',
      description: `Vas a archivar a "${selectedUser.displayName}" y sacarlo del panel operativo.`,
      impact: 'La cuenta quedará desactivada y no podrá iniciar sesión. Podrás restaurarla después y reactivarla cuando haga falta.',
      confirmLabel: 'Sí, archivar usuario',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });
    if (!accepted) return;
    setError(null);
    try {
      await archiveAppUser(selectedUser.uid);
      toast({ tone: 'success', title: 'Usuario archivado', description: `"${selectedUser.displayName}" salió del panel principal y quedó desactivado.` });
    } catch (archiveError: any) {
      setError(archiveError.message || 'No se pudo archivar el usuario.');
    }
  };

  const handleRestore = async (selectedUser: User) => {
    setError(null);
    try {
      await restoreAppUser(selectedUser.uid);
      toast({ tone: 'success', title: 'Usuario restaurado', description: `"${selectedUser.displayName}" volvió al panel y quedó inactivo hasta reactivarlo.` });
    } catch (restoreError: any) {
      setError(restoreError.message || 'No se pudo restaurar el usuario.');
    }
  };

  const handlePermanentDelete = async (selectedUser: User) => {
    if (currentUser?.uid === selectedUser.uid) { setError('No puedes borrar tu propia cuenta desde este panel.'); return; }
    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente a "${selectedUser.displayName}".`,
      impact: 'Esto elimina la cuenta y todos sus datos de forma permanente. Solo úsalo después de archivarla.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });
    if (!accepted) return;
    const typedEmail = window.prompt(`Escribe el email exacto del usuario para confirmar el borrado permanente:\n${selectedUser.email}`);
    if (typedEmail !== selectedUser.email) {
      toast({ tone: 'warning', title: 'Borrado cancelado', description: 'El email no coincidió. No se eliminó nada.' });
      return;
    }
    setError(null);
    try {
      await permanentlyDeleteAppUser(selectedUser.uid);
      toast({ tone: 'success', title: 'Usuario eliminado definitivamente', description: `"${selectedUser.displayName}" se eliminó de forma permanente.` });
    } catch (deleteError: any) {
      setError(deleteError.message || 'No se pudo borrar el usuario definitivamente.');
    }
  };

  return {
    // state
    loading, error, form, createTouched, setCreateTouched, createSubmitAttempted,
    isCreating, createSuccess, expandedId, setExpandedId, editingUserId,
    isCreateFormOpen, setIsCreateFormOpen, editForm, setEditForm,
    editTouched, setEditTouched, editSubmitAttempted, isSavingEdit,
    searchQuery, setSearchQuery, roleFilter, setRoleFilter,
    statusFilter, setStatusFilter, usersPage, setUsersPage,
    // computed
    pagedUsers, filteredUsers, usersTotalPages,
    createErrors, createFormIsValid, editErrors, editFormIsValid,
    shouldShowCreateError, shouldShowEditError,
    // handlers
    handleCreateFieldChange, handleCreate, handleStartEdit, handleCancelEdit,
    handleSaveEdit, handleQuickToggle, handleArchive, handleRestore, handlePermanentDelete,
  };
};
