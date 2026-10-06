import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  ADMIN_API_KEY: 'key',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 4000,
      CORS_ORIGIN: ['http://localhost:8080'],
      BUSINESS_STATE_CODE: '27',
      GST_DEFAULT_RATE: 18,
      GST_SLAB_HSN_PREFIXES: ['61', '62', '63', '64'],
      GST_SLAB_THRESHOLD_PAISE: 250000,
      GST_SLAB_LOW_RATE: 5,
      GST_SLAB_HIGH_RATE: 18,
      SHIPPING_FLAT_FEE_PAISE: 9900,
      SHIPPING_FREE_THRESHOLD_PAISE: 99900,
    });
  });

  it('parses and validates pricing values', () => {
    const env = validateEnv({
      ...base,
      BUSINESS_STATE_CODE: '29',
      GST_DEFAULT_RATE: '12.5',
      GST_SLAB_HSN_PREFIXES: '61, 62,,6403',
      SHIPPING_FLAT_FEE_PAISE: '4900',
    });
    expect(env.BUSINESS_STATE_CODE).toBe('29');
    expect(env.GST_DEFAULT_RATE).toBe(12.5);
    expect(env.GST_SLAB_HSN_PREFIXES).toEqual(['61', '62', '6403']);
    expect(env.SHIPPING_FLAT_FEE_PAISE).toBe(4900);
    expect(() => validateEnv({ ...base, BUSINESS_STATE_CODE: '99' })).toThrow(
      /BUSINESS_STATE_CODE/,
    );
    expect(() => validateEnv({ ...base, GST_SLAB_LOW_RATE: '5.125' })).toThrow(/GST_SLAB_LOW_RATE/);
    expect(() => validateEnv({ ...base, GST_SLAB_HSN_PREFIXES: '61,ab' })).toThrow(
      /GST_SLAB_HSN_PREFIXES/,
    );
    expect(() => validateEnv({ ...base, SHIPPING_FLAT_FEE_PAISE: '99.5' })).toThrow(
      /SHIPPING_FLAT_FEE_PAISE/,
    );
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

  it('coerces TRUST_PROXY to a hop count', () => {
    expect(validateEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
  });

  it('rejects missing or invalid values with a readable message', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*ADMIN_API_KEY/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });
});
