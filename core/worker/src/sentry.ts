import * as Sentry from '@sentry/node';

/**
 * Initialize Sentry error tracking if SENTRY_DSN is provided
 * This module should be imported early in the worker startup
 */
export function initSentry(): void {
  if (process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: process.env['NODE_ENV'] || 'production',
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      beforeSend(event, _hint) {
        // Filter out scheduled post processing logs
        if (event.request) {
          const url = event.request.url;
          if (url?.includes('scheduled-post') || url?.includes('worker')) {
            // Keep these as they might be important for debugging
          }
        }
        return event;
      },
    });
    console.log('[Sentry] Worker error tracking initialized');
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