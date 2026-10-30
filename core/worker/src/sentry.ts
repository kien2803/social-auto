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
        if (event.request) {
          // Scrub credentials — never ship tokens/cookies to Sentry.
          if (event.request.headers) {
            for (const k of Object.keys(event.request.headers)) {
              if (/authorization|cookie|x-api-key|x-access-token/i.test(k)) {
                delete event.request.headers[k];
              }
            }
          }
          const url = event.request.url;
          if (url) {
            event.request.url = url.replace(
              /([?&](?:token|access_token|refresh_token|code|state|key|secret)=)[^&]*/gi,
              '$1[redacted]',
            );
          }
          if (event.request.query_string) event.request.query_string = '[filtered]';
          event.request.cookies = undefined;
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