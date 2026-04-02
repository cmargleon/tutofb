import React from 'react';
import { ChevronDown, ChevronUp, Edit2, Trash2, X } from 'lucide-react';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { ROLE_VALUES } from '../../../shared/src/domain';
import { Role, User } from '../../../shared/src/types';
import {
  EditFieldName,
  EditFormState,
  FieldTouched,
  formatUserDate,
  getInputClassName,
  ROLE_LABELS,
} from '../../features/users/userValidation';

interface FieldErrorProps { message?: string | null }
const FieldError: React.FC<FieldErrorProps> = ({ message }) =>
  message ? <p className="mt-1 text-xs text-rose-600">{message}</p> : null;

const StatusPill: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
    {active ? 'Activo' : 'Inactivo'}
  </span>
);

interface UserListItemProps {
  appUser: User;
  isExpanded: boolean;
  isEditing: boolean;
  isSelf: boolean;
  editForm: EditFormState | null;
  editTouched: FieldTouched<EditFieldName>;
  setEditTouched: React.Dispatch<React.SetStateAction<FieldTouched<EditFieldName>>>;
  isSavingEdit: boolean;
  editFormIsValid: boolean;
  shouldShowEditError: (field: EditFieldName) => string | null | undefined;
  setEditForm: React.Dispatch<React.SetStateAction<EditFormState | null>>;
  onToggleExpand: () => void;
  onStartEdit: (user: User) => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: React.FormEvent) => void;
  onQuickToggle: (user: User) => void;
  onArchive: (user: User) => void;
  onRestore: (user: User) => void;
  onPermanentDelete: (user: User) => void;
}

export const UserListItem: React.FC<UserListItemProps> = ({
  appUser, isExpanded, isEditing, isSelf,
  editForm, editTouched: _editTouched, setEditTouched, isSavingEdit, editFormIsValid,
  shouldShowEditError, setEditForm,
  onToggleExpand, onStartEdit, onCancelEdit, onSaveEdit,
  onQuickToggle, onArchive, onRestore, onPermanentDelete,
}) => (
  <li className="bg-white">
    <div className="px-6 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {isExpanded ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">{appUser.displayName}</p>
              <StatusPill active={appUser.active} />
              {isArchivedCatalogEntity(appUser) ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Archivado</span>
              ) : null}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{ROLE_LABELS[appUser.role]}</span>
              {isSelf ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">Tu cuenta</span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm text-slate-500">{appUser.email}</p>
            <p className="mt-1 text-xs text-slate-400">
              Alta: {formatUserDate(appUser.createdAt)} · Actualizado: {formatUserDate(appUser.updatedAt)}
            </p>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {!isArchivedCatalogEntity(appUser) ? (
            <>
              <button
                type="button"
                onClick={() => onQuickToggle(appUser)}
                disabled={isSelf}
                className={`rounded-xl px-3 py-2 text-xs font-medium ${appUser.active ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {appUser.active ? 'Desactivar' : 'Activar'}
              </button>
              <button
                type="button"
                onClick={() => onStartEdit(appUser)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Editar
              </button>
              <button
                type="button"
                onClick={() => onArchive(appUser)}
                disabled={isSelf}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Archivar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onRestore(appUser)}
              disabled={isSelf}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Restaurar
            </button>
          )}
          {isArchivedCatalogEntity(appUser) ? (
            <button
              type="button"
              onClick={() => onPermanentDelete(appUser)}
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
          {isEditing && editForm && !isArchivedCatalogEntity(appUser) ? (
            <form onSubmit={onSaveEdit} className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
                <input
                  type="text"
                  required
                  value={editForm.displayName}
                  onChange={(e) => setEditForm((c) => c ? { ...c, displayName: e.target.value } : c)}
                  onBlur={() => setEditTouched((c) => ({ ...c, displayName: true }))}
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
                  onChange={(e) => setEditForm((c) => c ? { ...c, email: e.target.value } : c)}
                  onBlur={() => setEditTouched((c) => ({ ...c, email: true }))}
                  className={getInputClassName(Boolean(shouldShowEditError('email')))}
                  disabled={isSavingEdit}
                />
                <FieldError message={shouldShowEditError('email')} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Rol</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm((c) => c ? { ...c, role: e.target.value as Role } : c)}
                  className={getInputClassName(false)}
                  disabled={isSavingEdit || isSelf}
                >
                  {ROLE_VALUES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nueva contraseña</label>
                <input
                  type="password"
                  minLength={8}
                  value={editForm.password}
                  onChange={(e) => setEditForm((c) => c ? { ...c, password: e.target.value } : c)}
                  onBlur={() => setEditTouched((c) => ({ ...c, password: true }))}
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
                    onChange={(e) => setEditForm((c) => c ? { ...c, active: e.target.checked } : c)}
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
                  onClick={onCancelEdit}
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
                <span className="mt-1 block">{formatUserDate(appUser.lastLoginAt)}</span>
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
