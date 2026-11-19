import { useCallback, useEffect, useRef, useState } from 'react';
import type { Client, ClientEmailReceipt, GmailConnectionStatus, SendClientEmailRequest } from '../../../shared/src/types';
import { useAuth, useRole } from '../auth/AuthProvider';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import * as api from './firebase';

const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
export function useClientEmail(client: Client) {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const toast = useToast(); const confirm = useConfirm();
  const [connection, setConnection] = useState<GmailConnectionStatus | null>(null);
  const [history, setHistory] = useState<ClientEmailReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [to, setTo] = useState(client.contacts?.[0]?.email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [review, setReview] = useState(false);
  const [receipt, setReceipt] = useState<ClientEmailReceipt | null>(null);
  const [pending, setPending] = useState<SendClientEmailRequest | null>(null);
  const key = `manglar-email-pending:${user?.uid}:${client.id}`;
  // Preserve the exact idempotency key across reloads after an uncertain network response.
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(key);
      if (value) {
        const input = JSON.parse(value) as SendClientEmailRequest;
        if (input.clientId === client.id && typeof input.requestId === 'string' && typeof input.to === 'string' && typeof input.subject === 'string' && typeof input.body === 'string') {
          setPending(input); setTo(input.to); setSubject(input.subject); setBody(input.body); setReview(true);
        }
      }
    } catch { /* A blocked browser storage does not prevent a manual send. */ }
  }, [key, client.id]);
  const refresh = useCallback(async () => {
    const [status, list] = await Promise.all([api.getGmailConnection(), api.listClientEmails(client.id!)]);
    setConnection(status); setHistory(list.messages);
  }, [client.id]);
  useEffect(() => {
    let current = true;
    if (!isAdmin) { setLoading(false); return; }
    void Promise.all([api.getGmailConnection(), api.listClientEmails(client.id!)]).then(([status, list]) => {
      if (current) { setConnection(status); setHistory(list.messages); }
    }).catch(reason => { if (current) setError(message(reason)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client.id, isAdmin]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(message(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const send = () => run(async () => {
    const input = pending || { clientId: client.id!, requestId: crypto.randomUUID(), to, subject, body };
    setPending(input);
    try { sessionStorage.setItem(key, JSON.stringify(input)); } catch { /* Optional recovery. */ }
    const result = await api.sendClientEmail(input);
    setReceipt(result);
    if (result.status === 'sent') toast({ title: 'Correo enviado', description: `Enviado a ${result.to}`, tone: 'success' });
    await refresh();
  });
  const newMessage = async () => {
    if (pending && receipt?.status !== 'sent' && receipt?.status !== 'failed' && !await confirm({
      title: 'Revisa Enviados antes de continuar', description: 'El envío anterior podría haberse completado. Confirma que revisaste el buzón de Manglar para evitar enviar el mismo mensaje dos veces.',
      confirmLabel: 'Ya revisé, escribir otro', tone: 'warning',
    })) return;
    try { sessionStorage.removeItem(key); } catch { /* Optional recovery. */ }
    setPending(null); setReceipt(null); setReview(false); setSubject(''); setBody(''); setError('');
  };
  return { isAdmin, connection, history, loading, busy, error, to, setTo, subject, setSubject, body, setBody,
    review, setReview, receipt, pending, send, newMessage, refresh: () => run(refresh) };
}
