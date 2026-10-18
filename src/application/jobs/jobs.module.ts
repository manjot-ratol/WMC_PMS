import { BullModule } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { ApplicationServicesModule } from '../application.module';
import { KycRelianceRulebookProviders } from '../rulebooks.providers';
import { EventRouter } from '../../infrastructure/queue/event-router';
import { ALL_QUEUES, QUEUES } from '../../infrastructure/queue/queue.names';
import { AccountOpeningProcessor } from './account-opening.processor';
import { AmlAssessmentProcessor } from './aml-assessment.processor';
import { ScreeningProcessor } from './screening.processor';
import { ActivationProcessor } from './activation.processor';
import { BankVerificationProcessor } from './bank-verification.processor';
import {
  SIGNING_POLL_JOB,
  SigningStatusProcessor,
} from './signing-status.processor';
import { DigioWebhookProcessor } from './digio-webhook.processor';
import { DocumentProcessor } from './document.processor';
import { IpvProcessor } from './ipv.processor';
import { KycLookupProcessor } from './kyc-lookup.processor';
import { KycStatusPollProcessor, POLL_JOB } from './kyc-status-poll.processor';

/** Worker-only: queue consumers for Phase 3 and the outbox event routes they consume. */
@Module({
  imports: [
    ApplicationServicesModule,
    BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
  ],
  providers: [
    ...KycRelianceRulebookProviders,
    KycLookupProcessor,
    KycStatusPollProcessor,
    DocumentProcessor,
    IpvProcessor,
    DigioWebhookProcessor,
    BankVerificationProcessor,
    SigningStatusProcessor,
    AccountOpeningProcessor,
    ActivationProcessor,
    ScreeningProcessor,
    AmlAssessmentProcessor,
  ],
})
export class JobsModule implements OnModuleInit {
  constructor(private readonly router: EventRouter) {}

  onModuleInit(): void {
    this.router.register('IdentityVerificationRequested', {
      queue: QUEUES.IDENTITY,
      jobName: 'run',
    });
    this.router.register('KycSessionCreated', {
      queue: QUEUES.KYC_STATUS,
      jobName: POLL_JOB,
    });
    this.router.register('DocumentSubmitted', {
      queue: QUEUES.DOCUMENTS,
      jobName: 'verify',
    });
    this.router.register('BankVerificationRequested', {
      queue: QUEUES.BANK,
      jobName: 'verify',
    });
    this.router.register('SigningSessionCreated', {
      queue: QUEUES.SIGNING,
      jobName: SIGNING_POLL_JOB,
    });
    this.router.register('DocumentPackExecuted', {
      queue: QUEUES.ACCOUNT_OPENING,
      jobName: 'run',
    });
    this.router.register('AccountOpeningRequested', {
      queue: QUEUES.ACCOUNT_OPENING,
      jobName: 'run',
    });
    this.router.register('UnderlyingAccountReady', {
      queue: QUEUES.ACTIVATION,
      jobName: 'run',
    });
    this.router.register('FundingRequirementMet', {
      queue: QUEUES.ACTIVATION,
      jobName: 'run',
    });
    this.router.register('ScreeningRequested', {
      queue: QUEUES.SCREENING,
      jobName: 'run',
    });
    this.router.register('AmlAssessmentRequested', {
      queue: QUEUES.AML,
      jobName: 'run',
    });
    this.router.register('ComplianceOutcomeRecorded', {
      queue: QUEUES.ACTIVATION,
      jobName: 'run',
    });
    this.router.register('AdditionalVerificationRequested', {
      queue: QUEUES.IPV,
      jobName: 'ipv',
    });
  }
}
