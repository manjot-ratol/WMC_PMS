import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import {
  BANK_RULEBOOK,
  bankNextScreen,
  evaluateBankOutcome,
  type BankRulebook,
  type BankVerification,
} from '../../domain/bank/bank-account';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { BANK_GATEWAY, type BankGatewayPort } from '../ports/bank-gateway.port';
import {
  BANK_REPOSITORY,
  type BankRepositoryPort,
} from '../ports/bank.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';
import { SCREEN_BANK } from '../bank/bank-verification.service';

export interface BankJobPayload {
  payload: { verificationId: string };
}

/** Screen 14 follow-up: Digio bank verification with the verified legal name, evaluated by the bank rulebook. */
@Processor(QUEUES.BANK)
export class BankVerificationProcessor extends BaseProcessor<BankJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(BANK_REPOSITORY) private readonly bank: BankRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(BANK_GATEWAY) private readonly gateway: BankGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(BANK_RULEBOOK) private readonly rulebook: BankRulebook,
  ) {
    super(store);
    this.logger = logger.child('BankVerificationProcessor');
  }

  async handle(data: BankJobPayload, job: Job): Promise<void> {
    const v = await this.bank.findVerification(data.payload.verificationId);
    if (!v || v.status !== 'PROCESSING') return;
    const account = await this.bank.findAccount(v.bankAccountId);
    const identity = await this.identities.latest(v.applicationId);
    if (!account || !identity) return;
    const now = this.clock.now();

    let updated: BankVerification;
    let category: string | undefined;
    try {
      const result = await this.gateway.verify({
        accountNumber: account.accountNumber,
        ifsc: account.ifsc,
        beneficiaryName: identity.legalName,
        validationMode: this.rulebook.validationMode,
        uniqueRequestId: v.id,
      });
      const evidenceKey = `applications/${v.applicationId}/bank/${v.id}/result.json`;
      await this.storage.put(
        evidenceKey,
        JSON.stringify(result.raw),
        'application/json',
      );
      const evaluation = evaluateBankOutcome(
        {
          verified: result.verified,
          fuzzyMatchScore: result.fuzzyMatchScore,
          errorCode: result.errorCode,
        },
        this.rulebook,
      );
      category =
        evaluation.status === 'VERIFIED' ? undefined : evaluation.category;
      updated = {
        ...v,
        status: evaluation.status,
        requiredActions:
          evaluation.status === 'ACTION_REQUIRED'
            ? evaluation.requiredActions
            : [],
        providerReference: result.providerReference,
        evidenceKey,
        safeErrorCategory: category,
        updatedAt: now,
      };
    } catch (err) {
      if (
        err instanceof DependencyUnavailableError &&
        job.attemptsMade + 1 < (job.opts?.attempts ?? 1)
      )
        throw err;
      if (
        !(err instanceof DependencyUnavailableError) &&
        !(err instanceof PartnerRejectedError)
      )
        throw err;
      category =
        err instanceof PartnerRejectedError
          ? 'provider_rejected'
          : 'provider_unavailable';
      updated = {
        ...v,
        status: 'TECHNICAL_ERROR',
        requiredActions: [],
        safeErrorCategory: category,
        updatedAt: now,
      };
      this.logger.warn('bank_verification.technical_error', {
        verificationId: v.id,
        category,
        err,
      });
    }

    await this.uow.run(async (tx) => {
      await this.bank.updateVerification(updated, tx);
      const app = await this.applications.findById(v.applicationId, tx);
      if (!app) return;
      if (updated.status === 'VERIFIED') {
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'BANK', 'NOMINATION', now),
          app.version,
          tx,
        );
      } else {
        if (updated.status === 'REVIEW_REQUIRED')
          await this.tasks.create(
            {
              id: this.ids.prefixed(ID_PREFIX.task),
              applicationId: app.id,
              category: 'BANK_NAME_REVIEW',
              status: 'OPEN',
              details: { verificationId: v.id, category },
              createdAt: now,
            },
            tx,
          );
        await this.applications.saveWithVersionCheck(
          {
            ...app,
            nextScreen: bankNextScreen(updated.status),
            version: app.version + 1,
          },
          app.version,
          tx,
        );
      }
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'digio',
          action: 'bank_verification.completed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { verificationId: v.id, status: updated.status, category },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Bank Verification Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_BANK,
          outcome: updated.status.toLowerCase(),
          safeErrorCategory: category,
        },
        tx,
      );
    });
  }
}
