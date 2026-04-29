import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  Batch,
  FinanceBillingMode,
  FinanceClientPricing,
  FinanceCurrency,
  UpsertFinanceClientPricingRequest,
} from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

export const FINANCE_CLIENT_PRICING_COLLECTION = 'finance_client_pricing';

const isCurrency = (value: unknown): value is FinanceCurrency => value === 'MXN' || value === 'USD';
const isBillingMode = (value: unknown): value is FinanceBillingMode =>
  value === 'approved_outputs'
  || value === 'generated_outputs'
  || value === 'batch'
  || value === 'retainer_plus_usage';

const money = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(6)) : 0;

const nullableDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

export const getPricingDocRef = (clientId: string) =>
  getAppFirestore().collection(FINANCE_CLIENT_PRICING_COLLECTION).doc(clientId);

export const normalizePricingRequest = async (
  input: UpsertFinanceClientPricingRequest,
  updatedByUid: string,
  updatedByDisplayName: string | null,
): Promise<Omit<FinanceClientPricing, 'createdAt' | 'updatedAt'>> => {
  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  if (!clientId) {
    throw new HttpsError('invalid-argument', 'El cliente es obligatorio.');
  }

  const clientSnapshot = await getAppFirestore().collection('clients').doc(clientId).get();
  if (!clientSnapshot.exists) {
    throw new HttpsError('not-found', 'No se encontró el cliente seleccionado.');
  }

  const clientNameSnapshot = typeof clientSnapshot.data()?.name === 'string'
    ? clientSnapshot.data()!.name
    : 'Cliente desconocido';

  return {
    id: clientId,
    clientId,
    clientNameSnapshot,
    billingMode: isBillingMode(input.billingMode) ? input.billingMode : 'approved_outputs',
    currency: isCurrency(input.currency) ? input.currency : 'MXN',
    pricePerApprovedOutput: money(input.pricePerApprovedOutput),
    pricePerGeneratedOutput: money(input.pricePerGeneratedOutput),
    pricePerBatch: money(input.pricePerBatch),
    monthlyRetainer: money(input.monthlyRetainer),
    minimumMonthly: money(input.minimumMonthly),
    effectiveFrom: nullableDate(input.effectiveFrom),
    effectiveTo: nullableDate(input.effectiveTo),
    active: input.active !== false,
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 1000) : null,
    updatedByUid,
    updatedByDisplayName,
  };
};

export const getActiveClientPricing = async (clientId: string): Promise<FinanceClientPricing | null> => {
  const snapshot = await getPricingDocRef(clientId).get();
  if (!snapshot.exists) return null;
  const pricing = { id: snapshot.id, ...snapshot.data() } as FinanceClientPricing;
  return pricing.active === false ? null : pricing;
};

export const estimateBatchRevenue = (
  pricing: FinanceClientPricing | null,
  batch: Batch,
): { amount: number; currency: FinanceCurrency; quantity: number; description: string } | null => {
  if (!pricing) return null;

  const completedJobs = Math.max(0, Number(batch.completedJobs || 0));
  const generatedOutputs = Math.max(0, Number(batch.completedOutputCount || batch.completedJobs || 0));

  if (pricing.billingMode === 'batch') {
    return {
      amount: pricing.pricePerBatch,
      currency: pricing.currency,
      quantity: 1,
      description: `Ingreso estimado por lote (${batch.clientNameSnapshot})`,
    };
  }

  if (pricing.billingMode === 'generated_outputs') {
    return {
      amount: pricing.pricePerGeneratedOutput * generatedOutputs,
      currency: pricing.currency,
      quantity: generatedOutputs,
      description: `Ingreso estimado por ${generatedOutputs} outputs generados`,
    };
  }

  if (pricing.billingMode === 'retainer_plus_usage') {
    return {
      amount: pricing.pricePerApprovedOutput * completedJobs,
      currency: pricing.currency,
      quantity: completedJobs,
      description: `Ingreso variable estimado por ${completedJobs} outputs aprobados`,
    };
  }

  return {
    amount: pricing.pricePerApprovedOutput * completedJobs,
    currency: pricing.currency,
    quantity: completedJobs,
    description: `Ingreso estimado por ${completedJobs} outputs aprobados`,
  };
};

export const upsertPricing = async (pricing: Omit<FinanceClientPricing, 'createdAt' | 'updatedAt'>) => {
  const ref = getPricingDocRef(pricing.clientId);
  const snapshot = await ref.get();
  await ref.set(
    {
      ...pricing,
      createdAt: snapshot.exists ? snapshot.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  const updated = await ref.get();
  return { id: updated.id, ...updated.data() } as FinanceClientPricing;
};
