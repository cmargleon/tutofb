import { httpsCallable } from 'firebase/functions';
import type { DecideManglarConnectionRequest, ManglarConnection, ManglarConnectionDetails, ManglarConnectionRedirect, ManglarConnectionRequest } from '../../../shared/src/types';
import { functions } from '../../firebase';

export const getManglarConnectionRequest = async (data: ManglarConnectionRequest) =>
  (await httpsCallable<ManglarConnectionRequest, ManglarConnectionDetails>(functions, 'getManglarConnectionRequest')(data)).data;
export const decideManglarConnection = async (data: DecideManglarConnectionRequest) =>
  (await httpsCallable<DecideManglarConnectionRequest, ManglarConnectionRedirect>(functions, 'decideManglarConnection')(data)).data;
export const listManglarConnections = async () =>
  (await httpsCallable<Record<string, never>, { connections: ManglarConnection[] }>(functions, 'listManglarConnections')({})).data.connections;
export const revokeManglarConnection = async (connectionId: string) =>
  (await httpsCallable<{ connectionId: string }, { revoked: true }>(functions, 'revokeManglarConnection')({ connectionId })).data;
