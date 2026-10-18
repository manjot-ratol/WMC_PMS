import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AnalyticsEvent,
  AnalyticsPort,
} from '../../../application/ports/analytics.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { JOURNEY_VERSION } from '../../../domain/onboarding/screens';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

export const EVENT_SCHEMA_VERSION = '1';

/** Writes allowlisted analytics events to the outbox in the caller's transaction. Nothing else can be attached. */
@Injectable()
export class AnalyticsOutboxRepository implements AnalyticsPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CorrelationStore,
  ) {}

  async track(event: AnalyticsEvent, tx?: TransactionContext): Promise<void> {
    const properties = {
      event_id: randomUUID(),
      application_id: event.applicationId,
      screen_id: event.screenId,
      journey_version: JOURNEY_VERSION,
      event_schema_version: EVENT_SCHEMA_VERSION,
      event_source: 'backend',
      outcome: event.outcome,
      safe_error_category: event.safeErrorCategory,
      attempt_number: event.attemptNumber,
    };
    await clientOf(this.prisma, tx).analyticsOutbox.create({
      data: {
        eventName: event.name,
        identity: event.identity ?? null,
        properties: JSON.parse(JSON.stringify(properties)) as object,
        correlationId: this.store.getCorrelationId(),
      },
    });
  }
}
