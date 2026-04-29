import { FinanceCurrency } from '../../../shared/src/types';

export const formatFinanceMoney = (amount: number, currency: FinanceCurrency = 'MXN') =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'MXN' ? 2 : 4,
  }).format(Number.isFinite(amount) ? amount : 0);

export const formatFinancePct = (profit: number, revenue: number) => {
  if (!revenue) return '0%';
  return `${((profit / revenue) * 100).toFixed(1)}%`;
};
