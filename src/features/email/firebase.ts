import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import type { GmailConnectionStatus, StartGmailConnectionRequest, StartGmailConnectionResponse, SendClientEmailRequest, ClientEmailReceipt, ListClientEmailsRequest, ListClientEmailsResponse } from '../../../shared/src/types';

export const getGmailConnection = async () => (await httpsCallable<Record<string, never>, GmailConnectionStatus>(functions, 'getGmailConnection')({})).data;
export const startGmailConnection = async () => (await httpsCallable<StartGmailConnectionRequest, StartGmailConnectionResponse>(functions, 'startGmailConnection')({})).data;
export const disconnectGmail = async () => (await httpsCallable<Record<string, never>, { disconnected: true }>(functions, 'disconnectGmail')({})).data;
export const sendClientEmail = async (input: SendClientEmailRequest) => (await httpsCallable<SendClientEmailRequest, ClientEmailReceipt>(functions, 'sendClientEmail', { timeout: 75000 })(input)).data;
export const listClientEmails = async (clientId: string) => (await httpsCallable<ListClientEmailsRequest, ListClientEmailsResponse>(functions, 'listClientEmails')({ clientId })).data;
