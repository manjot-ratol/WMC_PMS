import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { DependencyUnavailableError } from '../../common/errors/app-error';
import {
  deadRedis,
  describeWithRedis,
  testRedis,
} from '../../../test/support/redis';
import { RedisRateLimiter } from './rate-limiter.service';

describeWithRedis('RedisRateLimiter (docker redis)', () => {
  let redis: Redis;
  const scope = `s-${randomUUID()}`;

  beforeAll(() => {
    redis = testRedis();
  });
  afterAll(() => redis.quit());

  it('allows up to the limit in a window, then denies with retryAfter', async () => {
    const limiter = new RedisRateLimiter(redis);
    const d1 = await limiter.consume(scope, 'fp', 2, 60);
    const d2 = await limiter.consume(scope, 'fp', 2, 60);
    const d3 = await limiter.consume(scope, 'fp', 2, 60);
    expect([d1.allowed, d2.allowed, d3.allowed]).toEqual([true, true, false]);
    expect(d1.remaining).toBe(1);
    expect(d2.remaining).toBe(0);
    expect(d3.retryAfterSeconds).toBeGreaterThan(0);
    expect(d3.retryAfterSeconds).toBeLessThanOrEqual(60);
    const other = await limiter.consume(scope, 'fp2', 2, 60);
    expect(other.allowed).toBe(true);
  });

  it('fails closed when Redis is unreachable', async () => {
    const dead = deadRedis();
    const limiter = new RedisRateLimiter(dead);
    await expect(limiter.consume(scope, 'fp', 1, 10)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
    dead.disconnect();
  });
});
