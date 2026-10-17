import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

const trimUrl = (u: string) => u.replace(/\/+$/, '');

export const partnersConfig = registerAs('partners', () => {
  const e = env();
  return {
    digio: {
      baseUrl: trimUrl(e.DIGIO_BASE_URL),
      clientId: e.DIGIO_CLIENT_ID,
      clientSecret: e.DIGIO_CLIENT_SECRET,
      timeoutMs: e.DIGIO_TIMEOUT_MS,
      webhookSecret: e.DIGIO_WEBHOOK_SECRET,
    },
    trackwizz: {
      baseUrl: trimUrl(e.TRACKWIZZ_BASE_URL),
      apiToken: e.TRACKWIZZ_API_TOKEN,
      cluster: e.TRACKWIZZ_CLUSTER,
      domain: e.TRACKWIZZ_DOMAIN,
      sourceSystemName: e.TRACKWIZZ_SOURCE_SYSTEM_NAME,
      ourPrivateKeyPem: e.TRACKWIZZ_OUR_PRIVATE_KEY_PEM,
      theirPublicKeyPem: e.TRACKWIZZ_THEIR_PUBLIC_KEY_PEM,
      timeoutMs: e.TRACKWIZZ_TIMEOUT_MS,
    },
    mfcentral: {
      baseUrl: trimUrl(e.MFCENTRAL_BASE_URL),
      clientId: e.MFCENTRAL_CLIENT_ID,
      clientSecret: e.MFCENTRAL_CLIENT_SECRET,
      username: e.MFCENTRAL_USERNAME,
      password: e.MFCENTRAL_PASSWORD,
      encryptionKey: e.MFCENTRAL_ENCRYPTION_KEY,
      privateJwk: e.MFCENTRAL_PRIVATE_JWK,
      timeoutMs: e.MFCENTRAL_TIMEOUT_MS,
    },
    ignosis: { timeoutMs: 30000 },
    clevertap: {
      enabled: e.CLEVERTAP_ENABLED,
      baseUrl: trimUrl(e.CLEVERTAP_BASE_URL),
      accountId: e.CLEVERTAP_ACCOUNT_ID,
      passcode: e.CLEVERTAP_PASSCODE,
      timeoutMs: 10000,
    },
    messaging: {
      smtpHost: e.SMTP_HOST,
      smtpPort: e.SMTP_PORT,
      from: e.MAIL_FROM,
      timeoutMs: 10000,
    },
  };
});
export type PartnersConfig = ReturnType<typeof partnersConfig>;
