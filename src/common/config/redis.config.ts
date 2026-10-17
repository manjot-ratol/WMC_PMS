import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const redisConfig = registerAs('redis', () => ({
  url: env().REDIS_URL,
}));
export type RedisConfig = ReturnType<typeof redisConfig>;
