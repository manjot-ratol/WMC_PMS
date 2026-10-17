import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { cryptoConfig } from './crypto.config';
import { databaseConfig } from './database.config';
import { resetEnvCache } from './env.validation';
import { partnersConfig } from './partners.config';
import { redisConfig } from './redis.config';
import { storageConfig } from './storage.config';

describe('config namespaces', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    resetEnvCache();
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://u:p@h:5432/db',
      REDIS_URL: 'redis://h:6380/1',
      INTERNAL_SERVICE_TOKEN: 'internal-token',
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      FINGERPRINT_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
      OTP_HMAC_KEY: Buffer.alloc(32, 3).toString('base64'),
      PORT: '3100',
      DIGIO_CLIENT_ID: 'id',
      DIGIO_CLIENT_SECRET: 'secret',
      DIGIO_BASE_URL: 'https://ext.digio.in:444/',
      TRACKWIZZ_CLUSTER: 'CL1_User',
    });
  });
  afterAll(() => {
    process.env = saved;
    resetEnvCache();
  });

  it('reads validated values into typed namespaces', () => {
    expect(appConfig().port).toBe(3100);
    expect(appConfig().internalServiceToken).toBe('internal-token');
    expect(databaseConfig().url).toBe('postgresql://u:p@h:5432/db');
    expect(redisConfig().url).toBe('redis://h:6380/1');
    expect(storageConfig().bucket).toBe('pms-documents');
    expect(authConfig().otpTtlSeconds).toBe(300);
    expect(cryptoConfig().fieldKeyId).toBe('k1');
    expect(cryptoConfig().fieldKeyBase64).toBe(
      Buffer.alloc(32, 1).toString('base64'),
    );
  });

  it('strips trailing slash from partner base urls', () => {
    expect(partnersConfig().digio.baseUrl).toBe('https://ext.digio.in:444');
    expect(partnersConfig().trackwizz.cluster).toBe('CL1_User');
  });
});
