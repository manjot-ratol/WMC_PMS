import { Injectable } from '@nestjs/common';
import type {
  AnalyticsSinkPort,
  AnalyticsUploadEvent,
  AnalyticsUploadResult,
} from '../../application/ports/analytics-outbox.port';
import { AppLogger } from '../../common/logging/logger.service';

/** Local sink: names and counts only, so even the log line carries no event properties. */
@Injectable()
export class LogAnalyticsSink implements AnalyticsSinkPort {
  private readonly logger: AppLogger;
  constructor(logger: AppLogger) {
    this.logger = logger.child('AnalyticsSink');
  }
  upload(
    events: { id: string; event: AnalyticsUploadEvent }[],
  ): Promise<AnalyticsUploadResult> {
    const counts: Record<string, number> = {};
    for (const e of events)
      counts[e.event.evtName] = (counts[e.event.evtName] ?? 0) + 1;
    this.logger.info('analytics.local_sink', {
      events: counts,
      total: events.length,
    });
    return Promise.resolve({ accepted: events.map((e) => e.id), rejected: [] });
  }
}
