import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { JOB_PUBLISHER } from '../../application/ports/job-publisher.port';
import { REDIS } from '../cache/redis.provider';
import { EventRouter } from './event-router';
import { BullJobPublisher } from './job-publisher';
import { OutboxDispatcherProcessor } from './outbox-dispatcher.processor';
import { OutboxDispatcherScheduler } from './outbox-dispatcher.scheduler';
import { QueueRegistry } from './queue-registry';

/**
 * forApi(): publishers only. forWorker(): publishers plus processors and the outbox scheduler.
 */
@Global()
@Module({})
export class QueueModule {
  private static core(): DynamicModule['providers'] {
    return [
      {
        provide: QueueRegistry,
        inject: [REDIS],
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
      exports: [QueueRegistry, EventRouter, JOB_PUBLISHER],
    };
  }

  static forWorker(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          inject: [REDIS],
          useFactory: (redis: Redis) => ({ connection: redis }),
        }),
        BullModule.registerQueue({ name: 'outbox-dispatch' }),
      ],
      providers: [
        ...(QueueModule.core() ?? []),
        OutboxDispatcherProcessor,
        OutboxDispatcherScheduler,
      ],
      exports: [QueueRegistry, EventRouter, JOB_PUBLISHER],
    };
  }
}
