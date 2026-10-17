import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { describeWithRedis, testRedis } from '../../../test/support/redis';
import { RedisKvStore } from './kv-store.service';

describeWithRedis('RedisKvStore (docker redis)', () => {
  let redis: Redis;
  let kv: RedisKvStore;
  const k = (s: string) => `kv-${randomUUID()}-${s}`;

  beforeAll(() => {
    redis = testRedis();
    kv = new RedisKvStore(redis);
  });
  afterAll(() => redis.quit());

  it('set/get json with ttl', async () => {
    const key = k('a');
    await kv.setJson(key, { n: 1, s: 'x' }, 30);
    expect(await kv.getJson(key)).toEqual({ n: 1, s: 'x' });
    expect(await kv.ttl(key)).toBeGreaterThan(0);
    await kv.del(key);
    expect(await kv.getJson(key)).toBeNull();
  });

  it('getAndDelJson returns the value exactly once', async () => {
    const key = k('b');
    await kv.setJson(key, { once: true }, 30);
    expect(await kv.getAndDelJson(key)).toEqual({ once: true });
    expect(await kv.getAndDelJson(key)).toBeNull();
  });

  it('incr preserves ttl and counts', async () => {
    const key = k('c');
    await kv.setJson(key, 0, 30);
    expect(await kv.incr(key)).toBe(1);
    expect(await kv.incr(key)).toBe(2);
    expect(await kv.ttl(key)).toBeGreaterThan(0);
  });
});
