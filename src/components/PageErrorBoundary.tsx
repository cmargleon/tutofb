import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import { isDynamicImportError } from '../app/lazyRoute';

interface PageErrorBoundaryProps {
  children: React.ReactNode;
}

const PageErrorFallback: React.FC<{ error: Error }> = ({ error }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 shadow-sm max-w-md w-full">
      <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-400" />
      <h2 className="mb-2 text-lg font-semibold text-red-900">Algo salió mal en esta página</h2>
      <p className="mb-4 text-sm text-red-700">
        {isDynamicImportError(error)
          ? 'La aplicación recibió una versión nueva y esta vista necesita recargarse para continuar.'
          : 'Ocurrió un error inesperado. El resto de la aplicación sigue funcionando con normalidad.'}
      </p>
      <pre className="mb-6 rounded-md bg-red-100 px-3 py-2 text-left text-xs text-red-800 overflow-auto max-h-32">
        {error.message}
      </pre>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {isDynamicImportError(error) ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Recargar aplicación
          </button>
        ) : null}
        <Link
          to="/"
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  </div>
);

export const PageErrorBoundary: React.FC<PageErrorBoundaryProps> = ({ children }) => (
  <ErrorBoundary fallback={(error) => <PageErrorFallback error={error} />}>
    {children}
  </ErrorBoundary>
);
