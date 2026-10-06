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
  process.env.LOG_LEVEL ??= 'silent';
}
