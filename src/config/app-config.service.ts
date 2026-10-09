import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Typed accessor over the validated env. Inject this instead of ConfigService. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    const value = this.config.get(key, { infer: true });
    // ConfigService falls back to raw process.env for keys the validated env left out; an empty
    // value there means "not set", as in validateEnv.
    return (value === '' ? undefined : value) as Env[K];
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
