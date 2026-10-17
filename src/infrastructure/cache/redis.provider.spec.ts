import { RedisConnection } from './redis.provider';
import { describeWithRedis, deadRedis } from '../../../test/support/redis';
import { loadTestEnv } from '../../../test/support/env';

describeWithRedis('RedisConnection (docker redis)', () => {
  it('pings the live server and closes cleanly', async () => {
    loadTestEnv();
    const conn = new RedisConnection({ url: process.env.REDIS_URL! });
    await expect(conn.ping()).resolves.toBe(true);
    await conn.onModuleDestroy();
  });

  it('reports false when the server does not answer PONG', async () => {
    const conn = new RedisConnection({ url: process.env.REDIS_URL! });
    jest.spyOn(conn.client, 'ping').mockResolvedValue('NOPE');
    await expect(conn.ping()).resolves.toBe(false);
    await conn.onModuleDestroy();
  });

  it('dead connection rejects ping', async () => {
    const dead = deadRedis();
    await expect(dead.ping()).rejects.toThrow();
    dead.disconnect();
  });
});
