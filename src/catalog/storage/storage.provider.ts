import { Logger, type Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { LocalDiskStorageDriver } from './local-disk.driver';
import { R2StorageDriver } from './r2.driver';
import { STORAGE_DRIVER, type StorageDriver } from './storage.driver';

/** Builds the configured driver. Missing R2 settings fail at boot rather than on first upload. */
export function createStorageDriver(config: AppConfigService): StorageDriver {
  if ((config.get('STORAGE_DRIVER') ?? 'local') === 'r2') {
    const vars = {
      R2_ACCOUNT_ID: config.get('R2_ACCOUNT_ID'),
      R2_ACCESS_KEY_ID: config.get('R2_ACCESS_KEY_ID'),
      R2_SECRET_ACCESS_KEY: config.get('R2_SECRET_ACCESS_KEY'),
      R2_BUCKET: config.get('R2_BUCKET'),
      R2_PUBLIC_URL: config.get('R2_PUBLIC_URL'),
    };
    const missing = Object.entries(vars)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      throw new Error(
        `STORAGE_DRIVER=r2 needs every R2_* variable (missing: ${missing.join(', ')})`,
      );
    }
    return new R2StorageDriver({
      accountId: vars.R2_ACCOUNT_ID!,
      accessKeyId: vars.R2_ACCESS_KEY_ID!,
      secretAccessKey: vars.R2_SECRET_ACCESS_KEY!,
      bucket: vars.R2_BUCKET!,
      publicUrl: vars.R2_PUBLIC_URL!,
    });
  }
  if (config.isProduction) {
    new Logger('Storage').warn(
      'STORAGE_DRIVER=local in production: uploads go to local disk. Configure R2 (DEP-3).',
    );
  }
  return new LocalDiskStorageDriver(
    config.get('UPLOADS_DIR') ?? 'uploads',
    config.get('UPLOADS_BASE_URL') ?? '',
  );
}

export const storageDriverProvider: Provider = {
  provide: STORAGE_DRIVER,
  inject: [AppConfigService],
  useFactory: createStorageDriver,
};
