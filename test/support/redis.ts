import Redis from 'ioredis';
import { loadTestEnv } from './db';

/** Connects to the docker Redis test db (index 15). Callers flush only their own prefix. */
export function testRedis(): Redis {
  loadTestEnv();
  return new Redis(process.env.REDIS_URL!, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
  });
}

/** A client pointed at a closed port, for fail-closed tests. */
export function deadRedis(): Redis {
  return new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
}

export const describeWithRedis = process.env.SKIP_DB_TESTS
  ? describe.skip
  : describe;
