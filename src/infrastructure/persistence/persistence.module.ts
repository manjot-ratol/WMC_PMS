import { Global, Module } from '@nestjs/common';
import { ANALYTICS } from '../../application/ports/analytics.port';
import { APPLICATION_REPOSITORY } from '../../application/ports/application.repository.port';
import { AUDIT } from '../../application/ports/audit.port';
import { CHALLENGE_REPOSITORY } from '../../application/ports/challenge.repository.port';
import { CUSTOMER_REPOSITORY } from '../../application/ports/customer.repository.port';
import { ELIGIBILITY_REPOSITORY } from '../../application/ports/eligibility.repository.port';
import { SESSION_REPOSITORY } from '../../application/ports/session.repository.port';
import { CLOCK } from '../../application/ports/clock.port';
import { ID_GENERATOR } from '../../application/ports/id-generator.port';
import { IDEMPOTENCY } from '../../application/ports/idempotency.port';
import { INBOX } from '../../application/ports/inbox.port';
import { OUTBOX } from '../../application/ports/outbox.port';
import { UNIT_OF_WORK } from '../../application/ports/unit-of-work.port';
import { PrismaService } from './prisma.service';
import { AnalyticsOutboxRepository } from './repositories/analytics-outbox.repository';
import { ApplicationRepository } from './repositories/application.repository';
import { AuditRepository } from './repositories/audit.repository';
import { ChallengeRepository } from './repositories/challenge.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { EligibilityRepository } from './repositories/eligibility.repository';
import { SessionRepository } from './repositories/session.repository';
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
    { provide: CUSTOMER_REPOSITORY, useClass: CustomerRepository },
    { provide: APPLICATION_REPOSITORY, useClass: ApplicationRepository },
    { provide: CHALLENGE_REPOSITORY, useClass: ChallengeRepository },
    { provide: SESSION_REPOSITORY, useClass: SessionRepository },
    { provide: ELIGIBILITY_REPOSITORY, useClass: EligibilityRepository },
    { provide: ANALYTICS, useClass: AnalyticsOutboxRepository },
  ],
  exports: [
    CUSTOMER_REPOSITORY,
    APPLICATION_REPOSITORY,
    CHALLENGE_REPOSITORY,
    SESSION_REPOSITORY,
    ELIGIBILITY_REPOSITORY,
    ANALYTICS,
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
