import React from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import { Role } from '../../shared/src/types';
import { Alert, Badge, buttonClasses, CardHeader, EmptyState, FilterBar, INPUT_CLASS, LoadingBlock, Page, PageHeader, Pagination, SearchInput, Surface } from '../components/ui';
import { useUserManagement } from '../features/users/useUserManagement';
import { UserCreateForm } from '../components/users/UserCreateForm';
import { UserListItem } from '../components/users/UserListItem';
import { useAuth } from '../features/auth/AuthProvider';

interface UsersProps {
  view: 'create' | 'list';
}


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
    <Page>
      <PageHeader
        title="Usuarios"
        description={
          isCreateView
            ? 'Crea accesos internos y define rol, contraseña inicial y estado de activación.'
            : 'Administra roles, estado, archivo y mantenimiento de los accesos internos.'
        }
        icon={UsersIcon}
        actions={isCreateView
          ? <Link to="/users/lista" className={buttonClasses('secondary')}>Ver usuarios</Link>
          : <Link to="/users/crear" className={buttonClasses('primary')}><UserPlus aria-hidden="true" />Crear usuario</Link>}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

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
        <section aria-label="Lista de usuarios">
          <Surface className="overflow-hidden">
            <CardHeader title="Equipo" description="Roles, estado y datos básicos de acceso." actions={<Badge tone="accent">{filteredUsers.length} usuarios</Badge>} />
            <FilterBar>
              <label className="min-w-56 flex-1"><span className="sr-only">Buscar por nombre o email</span>
                <SearchInput
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setUsersPage(1); }}
                  placeholder="Buscar por nombre o email…"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><span>Rol</span>
                <select
                  value={roleFilter}
                  onChange={(e) => { setRoleFilter(e.target.value as Role | 'all'); setUsersPage(1); }}
                  className={`${INPUT_CLASS} w-auto min-w-40`}
                >
                  <option value="all">Todos los roles</option>
                  <option value="admin">Admin</option>
                  <option value="operador">Operador</option>
                  <option value="revisor">Revisor</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><span>Estado</span>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'active' | 'archived'); setUsersPage(1); }}
                  className={`${INPUT_CLASS} w-auto min-w-40`}
                >
                  <option value="active">Solo activos</option>
                  <option value="all">Todos</option>
                  <option value="archived">Solo archivados</option>
                </select>
              </label>
            </FilterBar>

            {loading ? (
              <LoadingBlock />
            ) : filteredUsers.length === 0 ? (
              <div>
                <EmptyState
                  title="Todavía no hay usuarios"
                  description="Todavía no hay usuarios cargados. Usa la vista Crear para dar de alta el primero."
                  icon={<UsersIcon />}
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
              <Pagination page={usersPage} hasMore={usersPage < usersTotalPages} loading={false} onPageChange={setUsersPage}>
                Página {usersPage} de {usersTotalPages}
              </Pagination>
            )}
          </Surface>
        </section>
      )}
    </Page>
  );
};
