import React, { useEffect, useRef } from 'react';
import { Mail } from 'lucide-react';
import { MANGLAR_EMAIL_SENDER } from '../../../shared/src/email';
import { useGmailSettings } from '../../features/email/useGmailSettings';
import { Alert, Badge, Button, Card, CardBody, CardHeader, LoadingBlock } from '../ui';

export const GmailSettings = () => {
  const state = useGmailSettings();
  const section = useRef<HTMLElement>(null);
  useEffect(() => { if (window.location.hash === '#correo') section.current?.scrollIntoView(); }, []);
  if (!state.isAdmin) return null;
  return <section id="correo" ref={section} aria-label="Correo de Manglar" className="scroll-mt-6">
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader title="Correo de Manglar" description="Conecta una sola vez el buzón que usará toda la app. Después podrás enviar mensajes desde la ficha de cualquier cliente." />
      <CardBody className="space-y-4">
        {state.result === 'connected' && <Alert tone="success">Buzón de Manglar conectado para todos los clientes.</Alert>}
        {state.result === 'error' && <Alert tone="warning">No se completó la conexión. Vuelve a conectar y elige {MANGLAR_EMAIL_SENDER}, aceptando el permiso de envío.</Alert>}
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {state.loading ? <LoadingBlock message="Cargando correo de Manglar…" /> : <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><Mail className="h-5 w-5 text-slate-500" aria-hidden="true" /><div><p className="font-medium break-all">{MANGLAR_EMAIL_SENDER}</p><Badge tone={state.connection?.connected ? 'success' : 'neutral'}>{state.connection?.connected ? 'Conectado' : 'Pendiente de conectar'}</Badge></div></div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" loading={state.busy} onClick={() => void state.connect()}>{state.connection?.connected ? 'Volver a conectar' : 'Conectar con Google'}</Button>
            {state.connection?.connected && <Button variant="ghost" disabled={state.busy} onClick={() => void state.disconnect()}>Desconectar</Button>}</div>
        </div>}
      </CardBody>
    </Card>
  </section>;
};
