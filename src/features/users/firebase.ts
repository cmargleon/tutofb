import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { isActiveCatalogEntity, ROLE_VALUES } from '../../../shared/src/domain';
import {
  ArchiveAppUserRequest,
  ArchiveAppUserResponse,
  PermanentDeleteAppUserRequest,
  PermanentDeleteAppUserResponse,
  RestoreAppUserRequest,
  RestoreAppUserResponse,
  Role,
  User
} from '../../../shared/src/types';
import { db, functions } from '../../firebase';

export interface CreateAppUserInput {
  email: string;
  displayName: string;
  password: string;
  role: Role;
  active: boolean;
}

export interface UpdateAppUserInput {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  password?: string;
}

interface ManageAppUserResponse {
  success: boolean;
  user: User;
}

const isRoleValue = (value: string): value is Role => ROLE_VALUES.includes(value as Role);

interface SubscribeUsersOptions {
  includeArchived?: boolean;
}

export const subscribeToUsers = (
  callback: (users: User[]) => void,
  onError: (error: Error) => void,
  options: SubscribeUsersOptions = {},
) => {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const users = snapshot.docs
        .map((document) => ({ ...document.data(), uid: document.id } as User))
        .filter((user) => typeof user.email === 'string' && isRoleValue(user.role))
        .filter((user) => options.includeArchived ? true : isActiveCatalogEntity(user));

      callback(users);
    },
    onError,
  );
};

export const createAppUser = async (input: CreateAppUserInput) => {
  const callable = httpsCallable<CreateAppUserInput, ManageAppUserResponse>(functions, 'createAppUser');
  const result = await callable(input);
  return result.data.user;
};

export const updateAppUser = async (input: UpdateAppUserInput) => {
  const callable = httpsCallable<UpdateAppUserInput, ManageAppUserResponse>(functions, 'updateAppUser');
  const result = await callable(input);
  return result.data.user;
};

export const archiveAppUser = async (uid: string) => {
  const callable = httpsCallable<ArchiveAppUserRequest, ArchiveAppUserResponse>(functions, 'archiveAppUser');
  const result = await callable({ uid });
  return result.data;
};

export const restoreAppUser = async (uid: string) => {
  const callable = httpsCallable<RestoreAppUserRequest, RestoreAppUserResponse>(functions, 'restoreAppUser');
  const result = await callable({ uid });
  return result.data;
};

export const permanentlyDeleteAppUser = async (uid: string) => {
  const callable = httpsCallable<PermanentDeleteAppUserRequest, PermanentDeleteAppUserResponse>(
    functions,
    'permanentlyDeleteAppUser',
  );
  const result = await callable({ uid });
  return result.data;
};
