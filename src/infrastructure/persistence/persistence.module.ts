import { Global, Module } from '@nestjs/common';
import { ANALYTICS } from '../../application/ports/analytics.port';
import { BANK_REPOSITORY } from '../../application/ports/bank.repository.port';
import { ACCOUNT_OPENING_REPOSITORY } from '../../application/ports/account-opening.repository.port';
import { ANALYTICS_OUTBOX } from '../../application/ports/analytics-outbox.port';
import { ACTIVATION_REPOSITORY } from '../../application/ports/activation.repository.port';
import { FUNDING_REPOSITORY } from '../../application/ports/funding.repository.port';
import { SIGNING_REPOSITORY } from '../../application/ports/signing.repository.port';
import { FEE_REPOSITORY } from '../../application/ports/fee.repository.port';
import { REVIEW_REPOSITORY } from '../../application/ports/review.repository.port';
import { SUITABILITY_REPOSITORY } from '../../application/ports/suitability.repository.port';
import { COMPLIANCE_REPOSITORY } from '../../application/ports/compliance.repository.port';
import { PORTFOLIO_REPOSITORY } from '../../application/ports/portfolio.repository.port';
import { NOMINATION_REPOSITORY } from '../../application/ports/nomination.repository.port';
import {
  DECLARATIONS_REPOSITORY,
  PROFILE_REPOSITORY,
} from '../../application/ports/profile.repository.port';
import { DOCUMENT_REPOSITORY } from '../../application/ports/document.repository.port';
import { IDENTITY_REPOSITORY } from '../../application/ports/identity.repository.port';
import {
  KYC_RECORD_REPOSITORY,
  KYC_SESSION_REPOSITORY,
} from '../../application/ports/kyc.repository.port';
import {
  TASK_REPOSITORY,
  VERIFICATION_REPOSITORY,
} from '../../application/ports/verification.repository.port';
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
import { BankRepository } from './repositories/bank.repository';
import { AccountOpeningRepository } from './repositories/account-opening.repository';
import { ActivationRepository } from './repositories/activation.repository';
import { FundingRepository } from './repositories/funding.repository';
import { SigningRepository } from './repositories/signing.repository';
import { FeeRepository } from './repositories/fee.repository';
import { ReviewRepository } from './repositories/review.repository';
import { SuitabilityRepository } from './repositories/suitability.repository';
import { ComplianceRepository } from './repositories/compliance.repository';
import { PortfolioRepository } from './repositories/portfolio.repository';
import { NominationRepository } from './repositories/nomination.repository';
import {
  DeclarationsRepository,
  ProfileRepository,
} from './repositories/profile.repository';
import { DocumentRepository } from './repositories/document.repository';
import { IdentityRepository } from './repositories/identity.repository';
import {
  KycRecordRepository,
  KycSessionRepository,
} from './repositories/kyc.repository';
import {
  TaskRepository,
  VerificationRepository,
} from './repositories/verification.repository';
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
    { provide: ANALYTICS_OUTBOX, useClass: AnalyticsOutboxRepository },
    { provide: IDENTITY_REPOSITORY, useClass: IdentityRepository },
    { provide: KYC_RECORD_REPOSITORY, useClass: KycRecordRepository },
    { provide: KYC_SESSION_REPOSITORY, useClass: KycSessionRepository },
    { provide: DOCUMENT_REPOSITORY, useClass: DocumentRepository },
    { provide: VERIFICATION_REPOSITORY, useClass: VerificationRepository },
    { provide: TASK_REPOSITORY, useClass: TaskRepository },
    { provide: PROFILE_REPOSITORY, useClass: ProfileRepository },
    { provide: DECLARATIONS_REPOSITORY, useClass: DeclarationsRepository },
    { provide: BANK_REPOSITORY, useClass: BankRepository },
    { provide: SIGNING_REPOSITORY, useClass: SigningRepository },
    { provide: ACCOUNT_OPENING_REPOSITORY, useClass: AccountOpeningRepository },
    { provide: FUNDING_REPOSITORY, useClass: FundingRepository },
    { provide: ACTIVATION_REPOSITORY, useClass: ActivationRepository },
    { provide: SUITABILITY_REPOSITORY, useClass: SuitabilityRepository },
    { provide: FEE_REPOSITORY, useClass: FeeRepository },
    { provide: REVIEW_REPOSITORY, useClass: ReviewRepository },
    { provide: NOMINATION_REPOSITORY, useClass: NominationRepository },
    { provide: COMPLIANCE_REPOSITORY, useClass: ComplianceRepository },
    { provide: PORTFOLIO_REPOSITORY, useClass: PortfolioRepository },
  ],
  exports: [
    CUSTOMER_REPOSITORY,
    APPLICATION_REPOSITORY,
    CHALLENGE_REPOSITORY,
    SESSION_REPOSITORY,
    ELIGIBILITY_REPOSITORY,
    ANALYTICS,
    ANALYTICS_OUTBOX,
    IDENTITY_REPOSITORY,
    KYC_RECORD_REPOSITORY,
    KYC_SESSION_REPOSITORY,
    DOCUMENT_REPOSITORY,
    VERIFICATION_REPOSITORY,
    TASK_REPOSITORY,
    PROFILE_REPOSITORY,
    DECLARATIONS_REPOSITORY,
    BANK_REPOSITORY,
    NOMINATION_REPOSITORY,
    COMPLIANCE_REPOSITORY,
    PORTFOLIO_REPOSITORY,
    SUITABILITY_REPOSITORY,
    FEE_REPOSITORY,
    REVIEW_REPOSITORY,
    SIGNING_REPOSITORY,
    ACCOUNT_OPENING_REPOSITORY,
    FUNDING_REPOSITORY,
    ACTIVATION_REPOSITORY,
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
