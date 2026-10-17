import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import type { JobEnvelope } from './job-context';

/** Restores the correlation context before delegating to handle(). Subclasses add @Processor(queue). */
export abstract class BaseProcessor<T> extends WorkerHost {
  constructor(protected readonly store: CorrelationStore) {
    super();
  }

  process(job: Job<JobEnvelope<T>>): Promise<unknown> {
    const ctx = {
      correlationId: job.data.correlationId,
      requestId: `job:${job.id ?? 'unknown'}`,
    };
    return this.store.run(ctx, () => this.handle(job.data.payload, job));
  }

  abstract handle(payload: T, job: Job<JobEnvelope<T>>): Promise<unknown>;
}
