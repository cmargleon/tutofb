import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export const initSentry = () => {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Capture 100% of errors, sample 10% of performance traces in production
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Don't send events during local dev unless DSN is set
    enabled: Boolean(dsn),
  });
};

export const reportError = (error: unknown, context?: Record<string, unknown>) => {
  if (!dsn) return;

  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
};
