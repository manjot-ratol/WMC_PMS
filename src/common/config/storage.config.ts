import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const storageConfig = registerAs('storage', () => ({
  endpoint: env().STORAGE_ENDPOINT,
  accessKey: env().STORAGE_ACCESS_KEY,
  secretKey: env().STORAGE_SECRET_KEY,
  bucket: env().STORAGE_BUCKET,
  region: env().STORAGE_REGION,
  uploadUrlTtlSeconds: env().UPLOAD_URL_TTL_SECONDS,
}));
export type StorageConfig = ReturnType<typeof storageConfig>;
