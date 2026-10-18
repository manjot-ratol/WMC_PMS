import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueueRegistry } from '../queue/queue-registry';
import { QUEUES } from '../queue/queue.names';

export const ANALYTICS_TICK_JOB = 'tick';
export const ANALYTICS_TICK_EVERY_MS = 5_000;
export const ANALYTICS_BATCH_LIMIT = 100;

/** Registers the repeatable analytics tick once (BullMQ dedupes by jobId). Worker process only. */
@Injectable()
export class AnalyticsDispatcherScheduler implements OnModuleInit {
  constructor(private readonly queues: QueueRegistry) {}
  async onModuleInit(): Promise<void> {
    await this.queues.get(QUEUES.ANALYTICS).add(
      ANALYTICS_TICK_JOB,
      {
        correlationId: 'scheduler',
        payload: { limit: ANALYTICS_BATCH_LIMIT },
      },
      {
        repeat: { every: ANALYTICS_TICK_EVERY_MS },
        jobId: 'analytics-tick',
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
