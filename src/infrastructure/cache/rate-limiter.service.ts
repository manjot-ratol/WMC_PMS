import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { KEY_PREFIX } from '../../application/ports/kv-store.port';
import type {
  RateLimitDecision,
  RateLimiterPort,
} from '../../application/ports/rate-limiter.port';
import { failClosed } from './redis-errors';
import { REDIS } from './redis.provider';

// Fixed window: INCR, set TTL on first hit, return [count, ttl].
const CONSUME_SCRIPT = `
local c = redis.call("incr", KEYS[1])
if c == 1 then redis.call("expire", KEYS[1], ARGV[1]) end
local t = redis.call("ttl", KEYS[1])
return {c, t}`;

@Injectable()
export class RedisRateLimiter implements RateLimiterPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(
    scope: string,
    fingerprint: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    const key = `${KEY_PREFIX.rateLimit}${scope}:${fingerprint}`;
    const [count, ttl] = await failClosed(
      'rateLimit.consume',
      () =>
        this.redis.eval(CONSUME_SCRIPT, 1, key, windowSeconds) as Promise<
          [number, number]
        >,
    );
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, ttl),
    };
  }
}
