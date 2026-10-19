import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry error tracking if SENTRY_DSN is provided
 * This module should be imported early in the application startup
 */
export function initSentry(): void {
  if (process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env['NODE_ENV'] || 'production',
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      beforeSend(event, _hint) {
        // Filter out health check and static asset requests
        if (event.request) {
          const url = event.request.url;
          if (url?.includes('/health') || url?.includes('/static/')) {
            return null;
          }
        }
        return event;
      },
    });
    console.log('[Sentry] Error tracking initialized');
  } else {
    console.log('[Sentry] SENTRY_DSN not provided, error tracking disabled');
  }
}

/**
 * Capture an exception with additional context
 */
export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (process.env['SENTRY_DSN']) {
    Sentry.captureException(error, {
      extra: context,
    });
  }
}

/**
 * Capture a message with level
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
  if (process.env['SENTRY_DSN']) {
    Sentry.captureMessage(message, {
      level,
      extra: context,
    });
  }
}