import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import {
  ANALYTICS_OUTBOX,
  ANALYTICS_PROPERTY_ALLOWLIST,
  ANALYTICS_SINK,
  type AnalyticsOutboxPort,
  type AnalyticsOutboxRow,
  type AnalyticsSinkPort,
} from '../../application/ports/analytics-outbox.port';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { DependencyUnavailableError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import { BaseProcessor } from '../queue/base.processor';
import { QUEUES } from '../queue/queue.names';

export interface AnalyticsTick {
  limit: number;
}
export interface AnalyticsTickResult {
  claimed: number;
  dispatched: number;
  failed: number;
  stripped: number;
}
const ALLOW = new Set<string>(ANALYTICS_PROPERTY_ALLOWLIST);

/** Worker tick: claims undispatched analytics rows, re-applies the allowlist, uploads, records the sink's verdict. */
@Processor(QUEUES.ANALYTICS)
export class AnalyticsDispatcherProcessor extends BaseProcessor<AnalyticsTick> {
  private readonly logger: AppLogger;
  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(ANALYTICS_OUTBOX) private readonly outbox: AnalyticsOutboxPort,
    @Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSinkPort,
  ) {
    super(store);
    this.logger = logger.child('AnalyticsDispatcher');
  }

  async handle(payload: AnalyticsTick): Promise<AnalyticsTickResult> {
    const rows = await this.outbox.claimUndispatched(payload.limit);
    const result: AnalyticsTickResult = {
      claimed: rows.length,
      dispatched: 0,
      failed: 0,
      stripped: 0,
    };
    if (!rows.length) return result;
    const events = rows.map((r) => {
      const { evtData, stripped } = this.sanitise(r);
      result.stripped += stripped;
      return {
        id: r.id,
        event: {
          identity: r.identity,
          objectId: r.identity ? undefined : objectIdOf(r.properties),
          evtName: r.eventName,
          ts: Math.floor(r.createdAt.getTime() / 1000),
          evtData,
        },
      };
    });
    try {
      const verdict = await this.sink.upload(events);
      await this.outbox.markDispatched(verdict.accepted);
      result.dispatched = verdict.accepted.length;
      for (const r of verdict.rejected) {
        await this.outbox.markDead(r.id, `rejected by sink: ${r.error}`);
        result.failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const r of rows) await this.outbox.markFailed(r.id, message);
      result.failed = rows.length;
      if (!(err instanceof DependencyUnavailableError))
        this.logger.error('analytics.dispatch_failed', { err });
      else
        this.logger.warn('analytics.sink_unavailable', { rows: rows.length });
    }
    this.logger.info('analytics.tick', { ...result });
    return result;
  }

  /** Defence in depth: anything outside the allowlist is dropped and reported as a privacy incident. */
  private sanitise(r: AnalyticsOutboxRow): {
    evtData: Record<string, unknown>;
    stripped: number;
  } {
    const evtData: Record<string, unknown> = {};
    let stripped = 0;
    for (const [k, v] of Object.entries(r.properties)) {
      if (ALLOW.has(k)) {
        if (v !== undefined && v !== null) evtData[k] = v;
      } else {
        stripped++;
        this.logger.error('analytics.privacy_incident', {
          eventName: r.eventName,
          outboxId: r.id,
          property: k,
        });
      }
    }
    return { evtData, stripped };
  }
}

function objectIdOf(properties: Record<string, unknown>): string {
  const id = properties['application_id'];
  return typeof id === 'string' && id ? id : 'anonymous';
}
