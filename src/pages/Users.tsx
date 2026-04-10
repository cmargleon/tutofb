import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Users as UsersIcon } from 'lucide-react';
import { Role } from '../../shared/src/types';
import { EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import { useUserManagement } from '../features/users/useUserManagement';
import { UserCreateForm } from '../components/users/UserCreateForm';
import { UserListItem } from '../components/users/UserListItem';
import { useAuth } from '../features/auth/AuthProvider';

interface UsersProps {
  view: 'create' | 'list';
}

const USER_SECTIONS = [
  { label: 'Crear', path: '/users/crear' },
  { label: 'Lista de Usuarios', path: '/users/lista' },
] as const;

export const Users: React.FC<UsersProps> = ({ view }) => {
  const { user: currentUser } = useAuth();
  const {
    loading, error,
    form, createTouched, setCreateTouched, isCreating, createSuccess,
    createFormIsValid, shouldShowCreateError,
    expandedId, setExpandedId, editingUserId,
    editForm, setEditForm, editTouched, setEditTouched,
    isSavingEdit, editFormIsValid, shouldShowEditError,
    searchQuery, setSearchQuery,
    roleFilter, setRoleFilter,
    statusFilter, setStatusFilter,
    usersPage, setUsersPage,
    pagedUsers, filteredUsers, usersTotalPages,
    handleCreateFieldChange, handleCreate, handleStartEdit, handleCancelEdit,
    handleSaveEdit, handleQuickToggle, handleArchive, handleRestore, handlePermanentDelete,
  } = useUserManagement();
  const isCreateView = view === 'create';

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Usuarios"
        description={
          isCreateView
            ? 'Crea accesos internos y define rol, contraseña inicial y estado de activación.'
            : 'Administra roles, estado, archivo y mantenimiento de los accesos internos.'
        }
        icon={UsersIcon}
      />

      <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {USER_SECTIONS.map((section) => (
          <NavLink
            key={section.path}
            to={section.path}
            className={({ isActive }) =>
              `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            {section.label}
          </NavLink>
        ))}
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {isCreateView ? (
        <section className="max-w-xl">
          <UserCreateForm
            isOpen
            onToggle={() => undefined}
            collapsible={false}
            form={form}
            isCreating={isCreating}
            createSuccess={createSuccess}
            createFormIsValid={createFormIsValid}
            createTouched={createTouched}
            setCreateTouched={setCreateTouched}
            shouldShowCreateError={shouldShowCreateError}
            onFieldChange={handleCreateFieldChange}
            onSubmit={handleCreate}
          />
        </section>
      ) : (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <UsersIcon className="h-5 w-5 text-indigo-600" />
                    Equipo
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Administra roles, estado y datos básicos de acceso.</p>
                </div>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                  {filteredUsers.length} usuarios
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setUsersPage(1); }}
                  placeholder="Buscar por nombre o email..."
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 shadow-sm transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:flex-1"
                />
                <select
                  value={roleFilter}
                  onChange={(e) => { setRoleFilter(e.target.value as Role | 'all'); setUsersPage(1); }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">Todos los roles</option>
                  <option value="admin">Admin</option>
                  <option value="operador">Operador</option>
                  <option value="revisor">Revisor</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'active' | 'archived'); setUsersPage(1); }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="active">Solo activos</option>
                  <option value="all">Todos</option>
                  <option value="archived">Solo archivados</option>
                </select>
              </div>
            </div>

            {loading ? (
              <LoadingBlock />
            ) : filteredUsers.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Todavía no hay usuarios"
                  description="Todavía no hay usuarios cargados. Usa la vista Crear para dar de alta el primero."
                  icon={<UsersIcon className="h-6 w-6" />}
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pagedUsers.map((appUser) => (
                  <UserListItem
                    key={appUser.uid}
                    appUser={appUser}
                    isExpanded={expandedId === appUser.uid}
                    isEditing={editingUserId === appUser.uid}
                    isSelf={currentUser?.uid === appUser.uid}
                    editForm={editForm}
                    editTouched={editTouched}
                    setEditTouched={setEditTouched}
                    isSavingEdit={isSavingEdit}
                    editFormIsValid={editFormIsValid}
                    shouldShowEditError={shouldShowEditError}
                    setEditForm={setEditForm}
                    onToggleExpand={() => setExpandedId(expandedId === appUser.uid ? null : appUser.uid)}
                    onStartEdit={handleStartEdit}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={handleSaveEdit}
                    onQuickToggle={handleQuickToggle}
                    onArchive={handleArchive}
                    onRestore={handleRestore}
                    onPermanentDelete={handlePermanentDelete}
                  />
                ))}
              </ul>
            )}

            {usersTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                  disabled={usersPage === 1}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <span className="text-sm text-slate-500">
                  Página {usersPage} de {usersTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setUsersPage((p) => Math.min(usersTotalPages, p + 1))}
                  disabled={usersPage === usersTotalPages}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
