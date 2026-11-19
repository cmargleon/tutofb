import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadMarketplaceExportResponse, MarketplaceExportPreview, MarketplaceExportScope } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { downloadMarketplaceExports, previewMarketplaceExports } from './exportFirebase';
export function useMarketplaceExport(scope: MarketplaceExportScope) {
  const [preview, setPreview] = useState<MarketplaceExportPreview | null>(null);
  const [selected, setSelected] = useState<MarketplaceId[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false); const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [result, setResult] = useState<DownloadMarketplaceExportResponse | null>(null);
  // Export what is ready and leave out (and list) products with blocking requirements.
  const [skipBlocked, setSkipBlockedState] = useState(false);
  const version = useRef(0); const lock = useRef(false); const requestId = useRef<string | null>(null);
  const key = JSON.stringify(scope);
  /** `retryFailed` re-runs only the analyses Gemini could not resolve before; it is an explicit operator action. */
  const refresh = useCallback(async (retryFailed = false) => {
    const current = ++version.current; setLoading(true); setError(null); setAnalyzing(false); setAnalysisError(null); requestId.current = null;
    let next: MarketplaceExportPreview;
    try { next = await previewMarketplaceExports(JSON.parse(key)); if (current === version.current) setPreview(next); }
    catch (e) { if (current === version.current) { setPreview(null); setError((e as Error).message); } return; }
    finally { if (current === version.current) setLoading(false); }
    if (current !== version.current) return;
    if (next.autofillBackground) {
      // The batch is being prepared in the background: show cached data and refresh it until the work is done.
      setAnalyzing(true);
      try {
        for (let poll = 0; poll < 60 && next.autofillBackground && current === version.current; poll++) {
          await new Promise(resolve => setTimeout(resolve, 15_000));
          if (current !== version.current) return;
          next = await previewMarketplaceExports(JSON.parse(key));
          if (current === version.current) setPreview(next);
        }
      } catch (e) { if (current === version.current) setAnalysisError((e as Error).message); }
      finally { if (current === version.current) setAnalyzing(false); }
      return;
    }
    if (!next.autofillPending && !retryFailed) return;
    // The form opens with cached data while Gemini runs; the server joins any analysis already in progress.
    setAnalyzing(true);
    try { const analyzed = await previewMarketplaceExports({ ...JSON.parse(key), analyzeAutofill: true, ...(retryFailed ? { retryFailedAutofill: true } : {}) }); if (current === version.current) setPreview(analyzed); }
    catch (e) { if (current === version.current) setAnalysisError((e as Error).message); }
    finally { if (current === version.current) setAnalyzing(false); }
  }, [key]);
  useEffect(() => { setPreview(null); setSelected([]); setResult(null); void refresh(); return () => { version.current++; }; }, [refresh]);
  const select = (ids: MarketplaceId[]) => { if (lock.current) return; requestId.current = null; setSelected(ids); setResult(null); };
  const setSkipBlocked = (value: boolean) => { if (lock.current) return; requestId.current = null; setSkipBlockedState(value); setResult(null); };
  const exportable = (id: MarketplaceId) => {
    const channel = preview?.channels.find(c => c.marketplaceId === id);
    if (!channel || channel.ready) return Boolean(channel);
    const blocking = channel.issues.filter(issue => issue.blocking !== false);
    const blocked = new Set(blocking.map(issue => issue.productId));
    return skipBlocked && !blocking.some(issue => !issue.productId) && (preview?.products.some(product => !blocked.has(product.id)) ?? false);
  };
  const download = async () => {
    if (lock.current || analyzing || !selected.length || !preview || selected.some(id => !exportable(id))) return;
    lock.current = true; setBusy(true); setError(null);
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await downloadMarketplaceExports({ ...JSON.parse(key), marketplaceIds: selected, requestId: requestId.current, authorizePublicImages: true, ...(skipBlocked ? { skipBlockedProducts: true } : {}) }); setResult(response);
      if (response.downloadUrl && response.fileName) {
        const a = document.createElement('a'); a.href = response.downloadUrl; a.download = response.fileName; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      }
      // A controlled retry addresses only failed destinations with a fresh explicit click.
      if (response.failures.length) { setSelected(response.failures.map(f => f.marketplaceId)); requestId.current = null; }
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return { preview, selected, select, loading, analyzing, analysisError, busy, error, result, refresh, download, skipBlocked, setSkipBlocked, exportable };
}
