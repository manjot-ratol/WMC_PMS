import { Injectable } from '@nestjs/common';
import {
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEventInput,
  type OutboxPort,
  type OutboxRow,
} from '../../../application/ports/outbox.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class OutboxRepository implements OutboxPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CorrelationStore,
  ) {}

  async add(event: OutboxEventInput, tx?: TransactionContext): Promise<string> {
    const row = await clientOf(this.prisma, tx).businessOutbox.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId: this.store.getCorrelationId(),
      },
      select: { id: true },
    });
    return row.id;
  }

  async claimBatch(limit: number): Promise<OutboxRow[]> {
    const rows = await this.prisma.businessOutbox.findMany({
      where: { dispatchedAt: null, attempts: { lt: OUTBOX_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      eventType: r.eventType,
      payload: r.payload as Record<string, unknown>,
      correlationId: r.correlationId,
      createdAt: r.createdAt,
      attempts: r.attempts,
    }));
  }

  async markDispatched(id: string): Promise<void> {
    await this.prisma.businessOutbox.update({
      where: { id },
      data: { dispatchedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  async markDead(id: string, reason: string): Promise<void> {
    await this.prisma.businessOutbox.update({
      where: { id },
      data: {
        dispatchedAt: new Date(),
        lastError: `dead: ${reason}`.slice(0, 1000),
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.businessOutbox.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 1000) },
    });
  }
}
