import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { isRole } from '../../../shared/src/domain';
import { Role, User } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

export interface SanitizedUserInput {
  uid?: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  password?: string;
}

export interface SanitizedUpdateUserInput extends Omit<SanitizedUserInput, 'uid'> {
  uid: string;
}

export const loadUserDoc = async (uid: string): Promise<User | null> => {
  const snapshot = await getAppFirestore().collection('users').doc(uid).get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data() as User;
};

const normalizeEmail = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Debes indicar un email válido.');
  }

  const email = value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'Debes indicar un email válido.');
  }

  return email;
};

const normalizeDisplayName = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Debes indicar el nombre del usuario.');
  }

  const displayName = value.trim();
  if (!displayName) {
    throw new HttpsError('invalid-argument', 'Debes indicar el nombre del usuario.');
  }

  return displayName;
};

const normalizeRole = (value: unknown): Role => {
  if (!isRole(value)) {
    throw new HttpsError('invalid-argument', 'El rol indicado no es válido.');
  }

  return value;
};

const normalizeActive = (value: unknown): boolean => {
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Debes indicar si el usuario estará activo.');
  }

  return value;
};

const normalizePassword = (value: unknown, required: boolean): string | undefined => {
  if (value == null || value === '') {
    if (required) {
      throw new HttpsError('invalid-argument', 'Debes indicar una contraseña inicial.');
    }

    return undefined;
  }

  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'La contraseña no es válida.');
  }

  const password = value.trim();
  if (password.length < 8) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
  }

  return password;
};

export const sanitizeCreateUserInput = (data: unknown): SanitizedUserInput => {
  const payload = (data || {}) as Record<string, unknown>;

  return {
    email: normalizeEmail(payload.email),
    displayName: normalizeDisplayName(payload.displayName),
    password: normalizePassword(payload.password, true),
    role: normalizeRole(payload.role),
    active: normalizeActive(payload.active),
  };
};

export const sanitizeUpdateUserInput = (data: unknown): SanitizedUpdateUserInput => {
  const payload = (data || {}) as Record<string, unknown>;
  const uid = typeof payload.uid === 'string' ? payload.uid.trim() : '';

  if (!uid) {
    throw new HttpsError('invalid-argument', 'Debes indicar el usuario a actualizar.');
  }

  return {
    uid,
    email: normalizeEmail(payload.email),
    displayName: normalizeDisplayName(payload.displayName),
    password: normalizePassword(payload.password, false),
    role: normalizeRole(payload.role),
    active: normalizeActive(payload.active),
  };
};

export const applyUserClaims = async (uid: string, user: Pick<User, 'role' | 'active'>) => {
  await admin.auth().setCustomUserClaims(uid, {
    role: user.role,
    active: user.active,
  });
};

export const upsertUserDoc = async ({
  uid,
  email,
  displayName,
  role,
  active,
  existingUser,
}: {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  existingUser: User | null;
}) => {
  const payload: Partial<User> & {
    uid: string;
    email: string;
    displayName: string;
    role: Role;
    active: boolean;
    updatedAt: admin.firestore.FieldValue;
  } = {
    uid,
    email,
    displayName,
    role,
    active,
    status: existingUser?.status ?? 'active',
    archivedAt: existingUser?.archivedAt ?? null,
    archivedByUid: existingUser?.archivedByUid ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!existingUser) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.lastLoginAt = null;
  }

  await getAppFirestore().collection('users').doc(uid).set(payload, { merge: true });
};

export const buildUserResponse = async (uid: string): Promise<User> => {
  const user = await loadUserDoc(uid);
  if (!user) {
    throw new HttpsError('internal', 'No se pudo cargar el usuario actualizado.');
  }

  return user;
};
