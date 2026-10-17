import { Injectable } from '@nestjs/common';
import type { InboxPort } from '../../../application/ports/inbox.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class InboxRepository implements InboxPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CorrelationStore,
  ) {}

  async insertIfNew(
    provider: string,
    eventKey: string,
    payload: unknown,
  ): Promise<{ inserted: boolean; id: string }> {
    try {
      const row = await this.prisma.integrationInbox.create({
        data: {
          provider,
          eventKey,
          payload: payload as Prisma.InputJsonValue,
          correlationId: this.store.getCorrelationId(),
        },
        select: { id: true },
      });
      return { inserted: true, id: row.id };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.integrationInbox.findUniqueOrThrow({
          where: { provider_eventKey: { provider, eventKey } },
          select: { id: true },
        });
        return { inserted: false, id: existing.id };
      }
      throw err;
    }
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.integrationInbox.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.integrationInbox.update({
      where: { id },
      data: { status: 'FAILED', lastError: error.slice(0, 1000) },
    });
  }
}
