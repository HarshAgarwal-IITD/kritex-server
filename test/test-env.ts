/** Defaults for the test environment. Override TEST_DATABASE_URL to point elsewhere (e.g. CI). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kritex:kritex@localhost:5434/kritex_test?schema=public';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = 'test-only-better-auth-secret-0123456789abcdef';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.WEB_URL = 'http://localhost:8080';
  delete process.env.SMTP_HOST;
  delete process.env.AUTH_COOKIE_DOMAIN;
  process.env.CORS_ORIGIN = 'http://localhost:8080';
  // Tax fixtures (test/checkout-fixtures.ts) are written for a Maharashtra seller; production's
  // default is West Bengal (src/config/seller.ts).
  process.env.BUSINESS_STATE_CODE = '27';
  process.env.LOG_LEVEL ??= 'silent';
  // Blank (not delete) third-party credentials: loaders such as Prisma's fill *unset* vars from a
  // developer's .env, which could hold real keys. validateEnv treats '' as unset, so tests always use
  // the fake payment gateway, fake shipping and the in-memory mail outbox.
  for (const key of [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'SHIPROCKET_EMAIL',
    'SHIPROCKET_PASSWORD',
    'SHIPROCKET_WEBHOOK_TOKEN',
    'SMTP_HOST',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'STORAGE_DRIVER',
  ]) {
    process.env[key] = '';
  }
}
