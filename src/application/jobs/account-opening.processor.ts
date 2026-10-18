import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import {
  ACCOUNT_OPENING_RULEBOOK,
  kraRegistrationRequired,
  mapKraStatus,
  type AccountOpeningRulebook,
  type AccountOpeningRun,
  type RegistrySubmission,
} from '../../domain/account-opening/account-opening';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import {
  ACCOUNT_OPENING_REPOSITORY,
  type AccountOpeningRepositoryPort,
} from '../ports/account-opening.repository.port';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import { KRA_GATEWAY, type KraGatewayPort } from '../ports/kra-gateway.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from '../ports/review.repository.port';
import {
  SIGNING_REPOSITORY,
  type SigningRepositoryPort,
} from '../ports/signing.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';
import { SCREEN_ACCOUNTS } from '../account-opening/account-opening.service';

export interface AccountOpeningJobPayload {
  payload?: {
    runId?: string;
    signingSessionId?: string;
    snapshotId?: string;
    documentPackVersion?: number;
  };
}

/**
 * Job C: pre-submission checks, registry filing (KRA where the KYC was fresh; CKYC behind its flag) and the
 * account-opening request. Account readiness itself arrives through the custodian feed, never from this job.
 */
@Processor(QUEUES.ACCOUNT_OPENING)
export class AccountOpeningProcessor extends BaseProcessor<AccountOpeningJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepositoryPort,
    @Inject(SIGNING_REPOSITORY) private readonly signing: SigningRepositoryPort,
    @Inject(ACCOUNT_OPENING_REPOSITORY)
    private readonly accounts: AccountOpeningRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kyc: KycRecordRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(KRA_GATEWAY) private readonly kra: KraGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(ACCOUNT_OPENING_RULEBOOK)
    private readonly rulebook: AccountOpeningRulebook,
  ) {
    super(store);
    this.logger = logger.child('AccountOpeningProcessor');
  }

  async handle(data: AccountOpeningJobPayload): Promise<void> {
    const now = this.clock.now();
    const run = await this.resolveRun(data, now);
    if (!run || run.status !== 'QUEUED') return;
    const app = await this.applications.findById(run.applicationId);
    const snapshot = await this.reviews.current(run.applicationId);
    const session = await this.signing.latestForSnapshot(run.snapshotId);
    const blockers: string[] = [];
    if (!app || app.status !== 'SUBMITTED')
      blockers.push('application_not_submitted');
    if (!snapshot || snapshot.id !== run.snapshotId)
      blockers.push('snapshot_superseded');
    if (!session || session.status !== 'EXECUTED')
      blockers.push('documents_not_executed');
    if (blockers.length || !app) {
      await this.accounts.updateRun({
        ...run,
        status: 'BLOCKED',
        blockers,
        updatedAt: now,
      });
      this.logger.warn('account_opening.blocked', { runId: run.id, blockers });
      return;
    }
    await this.accounts.updateRun({
      ...run,
      status: 'RUNNING',
      updatedAt: now,
    });

    const [identity, record] = await Promise.all([
      this.identities.latest(app.id),
      this.kyc.latestForApplication(app.id),
    ]);
    const submissions: RegistrySubmission[] = [];
    const base = {
      applicationId: app.id,
      runId: run.id,
      createdAt: now,
      updatedAt: now,
    };
    if (kraRegistrationRequired(record?.route)) {
      const id = this.ids.prefixed(ID_PREFIX.registrySubmission);
      const deadlineAt = new Date(
        now.getTime() + this.rulebook.kraFilingDays * 24 * 3600 * 1000,
      );
      try {
        const result = await this.kra.register({
          uniqueRequestId: id,
          apiRequestType: 'stateless',
          serviceProvider: this.rulebook.kraServiceProvider,
          registration: {
            pan_no: identity?.pan,
            name: identity?.legalName,
            dob: identity?.dateOfBirth,
            kyc_mode: record?.summary?.kra ? 'EXISTING' : 'DIGITAL',
            ipv_flag: record?.ipvExemptionBasis ? 'Y' : 'N',
            correspondence_address: record?.summary?.correspondenceAddress,
            update_flag: 'N',
            note: 'PLACEHOLDER_PENDING_COMPLIANCE: full common_kra_registration_request mapping to be confirmed with Compliance',
          },
        });
        const evidenceKey = `applications/${app.id}/registry/${id}.json`;
        await this.storage.put(
          evidenceKey,
          JSON.stringify(result.raw),
          'application/json',
        );
        const status = result.error
          ? 'ERROR'
          : mapKraStatus(result.status ?? 'SUBMITTED');
        submissions.push({
          ...base,
          id,
          registry: 'KRA',
          status,
          providerRequestId: result.requestId,
          clientReferenceId: id,
          lastProviderStatus: result.status,
          deadlineAt,
          evidenceKey,
          safeErrorCategory: result.error ? 'kra_validation_error' : undefined,
        });
      } catch (err) {
        if (
          !(err instanceof DependencyUnavailableError) &&
          !(err instanceof PartnerRejectedError)
        )
          throw err;
        submissions.push({
          ...base,
          id,
          registry: 'KRA',
          status: 'ERROR',
          clientReferenceId: id,
          deadlineAt,
          safeErrorCategory:
            err instanceof PartnerRejectedError
              ? 'provider_rejected'
              : 'provider_unavailable',
        });
      }
    } else {
      submissions.push({
        ...base,
        id: this.ids.prefixed(ID_PREFIX.registrySubmission),
        registry: 'KRA',
        status: 'NOT_REQUIRED',
        basis: 'EXISTING_KRA_RECORD',
      });
    }
    submissions.push({
      ...base,
      id: this.ids.prefixed(ID_PREFIX.registrySubmission),
      registry: 'CKYC',
      status: this.rulebook.ckycEnabled ? 'DEFERRED' : 'NOT_REQUIRED',
      basis: this.rulebook.ckycEnabled
        ? 'CKYC_UPLOAD_PENDING_DOCUMENTS'
        : 'CKYC_DISABLED_BY_POLICY',
    });

    await this.uow.run(async (tx) => {
      for (const s of submissions) await this.accounts.createSubmission(s, tx);
      const errored = submissions.filter((s) => s.status === 'ERROR');
      for (const s of errored)
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'REGISTRY_FILING_EXCEPTION',
            status: 'OPEN',
            details: {
              submissionId: s.id,
              registry: s.registry,
              category: s.safeErrorCategory,
            },
            createdAt: now,
          },
          tx,
        );
      await this.tasks.create(
        {
          id: this.ids.prefixed(ID_PREFIX.task),
          applicationId: app.id,
          category: 'ACCOUNT_SETUP',
          status: 'IN_PROGRESS',
          details: { runId: run.id },
          createdAt: now,
        },
        tx,
      );
      await this.accounts.updateRun(
        { ...run, status: 'SUBMITTED', blockers: [], updatedAt: now },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'SYSTEM',
          action: 'account_opening.submitted',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            runId: run.id,
            registries: submissions.map((s) => ({
              registry: s.registry,
              status: s.status,
              basis: s.basis,
            })),
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Application Processing Updated',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_ACCOUNTS,
          outcome: errored.length ? 'registry_exception' : 'submitted',
        },
        tx,
      );
    });
  }

  /** Runs come from the ops endpoint (runId) or from pack execution (create one for the executed snapshot). */
  private async resolveRun(
    data: AccountOpeningJobPayload,
    now: Date,
  ): Promise<AccountOpeningRun | null> {
    const p = data.payload ?? {};
    if (p.runId) return this.accounts.findRun(p.runId);
    if (!p.signingSessionId) return null;
    const session = await this.signing.findById(p.signingSessionId);
    if (!session) return null;
    const latest = await this.accounts.latestRun(session.applicationId);
    if (
      latest &&
      latest.snapshotId === session.snapshotId &&
      latest.status !== 'BLOCKED' &&
      latest.status !== 'ERROR'
    )
      return latest.status === 'QUEUED' ? latest : null;
    const run: AccountOpeningRun = {
      id: this.ids.prefixed(ID_PREFIX.accountOpeningRun),
      applicationId: session.applicationId,
      snapshotId: session.snapshotId,
      documentPackVersion: session.documentPackVersion,
      status: 'QUEUED',
      blockers: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.accounts.createRun(run);
    return run;
  }
}
