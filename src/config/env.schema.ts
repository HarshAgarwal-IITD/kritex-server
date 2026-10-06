import { z } from 'zod';

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
  /**
   * Number of reverse proxies in front of the app (Express `trust proxy`), so `req.ip` and rate
   * limits see the client IP. Unset locally; 1 on Render.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

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
