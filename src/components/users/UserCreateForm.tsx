import React from 'react';
import { Check, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { Role } from '../../../shared/src/types';
import { ROLE_VALUES } from '../../../shared/src/domain';
import { CreateAppUserInput } from '../../features/users/firebase';
import {
  CreateFieldName,
  FieldTouched,
  getInputClassName,
  ROLE_LABELS,
} from '../../features/users/userValidation';

interface FieldErrorProps { message?: string | null }
const FieldError: React.FC<FieldErrorProps> = ({ message }) =>
  message ? <p className="mt-1 text-xs text-rose-600">{message}</p> : null;

interface UserCreateFormProps {
  isOpen: boolean;
  onToggle: () => void;
  form: CreateAppUserInput;
  isCreating: boolean;
  createSuccess: string | null;
  createFormIsValid: boolean;
  createTouched: FieldTouched<CreateFieldName>;
  setCreateTouched: React.Dispatch<React.SetStateAction<FieldTouched<CreateFieldName>>>;
  shouldShowCreateError: (field: CreateFieldName) => string | null | undefined;
  onFieldChange: (field: keyof CreateAppUserInput, value: string | boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export const UserCreateForm: React.FC<UserCreateFormProps> = ({
  isOpen,
  onToggle,
  form,
  isCreating,
  createSuccess,
  createFormIsValid,
  createTouched: _createTouched,
  setCreateTouched,
  shouldShowCreateError,
  onFieldChange,
  onSubmit,
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between p-6 text-left"
    >
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-slate-900">Nuevo usuario</h2>
      </div>
      {isOpen ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
    </button>

    {isOpen && (
      <div className="border-t border-slate-100 px-6 pb-6 pt-4">
        <p className="mb-4 text-sm text-slate-500">
          Crea accesos sin salir de la app. El usuario podrá iniciar sesión de inmediato con la contraseña temporal.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
            <input
              id="user-name"
              type="text"
              required
              value={form.displayName}
              onChange={(e) => onFieldChange('displayName', e.target.value)}
              onBlur={() => setCreateTouched((c) => ({ ...c, displayName: true }))}
              className={getInputClassName(Boolean(shouldShowCreateError('displayName')))}
              placeholder="Nombre y apellido"
              disabled={isCreating}
            />
            <FieldError message={shouldShowCreateError('displayName')} />
          </div>

          <div>
            <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              id="user-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => onFieldChange('email', e.target.value)}
              onBlur={() => setCreateTouched((c) => ({ ...c, email: true }))}
              className={getInputClassName(Boolean(shouldShowCreateError('email')))}
              placeholder="persona@empresa.com"
              disabled={isCreating}
            />
            <FieldError message={shouldShowCreateError('email')} />
          </div>

          <div>
            <label htmlFor="user-password" className="mb-1 block text-sm font-medium text-slate-700">Contraseña inicial</label>
            <input
              id="user-password"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => onFieldChange('password', e.target.value)}
              onBlur={() => setCreateTouched((c) => ({ ...c, password: true }))}
              className={getInputClassName(Boolean(shouldShowCreateError('password')))}
              placeholder="Mínimo 8 caracteres"
              disabled={isCreating}
            />
            <FieldError message={shouldShowCreateError('password')} />
          </div>

          <div>
            <label htmlFor="user-role" className="mb-1 block text-sm font-medium text-slate-700">Rol</label>
            <select
              id="user-role"
              value={form.role}
              onChange={(e) => onFieldChange('role', e.target.value as Role)}
              className={getInputClassName(false)}
              disabled={isCreating}
            >
              {ROLE_VALUES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => onFieldChange('active', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              disabled={isCreating}
            />
            Crear usuario activo
          </label>

          <button
            type="submit"
            disabled={isCreating || !createFormIsValid}
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
    )}
  </div>
);
