import { z } from 'zod';
import { stateCodeSchema } from '../common/dto/india';

/** GST rate in percent with at most 2 decimals (e.g. 5, 18, 2.5). */
const envGstRate = z.coerce
  .number()
  .min(0)
  .max(40)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: 'GST rate may have at most 2 decimals',
  });
const envPaise = z.coerce.number().int().nonnegative();

/**
 * Environment variables, validated once at boot. The app refuses to start if
 * anything here is missing or malformed.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), {
      message: 'DATABASE_URL must be a postgresql:// connection string',
    }),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:8080')
    .transform((v) =>
      v
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  /** Temporary static key for admin routes; replaced by real auth in Stage 2. */
  ADMIN_API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  // ---- Pricing (src/pricing; ADR-005, ADR-006). All money in paise. ----
  /** Seller's registered GST state code (Q9 placeholder until the CA confirms). */
  BUSINESS_STATE_CODE: stateCodeSchema.default('27'),
  /** Rate for products with no gstRate whose HSN is not slab-ruled. */
  GST_DEFAULT_RATE: envGstRate.default(18),
  /** Comma-separated HSN prefixes whose rate follows the price slab (apparel 61/62, made-ups 63, footwear 64). */
  GST_SLAB_HSN_PREFIXES: z
    .string()
    .default('61,62,63,64')
    .transform((v) =>
      v
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    )
    .refine((list) => list.every((p) => /^\d{2,8}$/.test(p)), {
      message: 'GST_SLAB_HSN_PREFIXES must be comma-separated digit prefixes',
    }),
  /** Per-unit taxable value (ex-GST) at or below which the low slab rate applies. */
  GST_SLAB_THRESHOLD_PAISE: envPaise.default(250000),
  GST_SLAB_LOW_RATE: envGstRate.default(5),
  GST_SLAB_HIGH_RATE: envGstRate.default(18),
  /** Flat shipping fee, GST-inclusive. */
  SHIPPING_FLAT_FEE_PAISE: envPaise.default(9900),
  /** Orders whose merchandise total after discount is >= this ship free. */
  SHIPPING_FREE_THRESHOLD_PAISE: envPaise.default(99900),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
