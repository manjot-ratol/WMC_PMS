import { Global, Module } from '@nestjs/common';
import { KV_STORE } from '../../application/ports/kv-store.port';
import { LOCK } from '../../application/ports/lock.port';
import { RATE_LIMITER } from '../../application/ports/rate-limiter.port';
import { RedisKvStore } from './kv-store.service';
import { RedisLockService } from './lock.service';
import { RedisRateLimiter } from './rate-limiter.service';
import { REDIS, RedisConnection } from './redis.provider';

@Global()
@Module({
  providers: [
    RedisConnection,
    {
      provide: REDIS,
      inject: [RedisConnection],
      useFactory: (c: RedisConnection) => c.client,
    },
    { provide: LOCK, useClass: RedisLockService },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: KV_STORE, useClass: RedisKvStore },
  ],
  exports: [RedisConnection, REDIS, LOCK, RATE_LIMITER, KV_STORE],
})
export class CacheModule {}
