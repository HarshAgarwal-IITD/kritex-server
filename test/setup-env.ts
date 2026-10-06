// Runs before every test file (Jest `setupFiles`). Forces the test DB and
// test-only secrets so tests never touch the dev database from .env.
import { applyTestEnv } from './test-env';

applyTestEnv();
