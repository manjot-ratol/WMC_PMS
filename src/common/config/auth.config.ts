import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const authConfig = registerAs('auth', () => ({
  sessionTtlSeconds: env().SESSION_TTL_SECONDS,
  preAuthTtlSeconds: env().PREAUTH_TTL_SECONDS,
  otpTtlSeconds: env().OTP_TTL_SECONDS,
  otpResendAfterSeconds: env().OTP_RESEND_AFTER_SECONDS,
  otpMaxAttempts: env().OTP_MAX_ATTEMPTS,
}));
export type AuthConfig = ReturnType<typeof authConfig>;
