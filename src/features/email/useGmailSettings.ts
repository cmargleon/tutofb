import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GmailConnectionStatus } from '../../../shared/src/types';
import { useRole } from '../auth/AuthProvider';
import { useConfirm } from '../feedback/FeedbackProvider';
import * as api from './firebase';

export function useGmailSettings() {
  const { isAdmin } = useRole();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [result] = useState(params.get('gmail'));
  const [connection, setConnection] = useState<GmailConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  useEffect(() => {
    if (!params.has('gmail')) return;
    setParams(current => { const next = new URLSearchParams(current); next.delete('gmail'); return next; }, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    let current = true;
    if (!isAdmin) { setLoading(false); return; }
    void api.getGmailConnection().then(status => { if (current) setConnection(status); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'No se pudo cargar el buzón.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [isAdmin]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const connect = () => run(async () => {
    const { url } = await api.startGmailConnection();
    window.location.assign(url);
  });
  const disconnect = async () => {
    if (!await confirm({ title: 'Desconectar el buzón de Manglar', description: 'Se detendrán los nuevos envíos desde la app para todos los clientes. Los correos ya enviados se conservan.', confirmLabel: 'Desconectar', tone: 'warning' })) return;
    await run(async () => { await api.disconnectGmail(); setConnection(await api.getGmailConnection()); });
  };
  return { isAdmin, connection, loading, busy, error, result, connect, disconnect };
}
