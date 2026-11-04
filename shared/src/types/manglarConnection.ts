export interface ManglarConnectionRequest { requestId: string }
export interface ManglarConnectionDetails {
  application: 'ChatGPT';
  role?: import('./common').Role;
  unrestrictedClients?: boolean;
  clients: Array<{ id: string; name: string }>;
  scopes: string[];
  expiresAt: string;
}
export interface DecideManglarConnectionRequest extends ManglarConnectionRequest { approve: boolean; authorizationModel?: 'user-v1' }
export interface ManglarConnectionRedirect { redirectUrl: string }
export interface ManglarConnection {
  id: string;
  application: 'ChatGPT';
  createdAt: string;
  expiresAt: string;
  active: boolean;
}
