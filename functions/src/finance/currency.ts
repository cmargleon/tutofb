import * as admin from 'firebase-admin';
import {
  FinanceCurrency,
  FinanceFxRateSource,
  FinanceMoneySnapshot,
  FinanceSettings,
} from '../../../shared/src/types';
import { formatMexicoCityDate } from '../../../shared/src/utils/dateUtils';
import { getAppFirestore } from '../firebase/appFirestore';

export const FINANCE_SETTINGS_COLLECTION = 'finance_settings';
export const FINANCE_SETTINGS_DOC_ID = 'default';

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  reportingCurrency: 'MXN',
  secondaryCurrency: 'USD',
  defaultFxRateUsdMxn: 18.5,
  humanCostPerInterventionMxn: 12,
  humanHourlyRatesMxn: {
    admin: 350,
    operador: 220,
    revisor: 180,
  },
};

const positiveNumberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(6)) : fallback;

const isCurrency = (value: unknown): value is FinanceCurrency => value === 'MXN' || value === 'USD';

export const sanitizeFinanceSettings = (input: Partial<FinanceSettings> | null | undefined): FinanceSettings => {
  const reportingCurrency = isCurrency(input?.reportingCurrency)
    ? input.reportingCurrency
    : DEFAULT_FINANCE_SETTINGS.reportingCurrency;
  const secondaryCurrency = isCurrency(input?.secondaryCurrency) && input.secondaryCurrency !== reportingCurrency
    ? input.secondaryCurrency
    : reportingCurrency === 'MXN' ? 'USD' : 'MXN';

  return {
    reportingCurrency,
    secondaryCurrency,
    defaultFxRateUsdMxn: positiveNumberOr(input?.defaultFxRateUsdMxn, DEFAULT_FINANCE_SETTINGS.defaultFxRateUsdMxn),
    humanCostPerInterventionMxn: positiveNumberOr(
      input?.humanCostPerInterventionMxn,
      DEFAULT_FINANCE_SETTINGS.humanCostPerInterventionMxn,
    ),
    humanHourlyRatesMxn: {
      admin: positiveNumberOr(input?.humanHourlyRatesMxn?.admin, DEFAULT_FINANCE_SETTINGS.humanHourlyRatesMxn.admin || 0),
      operador: positiveNumberOr(input?.humanHourlyRatesMxn?.operador, DEFAULT_FINANCE_SETTINGS.humanHourlyRatesMxn.operador || 0),
      revisor: positiveNumberOr(input?.humanHourlyRatesMxn?.revisor, DEFAULT_FINANCE_SETTINGS.humanHourlyRatesMxn.revisor || 0),
    },
  };
};

export const getFinanceSettingsDocRef = () =>
  getAppFirestore().collection(FINANCE_SETTINGS_COLLECTION).doc(FINANCE_SETTINGS_DOC_ID);

let cachedSettings: FinanceSettings | null = null;
let cacheExpiresAt = 0;

export const invalidateFinanceSettingsCache = () => {
  cachedSettings = null;
  cacheExpiresAt = 0;
};

export const getFinanceSettingsCached = async (): Promise<FinanceSettings> => {
  const now = Date.now();
  if (cachedSettings && now < cacheExpiresAt) {
    return cachedSettings;
  }

  const snapshot = await getFinanceSettingsDocRef().get();
  cachedSettings = snapshot.exists
    ? sanitizeFinanceSettings(snapshot.data() as Partial<FinanceSettings>)
    : { ...DEFAULT_FINANCE_SETTINGS };
  cacheExpiresAt = now + 5 * 60 * 1000;
  return cachedSettings;
};

const roundMoney = (value: number): number => Number(value.toFixed(6));

export const buildMoneySnapshot = ({
  amount,
  currency,
  settings,
  source = 'system_default',
  date,
}: {
  amount: number;
  currency: FinanceCurrency;
  settings: FinanceSettings;
  source?: FinanceFxRateSource;
  date?: string | Date | null;
}): FinanceMoneySnapshot => {
  const normalizedAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const fxRateUsdMxn = settings.defaultFxRateUsdMxn > 0
    ? settings.defaultFxRateUsdMxn
    : DEFAULT_FINANCE_SETTINGS.defaultFxRateUsdMxn;
  const fxRateDate = typeof date === 'string'
    ? date.slice(0, 10)
    : formatMexicoCityDate(date || new Date());
  const amountMxn = currency === 'MXN' ? normalizedAmount : normalizedAmount * fxRateUsdMxn;
  const amountUsd = currency === 'USD' ? normalizedAmount : normalizedAmount / fxRateUsdMxn;

  return {
    amount: roundMoney(normalizedAmount),
    currency,
    amountMxn: roundMoney(amountMxn),
    amountUsd: roundMoney(amountUsd),
    fxRateUsdMxn: roundMoney(fxRateUsdMxn),
    fxRateSource: source,
    fxRateDate,
  };
};

export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();
