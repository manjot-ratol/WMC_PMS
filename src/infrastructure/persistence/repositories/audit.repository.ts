import { Injectable } from '@nestjs/common';
import type {
  AuditEventInput,
  AuditPort,
} from '../../../application/ports/audit.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

/** Append-only by construction: no update or delete method exists. */
@Injectable()
export class AuditRepository implements AuditPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CorrelationStore,
  ) {}

  async append(event: AuditEventInput, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).auditEvent.create({
      data: {
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        correlationId: this.store.getCorrelationId(),
        details: event.details as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
