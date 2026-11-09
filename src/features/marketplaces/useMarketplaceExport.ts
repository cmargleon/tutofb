import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadMarketplaceExportResponse, MarketplaceExportPreview, MarketplaceExportScope } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { downloadMarketplaceExports, previewMarketplaceExports } from './exportFirebase';
export function useMarketplaceExport(scope: MarketplaceExportScope) {
  const [preview, setPreview] = useState<MarketplaceExportPreview | null>(null);
  const [selected, setSelected] = useState<MarketplaceId[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DownloadMarketplaceExportResponse | null>(null);
  const version = useRef(0); const lock = useRef(false); const requestId = useRef<string | null>(null);
  const key = JSON.stringify(scope);
  const refresh = useCallback(async () => {
    const current = ++version.current; setLoading(true); setError(null); requestId.current = null;
    try { const next = await previewMarketplaceExports(JSON.parse(key)); if (current === version.current) setPreview(next); }
    catch (e) { if (current === version.current) { setPreview(null); setError((e as Error).message); } }
    finally { if (current === version.current) setLoading(false); }
  }, [key]);
  useEffect(() => { setPreview(null); setSelected([]); setResult(null); void refresh(); return () => { version.current++; }; }, [refresh]);
  const select = (ids: MarketplaceId[]) => { if (lock.current) return; requestId.current = null; setSelected(ids); setResult(null); };
  const download = async () => {
    if (lock.current || !selected.length || !preview || selected.some(id => !preview.channels.find(c => c.marketplaceId === id)?.ready)) return;
    lock.current = true; setBusy(true); setError(null);
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await downloadMarketplaceExports({ ...JSON.parse(key), marketplaceIds: selected, requestId: requestId.current }); setResult(response);
      if (response.downloadUrl && response.fileName) {
        const a = document.createElement('a'); a.href = response.downloadUrl; a.download = response.fileName; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      }
      // A controlled retry addresses only failed destinations with a fresh explicit click.
      if (response.failures.length) { setSelected(response.failures.map(f => f.marketplaceId)); requestId.current = null; }
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return { preview, selected, select, loading, busy, error, result, refresh, download };
}
