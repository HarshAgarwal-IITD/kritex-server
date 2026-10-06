import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-env';

/** Applies all Prisma migrations to the test DB once before the e2e run. */
export default function globalSetup(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
