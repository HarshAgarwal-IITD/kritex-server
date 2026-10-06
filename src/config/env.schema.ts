import { z } from 'zod';

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
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET !== undefined, {
    path: ['BETTER_AUTH_SECRET'],
    message: 'BETTER_AUTH_SECRET is required in production',
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
