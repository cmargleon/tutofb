import React from 'react';
import { Link } from 'react-router-dom';
import { Send, RefreshCw } from 'lucide-react';
import type { Client, ClientEmailStatus } from '../../../shared/src/types';
import { MANGLAR_EMAIL_SENDER, MAX_EMAIL_BODY_LENGTH, MAX_EMAIL_SUBJECT_LENGTH } from '../../../shared/src/email';
import { useClientEmail } from '../../features/email/useClientEmail';
import { Alert, Badge, Button, Card, CardBody, CardHeader, INPUT_CLASS, LoadingBlock, buttonClasses } from '../ui';

const STATUS: Record<ClientEmailStatus, string> = { sending: 'En proceso · revisa Enviados', sent: 'Enviado', failed: 'No enviado', unknown: 'Sin confirmar · revisa Enviados' };
export const ClientEmail = ({ client }: { client: Client }) => {
  const state = useClientEmail(client);
  if (!state.isAdmin) return null;
  if (state.loading) return <LoadingBlock message="Cargando correo de Manglar…" />;
  const selected = (client.contacts || []).some(contact => contact.email === state.to);
  const locked = state.busy || client.status === 'archived';
  return <div className="space-y-5">
    {state.error && <Alert tone="danger">{state.error}</Alert>}
    {state.connection && !state.connection.connected && <Alert tone="info"><p>Conecta el buzón de Manglar en la configuración general para enviar correos a tus clientes.</p><Link className={`${buttonClasses('secondary', 'sm')} mt-3`} to="/configuracion#correo">Ir a configuración de correo</Link></Alert>}
    {state.connection?.connected && <Card className="overflow-hidden rounded-2xl">
      <CardHeader title={state.review ? 'Revisar correo' : 'Enviar correo'} description={`Mensaje para ${client.name}. Las respuestas llegarán al buzón de Manglar.`} />
      <CardBody>
        {!client.contacts?.length && <Alert tone="info">Agrega y guarda al menos un contacto en la pestaña Contactos para poder enviarle un correo.</Alert>}
        <form className="max-w-3xl space-y-4" onSubmit={event => { event.preventDefault(); if (state.review) void state.send(); else state.setReview(true); }}>
          {!state.review ? <fieldset disabled={locked || !client.contacts?.length} className="space-y-4">
            <label className="block space-y-2 text-sm"><span>Para</span><select required className={INPUT_CLASS} value={selected ? state.to : ''} onChange={event => state.setTo(event.target.value)}><option value="" disabled>Selecciona un contacto</option>{client.contacts?.map((contact, index) => <option key={index} value={contact.email}>{contact.name} · {contact.email}</option>)}</select></label>
            <label className="block space-y-2 text-sm"><span>Asunto</span><input required maxLength={MAX_EMAIL_SUBJECT_LENGTH} className={INPUT_CLASS} value={state.subject} onChange={event => state.setSubject(event.target.value)} /></label>
            <label className="block space-y-2 text-sm"><span>Mensaje</span><textarea required rows={10} maxLength={MAX_EMAIL_BODY_LENGTH} className={INPUT_CLASS} value={state.body} onChange={event => state.setBody(event.target.value)} placeholder="Escribe el mensaje para tu cliente…" /></label>
            <Button type="submit" disabled={!selected || !state.subject.trim() || !state.body.trim()}>Revisar correo</Button>
          </fieldset> : <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm"><dl className="space-y-2"><div><dt className="text-slate-500">De</dt><dd>{MANGLAR_EMAIL_SENDER}</dd></div><div><dt className="text-slate-500">Para</dt><dd className="break-all">{state.to}</dd></div><div><dt className="text-slate-500">Asunto</dt><dd className="font-semibold break-words">{state.subject}</dd></div></dl><p className="mt-5 whitespace-pre-wrap break-words border-t border-slate-200 pt-5 leading-6">{state.body}</p></div>
            {state.pending && (!state.receipt || ['unknown', 'sending'].includes(state.receipt.status)) && <Alert tone="warning">{state.busy ? 'Enviando el mensaje…' : 'El envío aún no está confirmado. Puedes consultar el mismo intento sin volver a enviarlo. Antes de crear otro mensaje, revisa Enviados en Gmail.'}</Alert>}
            {state.receipt && <p role="status" className="text-sm font-medium">{STATUS[state.receipt.status]}</p>}
            <div className="flex flex-wrap gap-3">
              {(!state.receipt || ['sending', 'unknown'].includes(state.receipt.status)) && <Button type="submit" icon={Send} loading={state.busy} disabled={locked}>{state.pending ? 'Consultar intento de envío' : 'Enviar correo'}</Button>}
              {!state.pending && <Button type="button" variant="secondary" disabled={locked} onClick={() => state.setReview(false)}>Editar mensaje</Button>}
              {state.pending && <Button type="button" variant="secondary" disabled={locked} onClick={() => void state.newMessage()}>Escribir otro correo</Button>}
            </div>
          </>}
        </form>
      </CardBody>
    </Card>}
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader title="Últimos envíos" description="Los últimos 20 intentos de envío desde la app. Enviado indica que Gmail aceptó el mensaje; no confirma su entrega o lectura." />
      <CardBody className="space-y-3">
        <Button variant="ghost" size="sm" icon={RefreshCw} disabled={state.busy} onClick={() => void state.refresh()}>Actualizar historial</Button>
        {!state.history.length && <p className="text-sm text-slate-500">Todavía no hay correos enviados desde la app para este cliente.</p>}
        <ul className="divide-y divide-slate-200">{state.history.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div className="min-w-0"><p className="font-medium break-words">{item.subject}</p><p className="break-all text-slate-500">{item.to}</p></div><div className="text-right"><Badge tone={item.status === 'sent' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'}>{STATUS[item.status]}</Badge><p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('es-MX')}</p></div></li>)}</ul>
      </CardBody>
    </Card>
  </div>;
};
