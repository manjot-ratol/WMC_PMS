import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import { redisConfig } from '../../common/config/redis.config';
import { JOB_PUBLISHER } from '../../application/ports/job-publisher.port';

import { EventRouter } from './event-router';
import { BullJobPublisher } from './job-publisher';
import { OutboxDispatcherProcessor } from './outbox-dispatcher.processor';
import { OutboxDispatcherScheduler } from './outbox-dispatcher.scheduler';
import { QueueRegistry } from './queue-registry';

export const BULL_CONNECTION = Symbol('BULL_CONNECTION');

/** BullMQ requires maxRetriesPerRequest: null on its connections; keep it separate from the fail-fast app client. */
export function createBullConnection(url: string): Redis {
  return new Redis(url, bullConnectionOptions(url));
}

/**
 * Connection options (not an instance) for BullMQ workers: BullMQ then owns and closes every
 * connection it opens, so a worker shutdown leaves no sockets behind.
 */
export function bullConnectionOptions(url: string): RedisOptions {
  const u = new URL(url);
  const db = Number(u.pathname.replace('/', '') || '0');
  return {
    host: u.hostname,
    port: Number(u.port || '6379'),
    db: Number.isFinite(db) ? db : 0,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

/**
 * forApi(): publishers only. forWorker(): publishers plus processors and the outbox scheduler.
 */
@Global()
@Module({})
export class QueueModule {
  private static core(): DynamicModule['providers'] {
    return [
      {
        provide: BULL_CONNECTION,
        inject: [redisConfig.KEY],
        useFactory: (cfg: ReturnType<typeof redisConfig>) =>
          createBullConnection(cfg.url),
      },
      {
        provide: QueueRegistry,
        inject: [BULL_CONNECTION],
        useFactory: (redis: Redis) => new QueueRegistry(redis),
      },
      EventRouter,
      { provide: JOB_PUBLISHER, useClass: BullJobPublisher },
    ];
  }

  static forApi(): DynamicModule {
    return {
      module: QueueModule,
      providers: QueueModule.core(),
      exports: [QueueRegistry, EventRouter, JOB_PUBLISHER, BULL_CONNECTION],
    };
  }

  static forWorker(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [redisConfig.KEY],
          useFactory: (cfg: ReturnType<typeof redisConfig>) => ({
            connection: bullConnectionOptions(cfg.url),
          }),
        }),
        BullModule.registerQueue({ name: 'outbox-dispatch' }),
      ],
      providers: [
        ...(QueueModule.core() ?? []),
        OutboxDispatcherProcessor,
        OutboxDispatcherScheduler,
      ],
      exports: [QueueRegistry, EventRouter, JOB_PUBLISHER, BULL_CONNECTION],
    };
  }
}
