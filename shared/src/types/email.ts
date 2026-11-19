export interface GmailConnectionStatus {
  sender: string;
  connected: boolean;
}

export type StartGmailConnectionRequest = Record<string, never>;
export interface StartGmailConnectionResponse { url: string }
export interface SendClientEmailRequest {
  clientId: string;
  requestId: string;
  to: string;
  subject: string;
  body: string;
}
export type ClientEmailStatus = 'sending' | 'sent' | 'failed' | 'unknown';
export interface ClientEmailReceipt {
  id: string;
  to: string;
  subject: string;
  status: ClientEmailStatus;
  createdAt: string;
}
export interface ListClientEmailsRequest { clientId: string }
export interface ListClientEmailsResponse { messages: ClientEmailReceipt[] }
