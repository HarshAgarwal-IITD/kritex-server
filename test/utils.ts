import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { type PrismaService } from '../src/prisma/prisma.service';

/** In-memory throttler storage whose counters can be wiped between tests. */
export class ResettableThrottlerStorage implements ThrottlerStorage {
  private inner = new ThrottlerStorageService();

  increment(...args: Parameters<ThrottlerStorage['increment']>) {
    return this.inner.increment(...args);
  }

  reset(): void {
    this.inner.onApplicationShutdown();
    this.inner = new ThrottlerStorageService();
  }
}

/** Boots the full AppModule exactly as main.ts does (minus listen). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue(new ResettableThrottlerStorage())
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every application table (keeps Prisma's migration history). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  // Background work from the previous test (emails, invoices after order.paid) can still hold row
  // locks, so the TRUNCATE may deadlock; retry briefly instead of failing the next test.
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      return;
    } catch (err) {
      const deadlock = err instanceof Error && /40P01|deadlock/.test(err.message);
      if (!deadlock || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

/** Clears rate-limit counters so tests don't throttle each other. */
export function resetThrottler(app: INestApplication): void {
  app.get<ResettableThrottlerStorage>(ThrottlerStorage).reset();
}
