export interface ManglarConnectionRequest { requestId: string }
export interface ManglarConnectionDetails {
  application: 'ChatGPT';
  clients: Array<{ id: string; name: string }>;
  scopes: string[];
  expiresAt: string;
}
export interface DecideManglarConnectionRequest extends ManglarConnectionRequest { approve: boolean }
export interface ManglarConnectionRedirect { redirectUrl: string }
export interface ManglarConnection {
  id: string;
  application: 'ChatGPT';
  createdAt: string;
  expiresAt: string;
  active: boolean;
}
