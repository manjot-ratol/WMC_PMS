import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueueRegistry } from './queue-registry';
import { QUEUES } from './queue.names';

export const OUTBOX_TICK_JOB = 'tick';
export const OUTBOX_TICK_EVERY_MS = 2_000;
export const OUTBOX_BATCH_LIMIT = 50;

/** Registers the repeatable outbox tick once; BullMQ dedupes by jobId. Worker process only. */
@Injectable()
export class OutboxDispatcherScheduler implements OnModuleInit {
  constructor(private readonly queues: QueueRegistry) {}

  async onModuleInit(): Promise<void> {
    await this.queues.get(QUEUES.OUTBOX).add(
      OUTBOX_TICK_JOB,
      { correlationId: 'scheduler', payload: { limit: OUTBOX_BATCH_LIMIT } },
      {
        repeat: { every: OUTBOX_TICK_EVERY_MS },
        jobId: 'outbox-tick',
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
