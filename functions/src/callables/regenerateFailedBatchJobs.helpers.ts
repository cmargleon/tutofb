import { Provider } from '../../../shared/src/types';

export const NOTIFICATION_RETRY_PROVIDERS: Readonly<[Provider, Provider]> = [
  'fal-seedream',
  'fal-gpt-image-2',
];

export const resolveNotificationRetryProvider = (
  batchProvider: Provider,
  randomValue: number = Math.random(),
): Provider => {
  if (batchProvider === 'fal-seedream') {
    return 'fal-gpt-image-2';
  }

  if (batchProvider === 'fal-gpt-image-2') {
    return 'fal-seedream';
  }

  return randomValue < 0.5 ? NOTIFICATION_RETRY_PROVIDERS[0] : NOTIFICATION_RETRY_PROVIDERS[1];
};
