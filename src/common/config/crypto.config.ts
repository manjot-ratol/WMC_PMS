import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const cryptoConfig = registerAs('crypto', () => ({
  fieldKeyId: env().FIELD_ENCRYPTION_KEY_ID,
  fieldKeyBase64: env().FIELD_ENCRYPTION_KEY,
  fingerprintKeyBase64: env().FINGERPRINT_HMAC_KEY,
  otpHmacKeyBase64: env().OTP_HMAC_KEY,
}));
export type CryptoConfig = ReturnType<typeof cryptoConfig>;
