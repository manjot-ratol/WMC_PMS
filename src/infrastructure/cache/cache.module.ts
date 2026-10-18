import { Global, Module } from '@nestjs/common';
import { KV_STORE } from '../../application/ports/kv-store.port';
import { LOCK } from '../../application/ports/lock.port';
import { RATE_LIMITER } from '../../application/ports/rate-limiter.port';
import {
  PREAUTH_TOKEN_STORE,
  SESSION_STORE,
} from '../../application/ports/token-store.port';
import { RedisKvStore } from './kv-store.service';
import { RedisLockService } from './lock.service';
import { RedisPreAuthTokenStore } from './preauth-token.store';
import { RedisRateLimiter } from './rate-limiter.service';
import { RedisSessionStore } from './session.store';
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
    { provide: PREAUTH_TOKEN_STORE, useClass: RedisPreAuthTokenStore },
    { provide: SESSION_STORE, useClass: RedisSessionStore },
  ],
  exports: [
    RedisConnection,
    REDIS,
    LOCK,
    RATE_LIMITER,
    KV_STORE,
    PREAUTH_TOKEN_STORE,
    SESSION_STORE,
  ],
})
export class CacheModule {}
