/** Defaults for the test environment. Override TEST_DATABASE_URL to point elsewhere (e.g. CI). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://kritex:kritex@localhost:5434/kritex_test?schema=public';

export const TEST_ADMIN_API_KEY = 'test-admin-key';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.ADMIN_API_KEY = TEST_ADMIN_API_KEY;
  process.env.CORS_ORIGIN = 'http://localhost:8080';
  process.env.LOG_LEVEL ??= 'silent';
}
