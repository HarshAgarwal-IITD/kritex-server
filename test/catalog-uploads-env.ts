import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Side-effect import: must come before anything that imports AppModule, because ConfigModule
 * validates (and caches) process.env when the module is first loaded.
 */
export const TEST_UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'kritex-e2e-uploads-'));
process.env.STORAGE_DRIVER = 'local';
process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
