import { useEffect, useState } from 'react';
import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  GeminiUsageFeature,
  GeminiUsageRecord,
  GeminiUsageStatus,
} from '../../../shared/src/types';

export interface GeminiUsageFilters {
  feature: GeminiUsageFeature | 'all';
  model: string;
  status: GeminiUsageStatus | 'all';
}

interface GeminiUsageSummary {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface GeminiUsageBreakdownRow {
  key: string;
  label: string;
  calls: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface GeminiUsageDailyRow {
  date: string;
  calls: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface GeminiUsageAnalyticsData {
  rows: GeminiUsageRecord[];
  availableModels: string[];
  summary: GeminiUsageSummary;
  byFeature: GeminiUsageBreakdownRow[];
  byModel: GeminiUsageBreakdownRow[];
  daily: GeminiUsageDailyRow[];
}

const emptySummary = (): GeminiUsageSummary => ({
  totalCalls: 0,
  successCalls: 0,
  failedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
});

const mapGeminiUsageRecord = (id: string, data: any): GeminiUsageRecord => ({
  id,
  provider: 'gemini',
  feature: data.feature,
  operation: data.operation || 'generateContent',
  model: data.model || 'gemini',
  status: data.status === 'error' ? 'error' : 'success',
  inputTokens: data.inputTokens || 0,
  outputTokens: data.outputTokens || 0,
  totalTokens: data.totalTokens || 0,
  estimatedCostUsd: data.estimatedCostUsd || 0,
  durationMs: data.durationMs ?? null,
  httpStatus: data.httpStatus ?? null,
  errorMessage: data.errorMessage || null,
  batchId: data.batchId || null,
  jobId: data.jobId || null,
  clientId: data.clientId || null,
  clientNameSnapshot: data.clientNameSnapshot || null,
  modelId: data.modelId || null,
  modelNameSnapshot: data.modelNameSnapshot || null,
  garmentId: data.garmentId || null,
  garmentName: data.garmentName || null,
  poseId: data.poseId || null,
  poseFileName: data.poseFileName || null,
  userUid: data.userUid || null,
  createdAt: data.createdAt?.toDate?.() || new Date(),
});

const buildBreakdown = (
  rows: GeminiUsageRecord[],
  pickKey: (row: GeminiUsageRecord) => string,
  pickLabel: (row: GeminiUsageRecord) => string,
): GeminiUsageBreakdownRow[] => {
  const entries = new Map<string, GeminiUsageBreakdownRow>();

  rows.forEach((row) => {
    const key = pickKey(row);
    const current = entries.get(key) || {
      key,
      label: pickLabel(row),
      calls: 0,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    current.calls += 1;
    current.totalCostUsd += row.estimatedCostUsd || 0;
    current.inputTokens += row.inputTokens || 0;
    current.outputTokens += row.outputTokens || 0;
    entries.set(key, current);
  });

  return Array.from(entries.values())
    .sort((left, right) => {
      if (right.totalCostUsd !== left.totalCostUsd) {
        return right.totalCostUsd - left.totalCostUsd;
      }
      return right.calls - left.calls;
    })
    .map((entry) => ({
      ...entry,
      totalCostUsd: Number(entry.totalCostUsd.toFixed(6)),
    }));
};

const buildDaily = (rows: GeminiUsageRecord[]): GeminiUsageDailyRow[] => {
  const entries = new Map<string, GeminiUsageDailyRow>();

  rows.forEach((row) => {
    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    const date = Number.isNaN(createdAt.getTime()) ? 'sin-fecha' : createdAt.toISOString().slice(0, 10);
    const current = entries.get(date) || {
      date,
      calls: 0,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    current.calls += 1;
    current.totalCostUsd += row.estimatedCostUsd || 0;
    current.inputTokens += row.inputTokens || 0;
    current.outputTokens += row.outputTokens || 0;
    entries.set(date, current);
  });

  return Array.from(entries.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({
      ...entry,
      totalCostUsd: Number(entry.totalCostUsd.toFixed(6)),
    }));
};

const buildSummary = (rows: GeminiUsageRecord[]): GeminiUsageSummary =>
  rows.reduce<GeminiUsageSummary>(
    (acc, row) => {
      acc.totalCalls += 1;
      if (row.status === 'error') {
        acc.failedCalls += 1;
      } else {
        acc.successCalls += 1;
      }
      acc.inputTokens += row.inputTokens || 0;
      acc.outputTokens += row.outputTokens || 0;
      acc.totalTokens += row.totalTokens || 0;
      acc.totalCostUsd += row.estimatedCostUsd || 0;
      return acc;
    },
    emptySummary(),
  );

export const useGeminiUsageAnalytics = (daysBack: number, filters: GeminiUsageFilters) => {
  const [data, setData] = useState<GeminiUsageAnalyticsData>({
    rows: [],
    availableModels: [],
    summary: emptySummary(),
    byFeature: [],
    byModel: [],
    daily: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, daysBack));

    const catalogQuery = query(
      collection(db, 'analytics_gemini_usage'),
      where('createdAt', '>=', Timestamp.fromDate(cutoff)),
      orderBy('createdAt', 'desc'),
      limit(500),
    );

    const filtersConstraints: QueryConstraint[] = [
      where('createdAt', '>=', Timestamp.fromDate(cutoff)),
      orderBy('createdAt', 'desc'),
      limit(500),
    ];

    if (filters.feature !== 'all') {
      filtersConstraints.unshift(where('feature', '==', filters.feature));
    }
    if (filters.status !== 'all') {
      filtersConstraints.unshift(where('status', '==', filters.status));
    }
    if (filters.model.trim()) {
      filtersConstraints.unshift(where('model', '==', filters.model.trim()));
    }

    const usageQuery = query(collection(db, 'analytics_gemini_usage'), ...filtersConstraints);

    const unsubscribeCatalog = onSnapshot(
      catalogQuery,
      (snapshot) => {
        const models = Array.from(
          new Set(
            snapshot.docs
              .map((docSnapshot) => String(docSnapshot.data().model || '').trim())
              .filter((value) => value.length > 0),
          ),
        ).sort((left, right) => left.localeCompare(right));

        setData((prev) => ({
          ...prev,
          availableModels: models,
        }));
      },
      () => undefined,
    );

    const unsubscribeUsage = onSnapshot(
      usageQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnapshot) => mapGeminiUsageRecord(docSnapshot.id, docSnapshot.data()));
        const summary = buildSummary(rows);

        setData((prev) => ({
          ...prev,
          rows,
          summary: {
            ...summary,
            totalCostUsd: Number(summary.totalCostUsd.toFixed(6)),
          },
          byFeature: buildBreakdown(rows, (row) => row.feature, (row) => row.feature),
          byModel: buildBreakdown(rows, (row) => row.model, (row) => row.model),
          daily: buildDaily(rows),
        }));
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Error fetching Gemini analytics:', snapshotError);
        setError('Error al cargar el uso de Gemini.');
        setLoading(false);
      },
    );

    return () => {
      unsubscribeCatalog();
      unsubscribeUsage();
    };
  }, [daysBack, filters.feature, filters.model, filters.status]);

  return { data, loading, error };
};
