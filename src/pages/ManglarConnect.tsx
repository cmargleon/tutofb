import React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Link2, ShieldCheck } from 'lucide-react';
import { Button, LoadingBlock } from '../components/ui';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { useManglarConnection } from '../features/automation/useManglarConnection';
import { Login } from './Login';

export const ManglarConnect: React.FC = () => {
  const { user, loading: authLoading } = useAuth(); const { isAdmin, isActive } = useRole();
  const [params] = useSearchParams(); const location = useLocation();
  const requestId = params.get('request');
  const state = useManglarConnection(requestId, Boolean(user && isAdmin && isActive));
  if (authLoading) return <LoadingBlock message="Comprobando acceso…" />;
  if (!user) return <Login redirectTo={`${location.pathname}${location.search}`} />;
  if (!isAdmin || !isActive) return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-semibold">Se necesita una cuenta de administrador</h1><p className="mt-3 text-slate-600">Inicia esta conexión con un administrador activo de Manglar.</p><Link className="mt-5 inline-block text-indigo-600" to="/">Volver a Manglar</Link></main>;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
        <header className="bg-slate-950 px-7 py-8 text-white sm:px-9">
          <div className="mb-5 flex items-center gap-2 text-sm text-slate-300"><ShieldCheck className="h-5 w-5" /> Manglar</div>
          <h1 className="text-2xl font-semibold">{requestId ? 'Conectar con ChatGPT' : 'Conexiones con ChatGPT'}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">{requestId ? 'Revisa el acceso antes de continuar.' : 'Administra las conexiones que autorizaste.'}</p>
        </header>
        <div className="space-y-6 p-7 sm:p-9">
          {state.loading ? <LoadingBlock message="Consultando conexión…" /> : state.error ? <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{state.error}</div> : <>
            {state.details && <section aria-label="Acceso solicitado" className="space-y-5">
              <p className="text-sm leading-6 text-slate-600">ChatGPT podrá consultar los siguientes clientes{state.details.scopes.includes('jobs:create') ? ', preparar pedidos y generar fotografías con los presupuestos que autorices' : ''}.</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">{state.details.clients.map((client) => <li key={client.id} className="py-3 text-sm font-medium text-slate-800">{client.name}</li>)}</ul>
              {!state.details.clients.length && <p className="text-sm text-amber-700">No hay clientes habilitados. Configura los clientes antes de autorizar.</p>}
              <p className="text-sm leading-6 text-slate-600">La conexión dura hasta 30 días. Puedes revocarla desde esta página. Autorizar la conexión no inicia ninguna generación.</p>
              <div className="flex flex-wrap gap-3"><Button loading={state.busy} disabled={!state.details.clients.length} icon={Link2} onClick={() => state.decide(true)}>Autorizar ChatGPT</Button><Button variant="secondary" disabled={state.busy} onClick={() => state.decide(false)}>Rechazar</Button></div>
            </section>}
            {!requestId && <section aria-label="Conexiones autorizadas" className="space-y-4">
              {!state.connections.length && <p className="text-sm text-slate-600">Todavía no autorizaste ninguna conexión. Añade el plugin Manglar en ChatGPT para empezar.</p>}
              {state.connections.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="text-sm font-medium">ChatGPT · {entry.active ? 'Activa' : 'Inactiva'}</p><p className="mt-1 text-xs text-slate-500">Autorizada el {new Date(entry.createdAt).toLocaleDateString('es')}</p></div>{entry.active && <Button variant="danger" size="sm" disabled={state.busy} onClick={() => state.revoke(entry.id)}>Revocar</Button>}</div>)}
            </section>}
          </>}
          <Link to="/" className="inline-block text-sm text-indigo-600 hover:underline">Volver a Manglar</Link>
        </div>
      </div>
    </main>
  );
};
