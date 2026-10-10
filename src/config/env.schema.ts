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
export const envSchema = z
  .object({
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
    /**
     * Better Auth signing/encryption secret (>= 32 chars, e.g. `openssl rand -base64 32`).
     * Required in production; dev/test fall back to a fixed, publicly known value.
     */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    /**
     * Public origin the API is reached at (no path). Used for links in auth emails and to decide
     * whether cookies get the `__Secure-` prefix (https). Dev: the API itself, or the Vite proxy.
     */
    BETTER_AUTH_URL: z.url().default('http://localhost:4000'),
    /** Storefront origin: default redirect target for verification / password-reset links. */
    WEB_URL: z.url().default('http://localhost:8080'),
    /** Cookie domain shared by the storefront and API in production, e.g. `.kritex.in`. */
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    /**
     * "Continue with Google" (OAuth client from Google Cloud console). Both set = enabled. The
     * authorised redirect URI is `<BETTER_AUTH_URL>/api/v1/auth/callback/google`.
     */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    /** SMTP for auth emails (dev: Mailpit on :1025). Unset = emails are only logged. */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    MAIL_FROM: z.string().min(1).default('Kritex <no-reply@kritex.in>'),
    /**
     * Number of reverse proxies in front of the app (Express `trust proxy`), so `req.ip` and rate
     * limits see the client IP. Unset locally; 1 on Render.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).optional(),

    // ---- Uploads (CAT-6). Default driver `local` stores files on disk, served from /api/v1/uploads/local. ----
    STORAGE_DRIVER: z.enum(['local', 'r2']).optional(),
    /** Local driver: directory for uploaded files (default `uploads`, relative to the working directory). */
    UPLOADS_DIR: z.string().min(1).optional(),
    /** Local driver: origin prefixed to upload/public URLs. Empty = same-origin relative URLs. */
    UPLOADS_BASE_URL: z.string().optional(),
    /** R2 driver (all required when STORAGE_DRIVER=r2; checked when the driver is created). */
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    /** Public (CDN / r2.dev / custom domain) base URL of the bucket, e.g. https://cdn.kritex.in */
    R2_PUBLIC_URL: z.string().url().optional(),

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
    // ---- Cart (COM-1) ----
    /** Guest cart lifetime: `kritex_cart` cookie max-age, and guest carts untouched this long are purged daily. */
    CART_GUEST_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    // ---- Payments (ADR-003). Unset RAZORPAY_KEY_ID = FakeGateway (dev/test only; refused in production). ----
    RAZORPAY_KEY_ID: z.string().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
    /** Secret set on the Razorpay dashboard webhook; signs `x-razorpay-signature`. */
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** Unpaid PENDING_PAYMENT orders are cancelled (stock released) after this many minutes. */
    ORDER_PAYMENT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    /** Bank transfer instructions for approved B2B orders. All four set = BANK_TRANSFER offered. */
    BANK_TRANSFER_ACCOUNT_NAME: z.string().min(1).optional(),
    BANK_TRANSFER_ACCOUNT_NUMBER: z.string().min(1).optional(),
    BANK_TRANSFER_IFSC: z.string().min(1).optional(),
    BANK_TRANSFER_BANK_NAME: z.string().min(1).optional(),
    /** AWAITING_PAYMENT (bank transfer) orders hold their stock this many days, then are cancelled. 0 = hold forever. */
    BANK_TRANSFER_HOLD_DAYS: z.coerce.number().int().min(0).max(90).default(7),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    // ---- Notifications (OPS-1). RESEND_API_KEY set = emails go through Resend; else SMTP / log. ----
    RESEND_API_KEY: z.string().min(1).optional(),

    // ---- GST invoices (OPS-2; ADR-006). Seller details are PLACEHOLDERS until the CA confirms (Q9). ----
    /** Invoice number prefix: `<prefix>/<FY>/<seq>`, e.g. KTX/2026-27/00001. */
    INVOICE_PREFIX: z
      .string()
      .regex(/^[A-Z0-9-]{1,10}$/)
      .default('KTX'),
    SELLER_LEGAL_NAME: z.string().min(1).default('Kritex (legal name TBC)'),
    /** Seller GSTIN printed on invoices. Unset = "GSTIN: TBC" (dev only). */
    SELLER_GSTIN: z.string().min(1).optional(),
    /** Seller address, lines separated by `|`. */
    SELLER_ADDRESS: z.string().min(1).default('Address TBC|Mumbai, Maharashtra'),
    SELLER_EMAIL: z.string().min(1).optional(),
    SELLER_PHONE: z.string().min(1).optional(),

    // ---- Shipping (OPS-3; ADR-005). Unset SHIPROCKET_EMAIL = fake provider in dev/test; in production, manual shipping only. ----
    SHIPROCKET_EMAIL: z.string().min(1).optional(),
    SHIPROCKET_PASSWORD: z.string().min(1).optional(),
    SHIPROCKET_API_URL: z.url().default('https://apiv2.shiprocket.in/v1/external'),
    /** Default Shiprocket pickup location nickname (Settings → Pickup addresses). */
    SHIPROCKET_PICKUP_LOCATION: z.string().min(1).default('Primary'),
    /** Token Shiprocket sends in `x-api-key` on tracking webhooks. Dev/test default: `fake-shiprocket-token`. */
    SHIPROCKET_WEBHOOK_TOKEN: z.string().min(8).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET !== undefined, {
    path: ['BETTER_AUTH_SECRET'],
    message: 'BETTER_AUTH_SECRET is required in production',
  })
  .refine(
    (env) =>
      env.RAZORPAY_KEY_ID === undefined ||
      (env.RAZORPAY_KEY_SECRET !== undefined && env.RAZORPAY_WEBHOOK_SECRET !== undefined),
    {
      path: ['RAZORPAY_KEY_SECRET'],
      message: 'RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required with RAZORPAY_KEY_ID',
    },
  )
  .refine(
    (env) => (env.GOOGLE_CLIENT_ID === undefined) === (env.GOOGLE_CLIENT_SECRET === undefined),
    {
      path: ['GOOGLE_CLIENT_SECRET'],
      message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    },
  )
  .refine((env) => env.SHIPROCKET_EMAIL === undefined || env.SHIPROCKET_PASSWORD !== undefined, {
    path: ['SHIPROCKET_PASSWORD'],
    message: 'SHIPROCKET_PASSWORD is required with SHIPROCKET_EMAIL',
  })
  // Shiprocket is optional (staff can ship manually); when it is configured in production the
  // webhook needs its own token (the fake token is dev/test only).
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      env.SHIPROCKET_EMAIL === undefined ||
      env.SHIPROCKET_WEBHOOK_TOKEN !== undefined,
    {
      path: ['SHIPROCKET_WEBHOOK_TOKEN'],
      message: 'SHIPROCKET_WEBHOOK_TOKEN is required in production when SHIPROCKET_EMAIL is set',
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.RAZORPAY_KEY_ID !== undefined, {
    path: ['RAZORPAY_KEY_ID'],
    message:
      'RAZORPAY_KEY_ID is required in production (the fake payment gateway is dev/test only)',
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // An empty value means "not set" (so `FOO=` in a .env, or a blanked var, falls back to the default).
  const env = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
