import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { KEY_PREFIX } from '../../application/ports/kv-store.port';
import type { LockPort } from '../../application/ports/lock.port';
import { LockUnavailableError } from '../../common/errors/app-error';
import { failClosed } from './redis-errors';
import { REDIS } from './redis.provider';

// Release only if we still own the lock (token match), so an expired lock re-acquired by someone else is left alone.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

@Injectable()
export class RedisLockService implements LockPort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const redisKey = `${KEY_PREFIX.lock}${key}`;
    const token = randomUUID();
    const acquired = await failClosed('lock.acquire', () =>
      this.redis.set(redisKey, token, 'PX', ttlMs, 'NX'),
    );
    if (acquired !== 'OK')
      throw new LockUnavailableError(undefined, { details: { key } });
    try {
      return await fn();
    } finally {
      await this.redis
        .eval(RELEASE_SCRIPT, 1, redisKey, token)
        .catch(() => undefined);
    }
  }
}
