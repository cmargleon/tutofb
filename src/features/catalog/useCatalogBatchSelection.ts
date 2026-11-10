import { useEffect, useMemo, useState } from 'react';
import { SetURLSearchParams } from 'react-router-dom';
import { Batch, Client } from '../../../shared/src/types';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { subscribeToClient, subscribeToClients } from '../clients/firebase';
import { buildCatalogBatchOptions, resolveSelectedCatalogBatch } from './catalogView';
import { subscribeToCatalogBatch } from './firebase';

interface CatalogBatchSelectionParams {
  client?: Client;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  selectedClientId: string;
  selectedBatchId: string;
  batchParam: string;
  batches: Batch[];
}

export const useCatalogBatchSelection = ({
  client,
  searchParams,
  setSearchParams,
  selectedClientId,
  selectedBatchId,
  batchParam,
  batches,
}: CatalogBatchSelectionParams) => {
  const [requestedBatch, setRequestedBatch] = useState<Batch | null>(null);
  const [batchLinkError, setBatchLinkError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  // Only whether the page is client-scoped matters below; depending on the boolean avoids
  // re-running effects when the parent passes a new `client` object with the same meaning.
  const isClientScoped = Boolean(client);

  useEffect(() => {
    setRequestedBatch(null); setBatchLinkError(null);
    if (!selectedBatchId) return;
    return subscribeToCatalogBatch(selectedBatchId, (batch) => {
      if (!batch) { setBatchLinkError('El lote solicitado no está disponible.'); return; }
      if (selectedClientId && batch.clientId !== selectedClientId) { setBatchLinkError('El lote solicitado pertenece a otro cliente.'); return; }
      setRequestedBatch(batch);
      if (!selectedClientId) setSearchParams((current) => { const next = new URLSearchParams(current); next.set('clientId', batch.clientId); return next; }, { replace: true });
    }, () => setBatchLinkError('No se pudo cargar el lote solicitado.'));
  }, [selectedBatchId, selectedClientId, setSearchParams]);

  const batchOptions = useMemo(
    () => buildCatalogBatchOptions(batches, requestedBatch, selectedClientId),
    [batches, requestedBatch, selectedClientId],
  );
  const selectedBatch = useMemo(
    () => resolveSelectedCatalogBatch(batchOptions, selectedBatchId, requestedBatch),
    [batchOptions, selectedBatchId, requestedBatch],
  );
  // Use counters only — the status field can be stale after bulk cancels due to trigger race
  // conditions, but counters are always set correctly by the cancel callables.
  const selectedBatchIsGenerating = Boolean(
    selectedBatch
    && (selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0),
  );

  const selectedBatchLabel = useMemo(() => {
    if (!selectedBatchId) return isClientScoped ? 'Todos los lotes del cliente' : 'Sin lotes disponibles';
    const found = batchOptions.find((b) => b.id === selectedBatchId);
    return found ? `${formatDateTimeLong(found.createdAt)} · ${found.id}` : selectedBatchId;
  }, [batchOptions, isClientScoped, selectedBatchId]);

  useEffect(() => client?.id
    ? subscribeToClient(client.id, value => setClients(value ? [value] : []), error => setBatchLinkError(error.message))
    : subscribeToClients(setClients, error => setBatchLinkError(error.message)), [client?.id]);

  useEffect(() => {
    if (isClientScoped || !selectedClientId || selectedBatchId || !batchOptions.length) return;
    // Only choose a default when the URL does not request a specific batch.
    setSearchParams((current) => {
      if (current.get(batchParam) || current.get('clientId') !== selectedClientId) return current;
      const next = new URLSearchParams(current); next.set(batchParam, batchOptions[0].id); return next;
    }, { replace: true });
  }, [batchOptions, batchParam, isClientScoped, selectedClientId, selectedBatchId, setSearchParams]);

  const handleClientChange = (value: string) => {
    if (client) return;
    const next = new URLSearchParams(searchParams);
    if (value) next.set('clientId', value); else next.delete('clientId');
    next.delete(batchParam); setSearchParams(next);
  };

  const handleBatchChange = (value: string) => {
    const next = new URLSearchParams(searchParams); next.set(batchParam, value); setSearchParams(next);
  };

  return {
    clients,
    batchLinkError,
    batchOptions,
    selectedBatch,
    selectedBatchIsGenerating,
    selectedBatchLabel,
    handleClientChange,
    handleBatchChange,
  };
};
