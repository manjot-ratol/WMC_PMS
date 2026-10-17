import { Global, Module } from '@nestjs/common';
import { AUDIT } from '../../application/ports/audit.port';
import { CLOCK } from '../../application/ports/clock.port';
import { ID_GENERATOR } from '../../application/ports/id-generator.port';
import { IDEMPOTENCY } from '../../application/ports/idempotency.port';
import { INBOX } from '../../application/ports/inbox.port';
import { OUTBOX } from '../../application/ports/outbox.port';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work.port';
import { PrismaService } from './prisma.service';
import { AuditRepository } from './repositories/audit.repository';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { InboxRepository } from './repositories/inbox.repository';
import { OutboxRepository } from './repositories/outbox.repository';
import { CryptoIdGenerator, SystemClock } from './system-clock';
import { PrismaUnitOfWork } from './unit-of-work';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: OUTBOX, useClass: OutboxRepository },
    { provide: INBOX, useClass: InboxRepository },
    { provide: IDEMPOTENCY, useClass: IdempotencyRepository },
    { provide: AUDIT, useClass: AuditRepository },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
  ],
  exports: [
    PrismaService,
    UNIT_OF_WORK,
    OUTBOX,
    INBOX,
    IDEMPOTENCY,
    AUDIT,
    CLOCK,
    ID_GENERATOR,
  ],
})
export class PersistenceModule {}
