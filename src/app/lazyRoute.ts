import { ComponentType, lazy, LazyExoticComponent } from 'react';

const LAZY_ROUTE_RELOAD_PREFIX = 'tutofb:lazy-route-reload';
const DYNAMIC_IMPORT_ERROR_SNIPPETS = [
  'chunkloaderror',
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
];

type LazyRouteModule<T extends ComponentType<any>> = Promise<{ default: T }>;

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const isDynamicImportError = (error: unknown): boolean => {
  const message = toErrorMessage(error).toLowerCase();

  return DYNAMIC_IMPORT_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
};

const getReloadStorageKey = (routeKey: string) => `${LAZY_ROUTE_RELOAD_PREFIX}:${routeKey}`;

const reloadForDynamicImportError = (routeKey: string): Promise<never> => {
  const reloadStorageKey = getReloadStorageKey(routeKey);

  if (window.sessionStorage.getItem(reloadStorageKey) === '1') {
    window.sessionStorage.removeItem(reloadStorageKey);
    throw new Error('No se pudo recuperar la ruta después de recargar la aplicación.');
  }

  window.sessionStorage.setItem(reloadStorageKey, '1');
  window.location.reload();

  return new Promise<never>(() => undefined);
};

export const lazyRoute = <T extends ComponentType<any>>(
  routeKey: string,
  loadModule: () => LazyRouteModule<T>,
): LazyExoticComponent<T> => lazy(async () => {
  try {
    const module = await loadModule();
    window.sessionStorage.removeItem(getReloadStorageKey(routeKey));
    return module;
  } catch (error) {
    if (typeof window !== 'undefined' && isDynamicImportError(error)) {
      return reloadForDynamicImportError(routeKey);
    }

    throw error;
  }
});
