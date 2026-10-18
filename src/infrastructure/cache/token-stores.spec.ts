import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { describeWithRedis, testRedis } from '../../../test/support/redis';
import { RedisKvStore } from './kv-store.service';
import { RedisPreAuthTokenStore } from './preauth-token.store';
import { RedisSessionStore } from './session.store';

describeWithRedis('token stores (docker redis)', () => {
  let redis: Redis;
  let kv: RedisKvStore;
  beforeAll(() => {
    redis = testRedis();
    kv = new RedisKvStore(redis);
  });
  afterAll(() => redis.quit());

  it('pre-auth tokens resolve to their binding, are opaque, and revoke', async () => {
    const store = new RedisPreAuthTokenStore(kv, { preAuthTtlSeconds: 60 });
    const token = await store.issue({
      purpose: 'PMS_ONBOARDING',
      phoneFingerprint: `fp-${randomUUID()}`,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const binding = await store.resolve(token);
    expect(binding?.purpose).toBe('PMS_ONBOARDING');
    expect(await redis.keys(`preauth:${token}`)).toHaveLength(0); // stored under a hash, not the token
    await store.revoke(token);
    expect(await store.resolve(token)).toBeNull();
    expect(await store.resolve('not-a-token')).toBeNull();
  });

  it('sessions issue/resolve/update/touch/revoke', async () => {
    const store = new RedisSessionStore(kv, { sessionTtlSeconds: 60 });
    const data = {
      sessionId: `ses_${randomUUID()}`,
      customerId: 'cus_1',
      applicationIds: ['app_1'],
    };
    const token = await store.issue(data);
    expect(await store.resolve(token)).toEqual(data);
    await store.update(token, { ...data, applicationIds: ['app_1', 'app_2'] });
    expect((await store.resolve(token))?.applicationIds).toEqual([
      'app_1',
      'app_2',
    ]);
    await store.touch(token);
    await store.touch('missing-token');
    await store.revoke(token);
    expect(await store.resolve(token)).toBeNull();
  });
});
