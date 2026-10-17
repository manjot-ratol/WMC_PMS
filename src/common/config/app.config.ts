import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const appConfig = registerAs('app', () => ({
  env: env().APP_ENV,
  port: env().PORT,
  serviceName: env().SERVICE_NAME,
  logLevel: env().LOG_LEVEL,
  internalServiceToken: env().INTERNAL_SERVICE_TOKEN,
}));
export type AppConfig = ReturnType<typeof appConfig>;
