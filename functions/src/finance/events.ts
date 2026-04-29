import * as admin from 'firebase-admin';
import {
  FinanceEvent,
  FinanceEventCategory,
  FinanceEventType,
  FinanceMoneySnapshot,
} from '../../../shared/src/types';
import { formatMexicoCityDate } from '../../../shared/src/utils/dateUtils';
import { getAppFirestore } from '../firebase/appFirestore';

export const FINANCE_EVENTS_COLLECTION = 'finance_events';

const getPeriod = (value: unknown): string => formatMexicoCityDate(value || new Date()).slice(0, 7);

export const getFinancePeriod = getPeriod;

const sanitizeDocId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

const emptySnapshot = () => ({
  revenueMxn: 0,
  revenueUsd: 0,
  variableCostMxn: 0,
  variableCostUsd: 0,
  humanCostMxn: 0,
  humanCostUsd: 0,
  allocatedFixedCostMxn: 0,
  allocatedFixedCostUsd: 0,
  grossProfitMxn: 0,
  grossProfitUsd: 0,
  eventCount: 0,
});

const costBucketForCategory = (category: FinanceEventCategory) => {
  if (category === 'human_operation') return 'humanCost';
  if (category === 'fixed_cost_allocation') return 'allocatedFixedCost';
  return 'variableCost';
};

const buildIncrementPayload = (type: FinanceEventType, category: FinanceEventCategory, money: FinanceMoneySnapshot) => {
  const payload: Record<string, FirebaseFirestore.FieldValue> = {
    eventCount: admin.firestore.FieldValue.increment(1),
  };
  const profitSign = type === 'revenue' ? 1 : -1;

  if (type === 'revenue') {
    payload.revenueMxn = admin.firestore.FieldValue.increment(money.amountMxn);
    payload.revenueUsd = admin.firestore.FieldValue.increment(money.amountUsd);
  } else if (type === 'cost') {
    const bucket = costBucketForCategory(category);
    payload[`${bucket}Mxn`] = admin.firestore.FieldValue.increment(money.amountMxn);
    payload[`${bucket}Usd`] = admin.firestore.FieldValue.increment(money.amountUsd);
  }

  payload.grossProfitMxn = admin.firestore.FieldValue.increment(profitSign * money.amountMxn);
  payload.grossProfitUsd = admin.firestore.FieldValue.increment(profitSign * money.amountUsd);
  return payload;
};

const setSnapshot = (
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  event: FinanceEvent,
  basePayload: Record<string, unknown>,
) => {
  transaction.set(
    ref,
    {
      ...emptySnapshot(),
      period: event.period,
      ...basePayload,
      ...buildIncrementPayload(event.type, event.category, event.money),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
};

export interface RecordFinanceEventInput extends Omit<FinanceEvent, 'id' | 'createdAt' | 'period'> {
  eventId: string;
  period?: string;
}

export const recordFinanceEventOnce = async (input: RecordFinanceEventInput): Promise<boolean> => {
  const db = getAppFirestore();
  const eventId = sanitizeDocId(input.eventId);
  const eventRef = db.collection(FINANCE_EVENTS_COLLECTION).doc(eventId);
  const period = input.period || getPeriod(input.sourceCreatedAt || new Date());

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(eventRef);
    if (existing.exists) {
      return false;
    }

    const event: FinanceEvent = {
      ...input,
      id: eventId,
      period,
      createdAt: admin.firestore.FieldValue.serverTimestamp() as unknown,
    };

    transaction.set(eventRef, event);

    setSnapshot(transaction, db.collection('finance_snapshots_global').doc(period), event, {
      id: period,
      period,
      reportingCurrency: 'MXN',
      secondaryCurrency: 'USD',
    });

    if (event.clientId) {
      setSnapshot(transaction, db.collection('finance_snapshots_clients').doc(`${period}__${event.clientId}`), event, {
        id: `${period}__${event.clientId}`,
        period,
        clientId: event.clientId,
        clientNameSnapshot: event.clientNameSnapshot || 'Cliente desconocido',
      });
    }

    if (event.batchId) {
      setSnapshot(transaction, db.collection('finance_snapshots_batches').doc(event.batchId), event, {
        id: event.batchId,
        batchId: event.batchId,
        clientId: event.clientId || null,
        clientNameSnapshot: event.clientNameSnapshot || 'Cliente desconocido',
        modelId: event.modelId || null,
        modelNameSnapshot: event.modelNameSnapshot || null,
      });
    }

    if (event.jobId) {
      setSnapshot(transaction, db.collection('finance_snapshots_jobs').doc(event.jobId), event, {
        id: event.jobId,
        jobId: event.jobId,
        batchId: event.batchId || null,
        clientId: event.clientId || null,
        clientNameSnapshot: event.clientNameSnapshot || 'Cliente desconocido',
        modelId: event.modelId || null,
        modelNameSnapshot: event.modelNameSnapshot || null,
        provider: event.provider || null,
      });
    }

    if (event.provider) {
      setSnapshot(transaction, db.collection('finance_snapshots_providers').doc(`${period}__${event.provider}`), event, {
        id: `${period}__${event.provider}`,
        period,
        provider: event.provider,
      });
    }

    if (event.modelId) {
      setSnapshot(transaction, db.collection('finance_snapshots_models').doc(`${period}__${event.modelId}`), event, {
        id: `${period}__${event.modelId}`,
        period,
        modelId: event.modelId,
        modelNameSnapshot: event.modelNameSnapshot || 'Modelo desconocido',
        clientId: event.clientId || null,
        clientNameSnapshot: event.clientNameSnapshot || null,
      });
    }

    return true;
  });
};
