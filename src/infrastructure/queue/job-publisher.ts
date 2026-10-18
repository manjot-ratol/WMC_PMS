import { Injectable } from '@nestjs/common';
import type {
  JobPublisherPort,
  PublishOptions,
} from '../../application/ports/job-publisher.port';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import type { JobEnvelope } from './job-context';
import { QueueRegistry } from './queue-registry';

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

@Injectable()
export class BullJobPublisher implements JobPublisherPort {
  constructor(
    private readonly store: CorrelationStore,
    private readonly queues: QueueRegistry,
  ) {}

  async publish<T>(
    queue: string,
    name: string,
    payload: T,
    opts: PublishOptions = {},
  ): Promise<void> {
    const data: JobEnvelope<T> = {
      correlationId: this.store.getCorrelationId(),
      payload,
    };
    await this.queues.get(queue).add(name, data, {
      ...DEFAULT_JOB_OPTIONS,
      // BullMQ rejects custom ids containing ':'
      jobId: opts.jobId?.replace(/:/g, '-'),
      delay: opts.delayMs,
    });
  }
}
