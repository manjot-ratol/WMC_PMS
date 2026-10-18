import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { JobPublisherPort } from '../../application/ports/job-publisher.port';
import { JOB_PUBLISHER } from '../../application/ports/job-publisher.port';
import type {
  OutboxPort,
  OutboxRow,
} from '../../application/ports/outbox.port';
import { OUTBOX } from '../../application/ports/outbox.port';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import { BaseProcessor } from './base.processor';
import { EventRouter } from './event-router';
import { QUEUES } from './queue.names';

export interface OutboxTick {
  limit: number;
}
export interface OutboxTickResult {
  claimed: number;
  dispatched: number;
  failed: number;
}

/** Moves committed outbox rows onto their queues. Each row is published under its own correlation id. */
@Processor(QUEUES.OUTBOX)
export class OutboxDispatcherProcessor extends BaseProcessor<OutboxTick> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(OUTBOX)
    private readonly outbox: Pick<
      OutboxPort,
      'claimBatch' | 'markDispatched' | 'markFailed' | 'markDead'
    >,
    @Inject(JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
    private readonly router: EventRouter,
  ) {
    super(store);
    this.logger = logger.child('OutboxDispatcher');
  }

  async handle(payload: OutboxTick): Promise<OutboxTickResult> {
    const rows = await this.outbox.claimBatch(payload.limit);
    const result: OutboxTickResult = {
      claimed: rows.length,
      dispatched: 0,
      failed: 0,
    };
    for (const row of rows) {
      const ok = await this.store.run(
        { correlationId: row.correlationId, requestId: `outbox:${row.id}` },
        () => this.dispatch(row),
      );
      if (ok) result.dispatched++;
      else result.failed++;
    }
    if (rows.length) this.logger.info('outbox.tick', { ...result });
    return result;
  }

  private async dispatch(row: OutboxRow): Promise<boolean> {
    const target = this.router.route(row.eventType);
    if (!target) {
      // No consumer registered for this event type: dead-letter it so it never blocks the queue.
      await this.outbox.markDead(row.id, `no route for ${row.eventType}`);
      this.logger.info('outbox.unrouted', {
        eventType: row.eventType,
        outboxId: row.id,
      });
      return false;
    }
    try {
      await this.publisher.publish(
        target.queue,
        target.jobName,
        {
          outboxId: row.id,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          payload: row.payload,
        },
        { jobId: row.id },
      );
      await this.outbox.markDispatched(row.id);
      return true;
    } catch (err) {
      await this.outbox.markFailed(
        row.id,
        err instanceof Error ? err.message : String(err),
      );
      this.logger.warn('outbox.publish_failed', {
        outboxId: row.id,
        eventType: row.eventType,
        err,
      });
      return false;
    }
  }
}
