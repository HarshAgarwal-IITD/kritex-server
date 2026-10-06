/**
 * Writes the OpenAPI contract to ./openapi.json (or verifies it with --check).
 *
 *   npm run openapi:export   regenerate openapi.json (commit the result)
 *   npm run openapi:check    exit 1 if openapi.json is stale
 *
 * Needs no database: the Nest app is created but never initialised
 * (`app.init()` / `listen()` are not called), so PrismaService.onModuleInit
 * never runs and nothing connects.
 */
import './openapi-env';
import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/app.setup';

const OUTPUT = resolve(__dirname, '..', 'openapi.json');

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Recursively sort object keys so the output is stable regardless of registration order quirks. */
function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(app);
  const document = buildOpenApiDocument(app);
  const json = `${JSON.stringify(sortKeys(document as unknown as Json), null, 2)}\n`;

  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== json) {
      console.error(
        'openapi.json is out of date. Run `npm run openapi:export` and commit the result.',
      );
      process.exitCode = 1;
    } else {
      console.log('openapi.json is up to date.');
    }
  } else {
    writeFileSync(OUTPUT, json);
    console.log(`Wrote ${OUTPUT}`);
  }
}

main()
  .then(() => process.exit())
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
