import { validateEnv } from './env.validation';

const base: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://wmc:wmc@localhost:5432/wmc_pms',
  REDIS_URL: 'redis://localhost:6380/0',
  INTERNAL_SERVICE_TOKEN: 'internal-token',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  FINGERPRINT_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  OTP_HMAC_KEY: Buffer.alloc(32, 3).toString('base64'),
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.APP_ENV).toBe('local');
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.OTP_RESEND_AFTER_SECONDS).toBe(30);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.DIGIO_BASE_URL).toBe('https://ext.digio.in:444');
    expect(env.CLEVERTAP_ENABLED).toBe(false);
  });

  it('rejects when DATABASE_URL is missing and names it', () => {
    const rest = { ...base };
    delete rest.DATABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-base64 or wrong-length FIELD_ENCRYPTION_KEY', () => {
    expect(() =>
      validateEnv({ ...base, FIELD_ENCRYPTION_KEY: 'not-base64!!' }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(() =>
      validateEnv({
        ...base,
        FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('collects every error in one throw', () => {
    const rest = { ...base };
    delete rest.DATABASE_URL;
    delete rest.REDIS_URL;
    let message = '';
    try {
      validateEnv({ ...rest, PORT: 'abc' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).toMatch(/PORT/);
  });

  it('coerces numeric and boolean strings', () => {
    const env = validateEnv({
      ...base,
      PORT: '4001',
      CLEVERTAP_ENABLED: 'true',
    });
    expect(env.PORT).toBe(4001);
    expect(env.CLEVERTAP_ENABLED).toBe(true);
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'staging' })).toThrow(
      /APP_ENV/,
    );
  });
});
