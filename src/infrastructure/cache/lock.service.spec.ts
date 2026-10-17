import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { LockUnavailableError } from '../../common/errors/app-error';
import { describeWithRedis, testRedis } from '../../../test/support/redis';
import { RedisLockService } from './lock.service';

describeWithRedis('RedisLockService (docker redis)', () => {
  let redis: Redis;
  let lock: RedisLockService;
  const key = `t-${randomUUID()}`;

  beforeAll(() => {
    redis = testRedis();
    lock = new RedisLockService(redis);
  });
  afterAll(() => redis.quit());

  it('rejects a second holder while held and allows after release', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = lock.withLock(key, 5000, async () => {
      await gate;
      return 'first';
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      lock.withLock(key, 5000, () => Promise.resolve('second')),
    ).rejects.toBeInstanceOf(LockUnavailableError);
    release();
    await expect(first).resolves.toBe('first');
    await expect(
      lock.withLock(key, 5000, () => Promise.resolve('third')),
    ).resolves.toBe('third');
  });

  it('releases the lock even when fn throws', async () => {
    await expect(
      lock.withLock(key, 5000, () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(await redis.exists(`lock:${key}`)).toBe(0);
  });

  it('does not release a lock it no longer owns (ttl expired, re-acquired by another)', async () => {
    await lock.withLock(key, 30, async () => {
      await new Promise((r) => setTimeout(r, 60)); // our token expires
      await redis.set(`lock:${key}`, 'someone-else', 'PX', 5000);
    });
    expect(await redis.get(`lock:${key}`)).toBe('someone-else');
    await redis.del(`lock:${key}`);
  });
});
