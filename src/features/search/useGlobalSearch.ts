import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { Batch, Client, Model } from '../../../shared/src/types';
import { isActiveCatalogEntity } from '../../../shared/src/domain';

export type GlobalSearchResultType = 'client' | 'model' | 'batch';

export interface GlobalSearchResult {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  keywords: string[];
  href: string;
  meta?: string;
}

interface UseGlobalSearchOptions {
  enabledClients: boolean;
  enabledModels: boolean;
  enabledBatches: boolean;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const includesNormalized = (value: string, queryText: string) => normalize(value).includes(queryText);

const getDate = (value: unknown): Date | null => {
  if (!value) return null;

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return new Date(value.toMillis());
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatRelativeDate = (value: unknown) => {
  const date = getDate(value);
  if (!date) return 'sin fecha';

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getBatchStatusLabel = (status: Batch['status']) => {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'processing':
      return 'Procesando';
    case 'completed':
      return 'Completado';
    case 'partial_failed':
      return 'Parcial';
    case 'failed':
      return 'Fallido';
    default:
      return status;
  }
};

const scoreResult = (result: GlobalSearchResult, queryText: string) => {
  const normalizedTitle = normalize(result.title);
  const normalizedSubtitle = normalize(result.subtitle);
  const normalizedKeywords = result.keywords.map((keyword) => normalize(keyword));

  if (normalizedTitle === queryText) return 100;
  if (normalizedTitle.startsWith(queryText)) return 80;
  if (normalizedKeywords.some((keyword) => keyword.startsWith(queryText))) return 70;
  if (normalizedTitle.includes(queryText)) return 60;
  if (normalizedSubtitle.includes(queryText)) return 45;
  if (normalizedKeywords.some((keyword) => keyword.includes(queryText))) return 40;
  return 0;
};

export const useGlobalSearch = ({ enabledClients, enabledModels, enabledBatches }: UseGlobalSearchOptions) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    if (!enabledClients) {
      setClients([]);
      return;
    }

    return onSnapshot(
      query(collection(db, 'clients'), orderBy('updatedAt', 'desc'), limit(100)),
      (snapshot) => {
        setClients(
          snapshot.docs
            .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Client))
            .filter((client) => isActiveCatalogEntity(client)),
        );
      },
      (error) => {
        console.error('Global search clients subscription failed', error);
        setClients([]);
      },
    );
  }, [enabledClients]);

  useEffect(() => {
    if (!enabledModels) {
      setModels([]);
      return;
    }

    return onSnapshot(
      query(collection(db, 'models'), orderBy('updatedAt', 'desc'), limit(150)),
      (snapshot) => {
        setModels(
          snapshot.docs
            .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Model))
            .filter((model) => isActiveCatalogEntity(model)),
        );
      },
      (error) => {
        console.error('Global search models subscription failed', error);
        setModels([]);
      },
    );
  }, [enabledModels]);

  useEffect(() => {
    if (!enabledBatches) {
      setBatches([]);
      return;
    }

    return onSnapshot(
      query(collection(db, 'batches'), orderBy('updatedAt', 'desc'), limit(150)),
      (snapshot) => {
        setBatches(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch)));
      },
      (error) => {
        console.error('Global search batches subscription failed', error);
        setBatches([]);
      },
    );
  }, [enabledBatches]);

  const recentResults = useMemo<GlobalSearchResult[]>(
    () => [
      ...clients.slice(0, 4).map((client) => ({
        id: client.id!,
        type: 'client' as const,
        title: client.name,
        subtitle: 'Cliente',
        keywords: [client.name, client.id!],
        href: `/clients#client-${client.id}`,
        meta: `Alta ${formatRelativeDate(client.createdAt)}`,
      })),
      ...models.slice(0, 4).map((model) => ({
        id: model.id!,
        type: 'model' as const,
        title: model.name,
        subtitle: model.clientNameSnapshot,
        keywords: [model.name, model.clientNameSnapshot, model.id!],
        href: `/models#model-${model.id}`,
        meta: `${model.poseCount || 0} poses`,
      })),
      ...batches.slice(0, 6).map((batch) => ({
        id: batch.id!,
        type: 'batch' as const,
        title: `${batch.clientNameSnapshot} · ${batch.modelNameSnapshot}`,
        subtitle: `Lote ${batch.id!.slice(0, 8)}`,
        keywords: [
          batch.id!,
          batch.clientNameSnapshot,
          batch.modelNameSnapshot,
          batch.status,
          getBatchStatusLabel(batch.status),
        ],
        href: `/evaluacion?batchId=${batch.id}`,
        meta: `${getBatchStatusLabel(batch.status)} · ${formatRelativeDate(batch.updatedAt)}`,
      })),
    ],
    [batches, clients, models],
  );

  const search = (rawQuery: string) => {
    const queryText = normalize(rawQuery);
    if (!queryText) {
      return recentResults;
    }

    const clientResults: GlobalSearchResult[] = clients
      .map((client) => ({
        id: client.id!,
        type: 'client' as const,
        title: client.name,
        subtitle: 'Cliente',
        keywords: [client.name, client.id!],
        href: `/clients#client-${client.id}`,
        meta: `Alta ${formatRelativeDate(client.createdAt)}`,
      }))
      .filter((result) =>
        [result.title, result.subtitle, ...result.keywords].some((value) => includesNormalized(value, queryText)),
      );

    const modelResults: GlobalSearchResult[] = models
      .map((model) => ({
        id: model.id!,
        type: 'model' as const,
        title: model.name,
        subtitle: model.clientNameSnapshot,
        keywords: [model.name, model.clientNameSnapshot, model.id!],
        href: `/models#model-${model.id}`,
        meta: `${model.poseCount || 0} poses`,
      }))
      .filter((result) =>
        [result.title, result.subtitle, ...result.keywords].some((value) => includesNormalized(value, queryText)),
      );

    const batchResults: GlobalSearchResult[] = batches
      .map((batch) => ({
        id: batch.id!,
        type: 'batch' as const,
        title: `${batch.clientNameSnapshot} · ${batch.modelNameSnapshot}`,
        subtitle: `Lote ${batch.id!.slice(0, 8)}`,
        keywords: [
          batch.id!,
          batch.clientNameSnapshot,
          batch.modelNameSnapshot,
          batch.status,
          getBatchStatusLabel(batch.status),
        ],
        href: `/evaluacion?batchId=${batch.id}`,
        meta: `${getBatchStatusLabel(batch.status)} · ${formatRelativeDate(batch.updatedAt)}`,
      }))
      .filter((result) =>
        [result.title, result.subtitle, ...result.keywords].some((value) => includesNormalized(value, queryText)),
      );

    return [...clientResults, ...modelResults, ...batchResults]
      .map((result) => ({ result, score: scoreResult(result, queryText) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.result.title.localeCompare(right.result.title, 'es'))
      .slice(0, 12)
      .map(({ result }) => result);
  };

  return {
    recentResults,
    search,
  };
};
