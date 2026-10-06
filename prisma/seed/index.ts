/**
 * `npx prisma db seed` (package.json "prisma.seed"). Idempotent: safe to run repeatedly.
 *
 * Env:
 *   SEED_PLACEHOLDER_PRICES=true   dev-only placeholder prices / HSN / GST / weights / stock
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_NAME   create (or promote) an ADMIN user
 *   SEED_ADMIN_PASSWORD            give that admin an email+password login (only if it has none)
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { loadCatalog } from './lib/catalog';
import { runSeed } from './lib/seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const email = process.env.SEED_ADMIN_EMAIL?.trim();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (password !== undefined && password.length < 8) {
      throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
    }
    await runSeed(prisma, {
      catalog: loadCatalog(),
      placeholderPrices: process.env.SEED_PLACEHOLDER_PRICES === 'true',
      admin: email
        ? {
            email,
            name: process.env.SEED_ADMIN_NAME?.trim() || 'Kritex Admin',
            passwordHash: password ? await hashPassword(password) : undefined,
          }
        : null,
      log: (message) => console.log(message),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
