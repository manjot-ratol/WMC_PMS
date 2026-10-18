import { Inject, Injectable } from '@nestjs/common';
import { Fingerprint } from '../../common/crypto/fingerprint';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  isAdult,
  normaliseLegalName,
  normalisePan,
  panHolderType,
  type IdentityVersion,
} from '../../domain/kyc/identity-version';
import type { KycRecord } from '../../domain/kyc/kyc-record';
import {
  completeStep,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { ID_PREFIX } from '../../domain/shared/public-id';
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
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export interface SubmitIdentityCommand {
  applicationId: string;
  customerId: string;
  pan: string;
  legalName: string;
  dateOfBirth: string;
  permissionVersion: string;
}
export interface IdentitySubmitted {
  operationId: string;
  status: 'PROCESSING';
  /** Screen 06A: the MF Central portfolio import runs while the KRA lookup completes in the worker. */
  nextScreen: 'PORTFOLIO_IMPORT';
}

export const SCREEN_IDENTITY = '06';

/** Screen 06: records an identity version and starts the KRA lookup job. Duplicates are routed to review silently. */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly fingerprint: Fingerprint,
  ) {}

  async submit(cmd: SubmitIdentityCommand): Promise<IdentitySubmitted> {
    const now = this.clock.now();
    const pan = normalisePan(cmd.pan);
    const legalName = normaliseLegalName(cmd.legalName);
    let dob;
    try {
      dob = toIsoDate(cmd.dateOfBirth);
    } catch {
      throw new ValidationError('Date of birth must be YYYY-MM-DD', {
        details: { field: 'date_of_birth' },
      });
    }
    if (!isAdult(dob, now))
      throw new ValidationError(undefined, {
        details: { field: 'date_of_birth', reason: 'minor' },
      });
    if (panHolderType(pan) !== 'INDIVIDUAL')
      throw new ValidationError(undefined, {
        details: { field: 'pan', reason: 'not_individual' },
      });
    if (!cmd.permissionVersion)
      throw new ValidationError(undefined, {
        details: { field: 'permission_version' },
      });

    return this.uow.run(async (tx) => {
      const app = await this.loadApplication(
        cmd.applicationId,
        cmd.customerId,
        tx,
      );
      requireStep(app, 'ELIGIBILITY');
      const previous = await this.identities.latest(app.id, tx);
      const duplicates = await this.identities.otherApplicationsWithPan(
        this.fingerprint.of(pan, 'pan'),
        app.id,
        tx,
      );
      const version = (previous?.version ?? 0) + 1;
      const identity: IdentityVersion = {
        applicationId: app.id,
        version,
        pan,
        legalName,
        dateOfBirth: dob,
        permissionVersion: cmd.permissionVersion,
        status: duplicates.length ? 'DUPLICATE_REVIEW' : 'SUBMITTED',
        submittedAt: now,
      };
      await this.identities.append(identity, tx);

      const operationId = this.ids.prefixed(ID_PREFIX.operation);
      const record: KycRecord = {
        id: this.ids.prefixed(ID_PREFIX.kycRecord),
        applicationId: app.id,
        identityVersion: version,
        provider: 'DIGIO_KRA',
        operationId,
        version: 0,
        updatedAt: now,
        ...(duplicates.length
          ? {
              status: 'REVIEW_REQUIRED' as const,
              route: 'ASSISTED' as const,
              safeErrorCategory: 'duplicate_identity',
            }
          : { status: 'PROCESSING' as const }),
      };
      await this.kycRecords.create(record, tx);
      const advanced = completeStep(app, 'IDENTITY', 'PORTFOLIO_IMPORT', now);
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'identity.submitted',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            identityVersion: version,
            duplicate: duplicates.length > 0,
          },
        },
        tx,
      );

      if (duplicates.length) {
        // Never disclose the other account; open a restricted review task instead.
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'IDENTITY_DUPLICATE_REVIEW',
            status: 'OPEN',
            details: {
              identityVersion: version,
              otherApplications: duplicates,
            },
            createdAt: now,
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'KYC Route Assigned',
            identity: cmd.customerId,
            applicationId: app.id,
            screenId: SCREEN_IDENTITY,
            outcome: 'assisted',
            safeErrorCategory: 'review',
          },
          tx,
        );
      } else {
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'IdentityVerificationRequested',
            payload: {
              kycRecordId: record.id,
              identityVersion: version,
              operationId,
            },
          },
          tx,
        );
      }
      return {
        operationId,
        status: 'PROCESSING',
        nextScreen: 'PORTFOLIO_IMPORT',
      };
    });
  }

  private async loadApplication(
    applicationId: string,
    customerId: string,
    tx: Parameters<ApplicationRepositoryPort['findById']>[1],
  ): Promise<OnboardingApplication> {
    const app = await this.applications.findById(applicationId, tx);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    if (app.status !== 'IN_PROGRESS')
      throw new ValidationError(undefined, {
        details: { applicationStatus: app.status },
      });
    return app;
  }
}
