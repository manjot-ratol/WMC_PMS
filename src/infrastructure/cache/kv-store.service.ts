import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { KvStorePort } from '../../application/ports/kv-store.port';
import { failClosed } from './redis-errors';
import { REDIS } from './redis.provider';

@Injectable()
export class RedisKvStore implements KvStorePort {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await failClosed('kv.set', () =>
      this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds),
    );
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await failClosed('kv.get', () => this.redis.get(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async del(key: string): Promise<void> {
    await failClosed('kv.del', () => this.redis.del(key));
  }

  async getAndDelJson<T>(key: string): Promise<T | null> {
    const raw = await failClosed('kv.getdel', () => this.redis.getdel(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async incr(key: string): Promise<number> {
    return failClosed('kv.incr', () => this.redis.incr(key));
  }

  async ttl(key: string): Promise<number> {
    return failClosed('kv.ttl', () => this.redis.ttl(key));
  }
}
