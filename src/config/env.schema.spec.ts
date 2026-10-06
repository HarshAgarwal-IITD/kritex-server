import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 4000,
      CORS_ORIGIN: ['http://localhost:8080'],
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:8080',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      MAIL_FROM: 'Kritex <no-reply@kritex.in>',
    });
  });

  it('coerces PORT and splits/trims CORS_ORIGIN', () => {
    const env = validateEnv({
      ...base,
      PORT: '5000',
      CORS_ORIGIN: 'http://localhost:8080, https://kritex.in ,',
    });
    expect(env.PORT).toBe(5000);
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:8080', 'https://kritex.in']);
  });

  it('rejects missing or invalid values with a readable message', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('requires BETTER_AUTH_SECRET (>= 32 chars) in production only', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: 'short' }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    const secret = 'x'.repeat(32);
    expect(validateEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: secret })).toEqual(
      expect.objectContaining({ BETTER_AUTH_SECRET: secret }),
    );
  });

  it('parses SMTP settings', () => {
    const env = validateEnv({
      ...base,
      SMTP_HOST: 'localhost',
      SMTP_PORT: '2525',
      SMTP_SECURE: 'true',
    });
    expect(env).toEqual(
      expect.objectContaining({ SMTP_HOST: 'localhost', SMTP_PORT: 2525, SMTP_SECURE: true }),
    );
  });
});
