import { Provider } from '../../../shared/src/types';

export const NOTIFICATION_RETRY_PROVIDERS: Readonly<[Provider, Provider]> = [
  'fal-seedream',
  'openai-gpt-image-1.5',
];

export const resolveNotificationRetryProvider = (
  batchProvider: Provider,
  randomValue: number = Math.random(),
): Provider => {
  if (batchProvider === 'fal-seedream') {
    return 'openai-gpt-image-1.5';
  }

  if (batchProvider === 'openai-gpt-image-1.5') {
    return 'fal-seedream';
  }

  return randomValue < 0.5 ? NOTIFICATION_RETRY_PROVIDERS[0] : NOTIFICATION_RETRY_PROVIDERS[1];
};
