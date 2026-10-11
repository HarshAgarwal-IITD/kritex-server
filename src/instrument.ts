import * as Sentry from '@sentry/nestjs';

/**
 * Error reporting (OPS). Imported first in main.ts, before Nest loads, so the SDK can hook into it.
 * No SENTRY_DSN = Sentry stays off (dev, tests, e2e). Errors only, no tracing.
 * Personal data stays out: no IPs, cookies, auth headers or request bodies (addresses, phone numbers).
 */
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.RENDER_GIT_COMMIT, // set by Render
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of ['cookie', 'authorization', 'x-razorpay-signature'])
            delete event.request.headers[h];
        }
      }
      return event;
    },
  });
}
