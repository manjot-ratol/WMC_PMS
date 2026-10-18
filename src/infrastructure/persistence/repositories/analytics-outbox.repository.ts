import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AnalyticsEvent,
  AnalyticsPort,
} from '../../../application/ports/analytics.port';
import type {
  AnalyticsOutboxPort,
  AnalyticsOutboxRow,
} from '../../../application/ports/analytics-outbox.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { JOURNEY_VERSION } from '../../../domain/onboarding/screens';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

export const EVENT_SCHEMA_VERSION = '1';
export const ANALYTICS_MAX_ATTEMPTS = 10;

/** Writes allowlisted analytics events to the outbox in the caller's transaction. Nothing else can be attached. */
@Injectable()
export class AnalyticsOutboxRepository
  implements AnalyticsPort, AnalyticsOutboxPort
{
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

  async claimUndispatched(limit: number): Promise<AnalyticsOutboxRow[]> {
    const rows = await this.prisma.analyticsOutbox.findMany({
      where: { dispatchedAt: null, attempts: { lt: ANALYTICS_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      eventName: r.eventName,
      identity: r.identity ?? undefined,
      properties: r.properties as Record<string, unknown>,
      createdAt: r.createdAt,
      attempts: r.attempts,
    }));
  }
  async markDispatched(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.prisma.analyticsOutbox.updateMany({
      where: { id: { in: ids } },
      data: { dispatchedAt: new Date(), attempts: { increment: 1 } },
    });
  }
  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.analyticsOutbox.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
    });
  }
  async markDead(id: string, reason: string): Promise<void> {
    await this.prisma.analyticsOutbox.update({
      where: { id },
      data: {
        dispatchedAt: new Date(),
        attempts: ANALYTICS_MAX_ATTEMPTS,
        lastError: `dead: ${reason}`.slice(0, 1000),
      },
    });
  }
}
