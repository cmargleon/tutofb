import { useCallback, useEffect, useState } from 'react';
import type { ManglarConnection, ManglarConnectionDetails } from '../../../shared/src/types';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { decideManglarConnection, getManglarConnectionRequest, listManglarConnections, revokeManglarConnection } from './manglarConnection.firebase';

export const useManglarConnection = (requestId: string | null, enabled: boolean) => {
  const toast = useToast(); const confirm = useConfirm();
  const [details, setDetails] = useState<ManglarConnectionDetails | null>(null);
  const [connections, setConnections] = useState<ManglarConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError(''); setDetails(null);
    Promise.all([requestId ? getManglarConnectionRequest({ requestId }) : Promise.resolve(null), listManglarConnections()])
      .then(([request, current]) => { if (!cancelled) { setDetails(request); setConnections(current); } })
      .catch((failure: Error) => { if (!cancelled) setError(failure.message || 'No se pudo consultar la conexión.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId, enabled]);
  const decide = useCallback(async (approve: boolean) => {
    if (!requestId || busy) return;
    setBusy(true);
    try {
      const { redirectUrl } = await decideManglarConnection({ requestId, approve });
      if (!/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{1,200})\?/.test(redirectUrl)) throw new Error('La dirección de regreso a ChatGPT no es válida.');
      window.location.assign(redirectUrl);
    } catch (failure) {
      toast({ title: 'No se pudo conectar', description: failure instanceof Error ? failure.message : 'Inténtalo de nuevo desde ChatGPT.', tone: 'error' });
      setBusy(false);
    }
  }, [requestId, busy, toast]);
  const revoke = useCallback(async (id: string) => {
    if (busy || !await confirm({ title: 'Revocar conexión con ChatGPT', description: 'ChatGPT dejará de consultar clientes y enviar pedidos mediante esta conexión.', confirmLabel: 'Revocar conexión', tone: 'danger' })) return;
    setBusy(true);
    try {
      await revokeManglarConnection(id);
      setConnections((current) => current.map((entry) => entry.id === id ? { ...entry, active: false } : entry));
      toast({ title: 'Conexión revocada', tone: 'success' });
    } catch (failure) { toast({ title: 'No se pudo revocar', description: failure instanceof Error ? failure.message : 'Inténtalo de nuevo.', tone: 'error' }); }
    finally { setBusy(false); }
  }, [busy, confirm, toast]);
  return { details, connections, loading, busy, error, decide, revoke };
};
