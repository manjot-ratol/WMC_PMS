import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { completeStep } from '../../domain/onboarding/application';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface ConfirmKycCommand {
  applicationId: string;
  customerId: string;
  kycRecordVersion: number;
  detailsConfirmed: boolean;
  changes: Record<string, unknown>;
}
export type ConfirmKycResult =
  | {
      status: 'CONFIRMED';
      kycStatus: 'COMPLETE';
      nextScreen: 'IPV' | 'PROFILE';
    }
  | {
      status: 'REMEDIATION_REQUIRED';
      kycStatus: 'REMEDIATE';
      nextScreen: 'FRESH_KYC';
    };

const SCREEN_CONFIRM = '08';

/** Screen 08: confirm a reusable KRA record (or request correction). Stale versions are rejected with 409. */
@Injectable()
export class KycConfirmationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async confirm(cmd: ConfirmKycCommand): Promise<ConfirmKycResult> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      const record = await this.kycRecords.latestForApplication(app.id, tx);
      if (
        !record ||
        record.status !== 'EXISTING_RECORD_AVAILABLE' ||
        record.route !== 'REUSE'
      )
        throw new ValidationError(undefined, {
          details: { reason: 'no_reusable_record', nextScreen: app.nextScreen },
        });
      if (record.version !== cmd.kycRecordVersion)
        throw new StaleVersionError(undefined, {
          details: { currentVersion: record.version },
        });

      const wantsChanges =
        !cmd.detailsConfirmed || Object.keys(cmd.changes ?? {}).length > 0;
      if (wantsChanges) {
        await this.kycRecords.saveWithVersionCheck(
          {
            ...record,
            route: 'REMEDIATE',
            version: record.version + 1,
            updatedAt: now,
          },
          record.version,
          tx,
        );
        await this.applications.saveWithVersionCheck(
          { ...app, nextScreen: 'FRESH_KYC', version: app.version + 1 },
          app.version,
          tx,
        );
        await this.audit.append(
          {
            actorType: 'CUSTOMER',
            actorId: cmd.customerId,
            action: 'kyc.correction_requested',
            aggregateType: 'application',
            aggregateId: app.id,
            details: { fields: Object.keys(cmd.changes ?? {}) },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'KYC Details Confirmed',
            identity: cmd.customerId,
            applicationId: app.id,
            screenId: SCREEN_CONFIRM,
            outcome: 'correction_requested',
          },
          tx,
        );
        return {
          status: 'REMEDIATION_REQUIRED',
          kycStatus: 'REMEDIATE',
          nextScreen: 'FRESH_KYC',
        };
      }

      await this.kycRecords.saveWithVersionCheck(
        {
          ...record,
          status: 'COMPLETE',
          confirmedAt: now,
          version: record.version + 1,
          updatedAt: now,
        },
        record.version,
        tx,
      );
      const exempt = Boolean(record.ipvExemptionBasis);
      let advanced = completeStep(app, 'KYC', exempt ? 'PROFILE' : 'IPV', now);
      if (exempt) advanced = completeStep(advanced, 'IPV', 'PROFILE', now);
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'kyc.confirmed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            kycRecordId: record.id,
            ipvExemptionBasis: record.ipvExemptionBasis,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'KYC' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'KYC Details Confirmed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_CONFIRM,
          outcome: 'confirmed',
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'KYC Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_CONFIRM,
          outcome: 'reuse',
        },
        tx,
      );
      return {
        status: 'CONFIRMED',
        kycStatus: 'COMPLETE',
        nextScreen: exempt ? 'PROFILE' : 'IPV',
      };
    });
  }
}
