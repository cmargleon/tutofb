import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Edit2, Plus, Trash2, Users as UsersIcon, X } from 'lucide-react';
import { isArchivedCatalogEntity, ROLE_VALUES } from '../../shared/src/domain';
import { Role, User } from '../../shared/src/types';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import {
  archiveAppUser,
  CreateAppUserInput,
  subscribeToUsers,
  createAppUser,
  permanentlyDeleteAppUser,
  restoreAppUser,
  updateAppUser
} from '../features/users/firebase';
import { useAuth } from '../features/auth/AuthProvider';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';

const formatDate = (timestamp: unknown) => {
  if (!timestamp) return 'Sin fecha';
  const date = typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
    ? (timestamp as { toDate: () => Date }).toDate()
    : new Date(timestamp as string | number | Date);

  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  operador: 'Operador',
  revisor: 'Revisor',
};

const INITIAL_CREATE_FORM: CreateAppUserInput = {
  email: '',
  displayName: '',
  password: '',
  role: 'operador',
  active: true,
};

interface EditFormState {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  password: string;
}

const buildEditFormState = (user: User): EditFormState => ({
  uid: user.uid,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  active: user.active,
  password: '',
});

type CreateFieldName = 'displayName' | 'email' | 'password';
type EditFieldName = 'displayName' | 'email' | 'password';

type FieldErrors<T extends string> = Partial<Record<T, string>>;
type FieldTouched<T extends string> = Partial<Record<T, boolean>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateDisplayName = (value: string): string | null => {
  const normalized = value.trim();

  if (!normalized) {
    return 'El nombre es obligatorio.';
  }

  if (normalized.length < 3) {
    return 'El nombre debe tener al menos 3 caracteres.';
  }

  return null;
};

const validateEmail = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return 'El email es obligatorio.';
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return 'Ingresa un email válido.';
  }

  return null;
};

const validatePassword = (value: string, required: boolean): string | null => {
  const normalized = value.trim();

  if (!normalized) {
    return required ? 'La contraseña es obligatoria.' : null;
  }

  if (normalized.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }

  return null;
};

const getInputClassName = (hasError: boolean) =>
  `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-rose-300 bg-rose-50/40 text-rose-900 focus:border-rose-500 focus:ring-rose-500'
      : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500'
  }`;

const FieldError: React.FC<{ message?: string | null }> = ({ message }) =>
  message ? <p className="mt-1 text-xs text-rose-600">{message}</p> : null;

const StatusPill: React.FC<{ active: boolean }> = ({ active }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
      active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
    }`}
  >
    {active ? 'Activo' : 'Inactivo'}
  </span>
);

export const Users: React.FC = () => {
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
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editTouched, setEditTouched] = useState<FieldTouched<EditFieldName>>({});
  const [editSubmitAttempted, setEditSubmitAttempted] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToUsers(
      (data) => {
        setUsers(data);
        setLoading(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los usuarios.');
        setLoading(false);
      },
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

  const shouldShowCreateError = (field: CreateFieldName) => (createTouched[field] || createSubmitAttempted) ? createErrors[field] : null;
  const shouldShowEditError = (field: EditFieldName) => (editTouched[field] || editSubmitAttempted) ? editErrors[field] : null;

  const handleCreateFieldChange = (field: keyof CreateAppUserInput, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateSubmitAttempted(true);
    if (!createFormIsValid) {
      return;
    }

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
    if (!editFormIsValid) {
      return;
    }

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
      await updateAppUser({
        uid: selectedUser.uid,
        email: selectedUser.email,
        displayName: selectedUser.displayName,
        role: selectedUser.role,
        active: !selectedUser.active,
      });
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
    if (currentUser?.uid === selectedUser.uid) {
      setError('No puedes archivar tu propia cuenta desde este panel.');
      return;
    }

    const accepted = await confirm({
      title: 'Archivar usuario',
      description: `Vas a archivar a "${selectedUser.displayName}" y sacarlo del panel operativo.`,
      impact: 'La cuenta quedará desactivada y no podrá iniciar sesión. Podrás restaurarla después y reactivarla cuando haga falta.',
      confirmLabel: 'Sí, archivar usuario',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });

    if (!accepted) {
      return;
    }

    setError(null);

    try {
      await archiveAppUser(selectedUser.uid);
      toast({
        tone: 'success',
        title: 'Usuario archivado',
        description: `"${selectedUser.displayName}" salió del panel principal y quedó desactivado.`,
      });
    } catch (archiveError: any) {
      setError(archiveError.message || 'No se pudo archivar el usuario.');
    }
  };

  const handleRestore = async (selectedUser: User) => {
    setError(null);

    try {
      await restoreAppUser(selectedUser.uid);
      toast({
        tone: 'success',
        title: 'Usuario restaurado',
        description: `"${selectedUser.displayName}" volvió al panel y quedó inactivo hasta reactivarlo.`,
      });
    } catch (restoreError: any) {
      setError(restoreError.message || 'No se pudo restaurar el usuario.');
    }
  };

  const handlePermanentDelete = async (selectedUser: User) => {
    if (currentUser?.uid === selectedUser.uid) {
      setError('No puedes borrar tu propia cuenta desde este panel.');
      return;
    }

    const accepted = await confirm({
      title: 'Borrado permanente',
      description: `Vas a borrar definitivamente a "${selectedUser.displayName}".`,
      impact: 'Esto elimina la cuenta en Firebase Auth y también su documento en Firestore. Solo úsalo después de archivar la cuenta.',
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
    });

    if (!accepted) {
      return;
    }

    const typedEmail = window.prompt(
      `Escribe el email exacto del usuario para confirmar el borrado permanente:\n${selectedUser.email}`,
    );

    if (typedEmail !== selectedUser.email) {
      toast({
        tone: 'warning',
        title: 'Borrado cancelado',
        description: 'El email no coincidió. No se eliminó nada.',
      });
      return;
    }

    setError(null);

    try {
      await permanentlyDeleteAppUser(selectedUser.uid);
      toast({
        tone: 'success',
        title: 'Usuario eliminado definitivamente',
        description: `"${selectedUser.displayName}" se borró de Auth y Firestore.`,
      });
    } catch (deleteError: any) {
      setError(deleteError.message || 'No se pudo borrar el usuario definitivamente.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Usuarios"
        description="Alta, edición y control de acceso para el equipo interno. Solo los administradores pueden ver y usar este panel."
      />

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[360px,1fr]">
        <section className="xl:sticky xl:top-8 xl:self-start">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-slate-900">Nuevo usuario</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Crea accesos sin salir de la app. La cuenta se registra en Firebase Auth y en la colección `users`.
            </p>

            <form onSubmit={handleCreate} className="mt-6 space-y-4">
              <div>
                <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-slate-700">
                  Nombre
                </label>
                <input
                  id="user-name"
                  type="text"
                  required
                  value={form.displayName}
                  onChange={(event) => handleCreateFieldChange('displayName', event.target.value)}
                  onBlur={() => setCreateTouched((current) => ({ ...current, displayName: true }))}
                  className={getInputClassName(Boolean(shouldShowCreateError('displayName')))}
                  placeholder="Nombre y apellido"
                  disabled={isCreating}
                />
                <FieldError message={shouldShowCreateError('displayName')} />
              </div>

              <div>
                <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  id="user-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => handleCreateFieldChange('email', event.target.value)}
                  onBlur={() => setCreateTouched((current) => ({ ...current, email: true }))}
                  className={getInputClassName(Boolean(shouldShowCreateError('email')))}
                  placeholder="persona@empresa.com"
                  disabled={isCreating}
                />
                <FieldError message={shouldShowCreateError('email')} />
              </div>

              <div>
                <label htmlFor="user-password" className="mb-1 block text-sm font-medium text-slate-700">
                  Contraseña inicial
                </label>
                <input
                  id="user-password"
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(event) => handleCreateFieldChange('password', event.target.value)}
                  onBlur={() => setCreateTouched((current) => ({ ...current, password: true }))}
                  className={getInputClassName(Boolean(shouldShowCreateError('password')))}
                  placeholder="Mínimo 8 caracteres"
                  disabled={isCreating}
                />
                <FieldError message={shouldShowCreateError('password')} />
              </div>

              <div>
                <label htmlFor="user-role" className="mb-1 block text-sm font-medium text-slate-700">
                  Rol
                </label>
                <select
                  id="user-role"
                  value={form.role}
                  onChange={(event) => handleCreateFieldChange('role', event.target.value as Role)}
                  className={getInputClassName(false)}
                  disabled={isCreating}
                >
                  {ROLE_VALUES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => handleCreateFieldChange('active', event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  disabled={isCreating}
                />
                Crear usuario activo
              </label>

              <button
                type="submit"
                disabled={
                  isCreating ||
                  !createFormIsValid
                }
                className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? 'Creando usuario...' : 'Crear usuario'}
              </button>

              {createSuccess ? (
                <p className="flex items-center justify-center gap-2 text-sm text-emerald-600">
                  <Check className="h-4 w-4" />
                  {createSuccess}
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <UsersIcon className="h-5 w-5 text-indigo-600" />
                  Equipo
                </h2>
                <p className="mt-1 text-sm text-slate-500">Administra roles, estado y datos básicos de acceso.</p>
                <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(event) => setShowArchived(event.target.checked)}
                  />
                  Mostrar archivados
                </label>
              </div>
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                {sortedUsers.length} usuarios
              </span>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : sortedUsers.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Todavía no hay usuarios"
                  description="Crea el primer acceso interno desde el panel lateral."
                  icon={<UsersIcon className="h-6 w-6" />}
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {sortedUsers.map((appUser) => {
                  const isExpanded = expandedId === appUser.uid;
                  const isEditing = editingUserId === appUser.uid && editForm;
                  const isSelf = currentUser?.uid === appUser.uid;

                  return (
                    <li key={appUser.uid} className="bg-white">
                      <div className="px-6 py-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : appUser.uid)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" />
                            ) : (
                              <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900">{appUser.displayName}</p>
                                <StatusPill active={appUser.active} />
                                {isArchivedCatalogEntity(appUser) ? (
                                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Archivado
                                  </span>
                                ) : null}
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {ROLE_LABELS[appUser.role]}
                                </span>
                                {isSelf ? (
                                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Tu cuenta
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 truncate text-sm text-slate-500">{appUser.email}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                Alta: {formatDate(appUser.createdAt)} · Actualizado: {formatDate(appUser.updatedAt)}
                              </p>
                            </div>
                          </button>

                          <div className="flex flex-wrap items-center gap-2">
                            {!isArchivedCatalogEntity(appUser) ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleQuickToggle(appUser)}
                                  disabled={isSelf}
                                  className={`rounded-xl px-3 py-2 text-xs font-medium ${
                                    appUser.active
                                      ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                      : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  {appUser.active ? 'Desactivar' : 'Activar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(appUser)}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleArchive(appUser)}
                                  disabled={isSelf}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Archivar
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRestore(appUser)}
                                disabled={isSelf}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Restaurar
                              </button>
                            )}
                            {isArchivedCatalogEntity(appUser) ? (
                              <button
                                type="button"
                                onClick={() => handlePermanentDelete(appUser)}
                                disabled={isSelf}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Borrar definitivo
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="mt-4 border-t border-slate-100 pt-4">
                            {isEditing && !isArchivedCatalogEntity(appUser) ? (
                              <form onSubmit={handleSaveEdit} className="grid gap-4 md:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
                                  <input
                                    type="text"
                                    required
                                    value={editForm.displayName}
                                    onChange={(event) =>
                                      setEditForm((current) => current
                                        ? { ...current, displayName: event.target.value }
                                        : current)
                                    }
                                    onBlur={() => setEditTouched((current) => ({ ...current, displayName: true }))}
                                    className={getInputClassName(Boolean(shouldShowEditError('displayName')))}
                                    disabled={isSavingEdit}
                                  />
                                  <FieldError message={shouldShowEditError('displayName')} />
                                </div>

                                <div>
                                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                                  <input
                                    type="email"
                                    required
                                    value={editForm.email}
                                    onChange={(event) =>
                                      setEditForm((current) => current
                                        ? { ...current, email: event.target.value }
                                        : current)
                                    }
                                    onBlur={() => setEditTouched((current) => ({ ...current, email: true }))}
                                    className={getInputClassName(Boolean(shouldShowEditError('email')))}
                                    disabled={isSavingEdit}
                                  />
                                  <FieldError message={shouldShowEditError('email')} />
                                </div>

                                <div>
                                  <label className="mb-1 block text-sm font-medium text-slate-700">Rol</label>
                                  <select
                                    value={editForm.role}
                                    onChange={(event) =>
                                      setEditForm((current) => current
                                        ? { ...current, role: event.target.value as Role }
                                        : current)
                                    }
                                    className={getInputClassName(false)}
                                    disabled={isSavingEdit || isSelf}
                                  >
                                    {ROLE_VALUES.map((role) => (
                                      <option key={role} value={role}>
                                        {ROLE_LABELS[role]}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-sm font-medium text-slate-700">
                                    Nueva contraseña
                                  </label>
                                  <input
                                    type="password"
                                    minLength={8}
                                    value={editForm.password}
                                    onChange={(event) =>
                                      setEditForm((current) => current
                                        ? { ...current, password: event.target.value }
                                        : current)
                                    }
                                    onBlur={() => setEditTouched((current) => ({ ...current, password: true }))}
                                    className={getInputClassName(Boolean(shouldShowEditError('password')))}
                                    placeholder="Opcional"
                                    disabled={isSavingEdit}
                                  />
                                  <FieldError message={shouldShowEditError('password')} />
                                </div>

                                <div className="md:col-span-2">
                                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={editForm.active}
                                      onChange={(event) =>
                                        setEditForm((current) => current
                                          ? { ...current, active: event.target.checked }
                                          : current)
                                      }
                                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                      disabled={isSavingEdit || isSelf}
                                    />
                                    Usuario activo
                                  </label>
                                  {isSelf ? (
                                    <p className="mt-2 text-xs text-amber-700">
                                      Tu rol admin y el estado activo de tu cuenta se protegen desde este panel.
                                    </p>
                                  ) : null}
                                </div>

                                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                                  <button
                                    type="submit"
                                    disabled={isSavingEdit || !editFormIsValid}
                                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                                  >
                                    {isSavingEdit ? 'Guardando...' : 'Guardar cambios'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    <X className="h-4 w-4" />
                                    Cancelar
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                  <span className="block text-xs uppercase tracking-wide text-slate-400">UID</span>
                                  <span className="mt-1 block break-all font-mono text-xs text-slate-600">{appUser.uid}</span>
                                </div>
                                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                  <span className="block text-xs uppercase tracking-wide text-slate-400">Último acceso</span>
                                  <span className="mt-1 block">{formatDate(appUser.lastLoginAt)}</span>
                                </div>
                                {!appUser.active ? (
                                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:col-span-2">
                                    <span className="block text-xs uppercase tracking-wide text-amber-700">Cuenta desactivada</span>
                                    <span className="mt-1 block text-sm text-amber-800">
                                      Esta cuenta ya no puede iniciar sesión. Si ya no la necesitas, puedes borrarla definitivamente con la confirmación reforzada.
                                    </span>
                                  </div>
                                ) : null}
                                {isArchivedCatalogEntity(appUser) ? (
                                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:col-span-2">
                                    <span className="block text-xs uppercase tracking-wide text-amber-700">Usuario archivado</span>
                                    <span className="mt-1 block text-sm text-amber-800">
                                      Está fuera del panel principal. Si lo restauras, volverá visible pero permanecerá inactivo hasta reactivarlo manualmente.
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
