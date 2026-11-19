import { useEffect, useState } from 'react';
import {
  collection, getCountFromServer, getDocs, limit, orderBy, query, startAfter, Timestamp, where,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { CatalogProductGroup, StoredMasterProduct } from '../../../../shared/src/types';
import { db } from '../../../firebase';

export const PRODUCT_PAGE_SIZES = [10, 20, 50, 100] as const;
/** Category filter value for products whose category matches no template type. */
export const UNCLASSIFIED_TYPE = '__none__';

export interface CatalogProductFilters {
  clientId: string;
  group: CatalogProductGroup | '';
  typeId: string;
  /** Inclusive local dates (YYYY-MM-DD) on the product creation date. */
  from: string;
  to: string;
  pageSize: number;
}
export type CatalogProductRecord = StoredMasterProduct & { id: string };

const localDay = (value: string, offsetDays = 0) => {
  const [year, month, day] = value.split('-').map(Number);
  return Timestamp.fromDate(new Date(year, month - 1, day + offsetDays));
};

/** Server-side filters on the browse projection kept by the catalog sync (`catalog.listed/group/typeId`). */
export const catalogProductConstraints = (filters: Omit<CatalogProductFilters, 'clientId' | 'pageSize'>): QueryConstraint[] => [
  where('catalog.listed', '==', true),
  ...(filters.typeId ? [where('catalog.typeId', '==', filters.typeId === UNCLASSIFIED_TYPE ? null : filters.typeId)]
    : filters.group ? [where('catalog.group', '==', filters.group)] : []),
  ...(filters.from ? [where('catalog.createdAt', '>=', localDay(filters.from))] : []),
  ...(filters.to ? [where('catalog.createdAt', '<', localDay(filters.to, 1))] : []),
  orderBy('catalog.createdAt', 'desc'),
];

export function useCatalogProducts(filters: CatalogProductFilters) {
  const { clientId, group, typeId, from, to, pageSize } = filters;
  const key = JSON.stringify([clientId, group, typeId, from, to, pageSize]);
  // cursors[i] = last document of page i (page 0 has no cursor before it).
  const [state, setState] = useState<{ key: string; page: number; cursors: QueryDocumentSnapshot[] }>({ key, page: 0, cursors: [] });
  const page = state.key === key ? state.page : 0;
  const cursors = state.key === key ? state.cursors : [];
  const [result, setResult] = useState<{ key: string; products: CatalogProductRecord[]; last: QueryDocumentSnapshot | null; hasMore: boolean } | null>(null);
  const [total, setTotal] = useState<{ key: string; value: number | null } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const pageKey = `${key}#${page}#${reload}`;

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const base = collection(db, 'clients', clientId, 'products');
    const cursor = page > 0 ? cursors[page - 1] : undefined;
    // One extra document tells whether a next page exists without a second query.
    void getDocs(query(base, ...catalogProductConstraints({ group, typeId, from, to }), ...(cursor ? [startAfter(cursor)] : []), limit(pageSize + 1)))
      .then(snapshot => {
        if (!active) return;
        const docs = snapshot.docs.slice(0, pageSize);
        setResult({ key: pageKey, products: docs.map(doc => ({ ...(doc.data() as StoredMasterProduct), id: doc.id })), last: docs.at(-1) ?? null, hasMore: snapshot.docs.length > pageSize });
      })
      .catch((cause: Error) => {
        if (!active) return;
        const building = /index/i.test(cause.message) && /building/i.test(cause.message);
        setError({ key: pageKey, message: building ? 'El índice de búsqueda para estos filtros se está creando. Reintenta en unos minutos.' : cause.message });
      });
    return () => { active = false; };
    // cursors only grow for the current key; the page index selects the one to use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void getCountFromServer(query(collection(db, 'clients', clientId, 'products'), ...catalogProductConstraints({ group, typeId, from, to })))
      .then(snapshot => { if (active) setTotal({ key: `${key}#${reload}`, value: snapshot.data().count }); })
      .catch(() => { if (active) setTotal({ key: `${key}#${reload}`, value: null }); });
    return () => { active = false; };
  }, [key, reload, clientId, group, typeId, from, to]);

  const current = result?.key === pageKey ? result : null;
  const currentError = error?.key === pageKey ? error.message : null;
  return {
    products: current?.products ?? [],
    loading: Boolean(clientId) && !current && !currentError,
    error: currentError,
    page: page + 1,
    total: total?.key === `${key}#${reload}` ? total.value : null,
    hasMore: current?.hasMore ?? false,
    goToPage: (next: number) => {
      const index = next - 1;
      if (index < 0 || index === page) return;
      if (index > page) {
        if (!current?.last || !current.hasMore) return;
        const nextCursors = [...cursors.slice(0, page), current.last];
        setState({ key, page: page + 1, cursors: nextCursors });
      } else setState({ key, page: index, cursors });
    },
    refresh: () => setReload(value => value + 1),
  };
}
