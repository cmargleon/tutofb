import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogProduct, CatalogProductDetail, CatalogStatus } from '../../../shared/src/types';
import { getMasterCatalogProduct, listMasterCatalog } from './masterFirebase';

export function useMasterCatalog(clientId: string) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<CatalogStatus | ''>('');
  const [cursor, setCursor] = useState<string>(); const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]); const [nextCursor, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [version, setVersion] = useState(0);
  const [detail, setDetail] = useState<CatalogProductDetail | null>(null);
  const serial = useRef(0); const detailSerial = useRef(0);
  useEffect(() => { setDetail(null); detailSerial.current++; }, [clientId]);
  useEffect(() => {
    let active = true; setLoading(Boolean(clientId)); setError(null); setProducts([]);
    if (!clientId) { setNext(null); return; }
    const timer = window.setTimeout(() => {
      void listMasterCatalog({ clientId, pageSize: 25, ...(cursor ? { cursor } : {}), ...(search ? { search } : {}), ...(status ? { status } : {}) })
        .then(page => { if (active) { setProducts(page.products); setNext(page.nextCursor); } })
        .catch(e => { if (active) setError((e as Error).message); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [clientId, search, status, cursor, version]);
  const reset = useCallback(() => { setCursor(undefined); setHistory([]); setDetail(null); }, []);
  useEffect(reset, [clientId, reset]);
  const open = async (id: string) => {
    const sequence = ++serial.current; const detailSequence = ++detailSerial.current; setLoading(true); setError(null);
    try {
      const value = await getMasterCatalogProduct({ clientId, productId: id });
      if (sequence === serial.current && detailSequence === detailSerial.current) setDetail(value);
    } catch (e) { if (detailSequence === detailSerial.current) setError((e as Error).message); }
    finally { if (sequence === serial.current) setLoading(false); }
  };
  return { products, detail, setDetail, loading, error, setError, search, status, history, nextCursor,
    setSearch: (value: string) => { reset(); setSearch(value); }, setStatus: (value: CatalogStatus | '') => { reset(); setStatus(value); },
    next: () => { if (nextCursor) { setHistory(h => [...h, cursor]); setCursor(nextCursor); } },
    previous: () => { setCursor(history.at(-1)); setHistory(h => h.slice(0, -1)); },
    refresh: () => setVersion(v => v + 1), open,
  };
}
