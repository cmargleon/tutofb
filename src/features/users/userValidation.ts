import { Role } from '../../../shared/src/types';
import { CreateAppUserInput } from './firebase';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  operador: 'Operador',
  revisor: 'Revisor',
};

export const INITIAL_CREATE_FORM: CreateAppUserInput = {
  email: '',
  displayName: '',
  password: '',
  role: 'operador',
  active: true,
};

export interface EditFormState {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  password: string;
}

export const buildEditFormState = (user: { uid: string; email: string; displayName: string; role: Role; active: boolean }): EditFormState => ({
  uid: user.uid,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  active: user.active,
  password: '',
});

export type CreateFieldName = 'displayName' | 'email' | 'password';
export type EditFieldName = 'displayName' | 'email' | 'password';
export type FieldErrors<T extends string> = Partial<Record<T, string>>;
export type FieldTouched<T extends string> = Partial<Record<T, boolean>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateDisplayName = (value: string): string | null => {
  const normalized = value.trim();
  if (!normalized) return 'El nombre es obligatorio.';
  if (normalized.length < 3) return 'El nombre debe tener al menos 3 caracteres.';
  return null;
};

export const validateEmail = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'El email es obligatorio.';
  if (!EMAIL_REGEX.test(normalized)) return 'Ingresa un email válido.';
  return null;
};

export const validatePassword = (value: string, required: boolean): string | null => {
  const normalized = value.trim();
  if (!normalized) return required ? 'La contraseña es obligatoria.' : null;
  if (normalized.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  return null;
};

export const getInputClassName = (hasError: boolean) =>
  `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-rose-300 bg-rose-50/40 text-rose-900 focus:border-rose-500 focus:ring-rose-500'
      : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500'
  }`;

export const formatUserDate = (timestamp: unknown) => {
  if (!timestamp) return 'Sin fecha';
  const date = typeof (timestamp as { toDate?: () => Date }).toDate === 'function'
    ? (timestamp as { toDate: () => Date }).toDate()
    : new Date(timestamp as string | number | Date);

  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
