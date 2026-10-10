import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
};

const razorpay = {
  RAZORPAY_KEY_ID: 'rzp_test_abc',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsecret',
};

const shiprocket = {
  SHIPROCKET_EMAIL: 'ops@kritex.in',
  SHIPROCKET_PASSWORD: 'pw',
  SHIPROCKET_WEBHOOK_TOKEN: 'webhook-token-123',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 4000,
      CORS_ORIGIN: ['http://localhost:8080'],
      BUSINESS_STATE_CODE: '27',
      CART_GUEST_TTL_DAYS: 30,
      GST_DEFAULT_RATE: 18,
      GST_SLAB_HSN_PREFIXES: ['61', '62', '63', '64'],
      GST_SLAB_THRESHOLD_PAISE: 250000,
      GST_SLAB_LOW_RATE: 5,
      GST_SLAB_HIGH_RATE: 18,
      SHIPPING_FLAT_FEE_PAISE: 9900,
      SHIPPING_FREE_THRESHOLD_PAISE: 99900,
      ORDER_PAYMENT_TIMEOUT_MINUTES: 15,
      RETAIL_MAX_LINE_QUANTITY: 10,
      MAX_UNPAID_ORDERS: 5,
      BANK_TRANSFER_HOLD_DAYS: 7,
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:8080',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      MAIL_FROM: 'Kritex <no-reply@kritex.in>',
      STAFF_ALERT_EMAILS: ['kritex.jdp@gmail.com'],
      INVOICE_PREFIX: 'KTX',
      SELLER_LEGAL_NAME: 'Kritex (legal name TBC)',
      SELLER_ADDRESS: 'Address TBC|Mumbai, Maharashtra',
      SHIPROCKET_API_URL: 'https://apiv2.shiprocket.in/v1/external',
      SHIPROCKET_PICKUP_LOCATION: 'Primary',
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
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('requires BETTER_AUTH_SECRET (>= 32 chars) in production only', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: 'short' }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    const secret = 'x'.repeat(32);
    expect(
      validateEnv({
        ...base,
        ...razorpay,
        ...shiprocket,
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: secret,
      }),
    ).toEqual(expect.objectContaining({ BETTER_AUTH_SECRET: secret }));
  });

  it('refuses to boot in production with the fake payment gateway (no RAZORPAY_KEY_ID)', () => {
    const prod = { ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(32) };
    expect(() => validateEnv({ ...prod, ...shiprocket })).toThrow(/RAZORPAY_KEY_ID/);
    expect(validateEnv({ ...prod, ...razorpay, ...shiprocket })).toEqual(
      expect.objectContaining({ RAZORPAY_KEY_ID: 'rzp_test_abc' }),
    );
  });

  it('requires the Razorpay secrets together with the key id', () => {
    expect(() => validateEnv({ ...base, RAZORPAY_KEY_ID: 'rzp_test_abc' })).toThrow(
      /RAZORPAY_KEY_SECRET/,
    );
    expect(validateEnv({ ...base, ORDER_PAYMENT_TIMEOUT_MINUTES: '15' })).toEqual(
      expect.objectContaining({ ORDER_PAYMENT_TIMEOUT_MINUTES: 15 }),
    );
    expect(validateEnv({ ...base, BANK_TRANSFER_HOLD_DAYS: '0' })).toEqual(
      expect.objectContaining({ BANK_TRANSFER_HOLD_DAYS: 0 }),
    );
    expect(() => validateEnv({ ...base, BANK_TRANSFER_HOLD_DAYS: '-1' })).toThrow(
      /BANK_TRANSFER_HOLD_DAYS/,
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

  it('production: Shiprocket optional, but its webhook token is required with it; password goes with email', () => {
    const prod = {
      ...base,
      ...razorpay,
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    };
    expect(validateEnv(prod)).not.toHaveProperty('SHIPROCKET_EMAIL');
    const { SHIPROCKET_WEBHOOK_TOKEN: _t, ...noToken } = shiprocket;
    expect(() => validateEnv({ ...prod, ...noToken })).toThrow(/SHIPROCKET_WEBHOOK_TOKEN/);
    expect(validateEnv({ ...prod, ...shiprocket })).toEqual(
      expect.objectContaining({ SHIPROCKET_EMAIL: 'ops@kritex.in' }),
    );
    expect(() => validateEnv({ ...base, SHIPROCKET_EMAIL: 'ops@kritex.in' })).toThrow(
      /SHIPROCKET_PASSWORD/,
    );
    expect(() => validateEnv({ ...base, INVOICE_PREFIX: 'ktx/1' })).toThrow(/INVOICE_PREFIX/);
  });
});
