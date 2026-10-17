import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConfig } from '../../common/config/redis.config';

export const REDIS = Symbol('REDIS');

export function createRedis(url: string): Redis {
  // Offline queue stays on so commands issued during the initial handshake wait instead of failing;
  // maxRetriesPerRequest keeps a dead server from hanging callers (they reject, and callers fail closed).
  return new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
}

/** Owns the shared ioredis connection used by locks, limits and the kv store. */
@Injectable()
export class RedisConnection implements OnModuleDestroy {
  readonly client: Redis;

  constructor(
    @Inject(redisConfig.KEY) cfg: Pick<ReturnType<typeof redisConfig>, 'url'>,
  ) {
    this.client = createRedis(cfg.url);
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
