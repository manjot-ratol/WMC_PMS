import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import type {
  AdditionalVerification,
  VerificationType,
} from '../../domain/ipv/additional-verification';
import { IPV_RULEBOOK, type IpvRulebook } from '../../domain/ipv/ipv-rulebook';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../ports/document.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  VERIFICATION_REPOSITORY,
  type TaskRepositoryPort,
  type VerificationRepositoryPort,
} from '../ports/verification.repository.port';

export interface RequestVerificationCommand {
  applicationId: string;
  customerId: string;
  verificationType: VerificationType;
  selfieDocumentId?: string;
}
export interface VerificationRequested {
  verificationId: string;
  status: AdditionalVerification['status'];
  providerSessionId?: string;
  nextScreen: string;
}

export const SCREEN_IPV = '11';

/** Screen 11: selfie liveness + face match, exemption from a KRA IPV flag, or an assisted alternative. */
@Injectable()
export class AdditionalVerificationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepositoryPort,
    @Inject(VERIFICATION_REPOSITORY)
    private readonly verifications: VerificationRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(IPV_RULEBOOK) private readonly rulebook: IpvRulebook,
  ) {}

  async request(
    cmd: RequestVerificationCommand,
  ): Promise<VerificationRequested> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      const record = await this.kycRecords.latestForApplication(app.id, tx);
      if (!record || record.status !== 'COMPLETE')
        throw new ValidationError(undefined, {
          details: { missingStep: 'KYC', nextScreen: app.nextScreen },
        });
      const id = this.ids.prefixed(ID_PREFIX.verification);
      const base = {
        id,
        applicationId: app.id,
        type: cmd.verificationType,
        thresholdVersion: this.rulebook.version,
        createdAt: now,
        updatedAt: now,
      };

      if (record.ipvExemptionBasis && this.rulebook.exemptWhenKraIpvFlag) {
        await this.verifications.create(
          {
            ...base,
            status: 'EXEMPT',
            exemptionBasis: record.ipvExemptionBasis,
          },
          tx,
        );
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'IPV', 'PROFILE', now),
          app.version,
          tx,
        );
        await this.audit.append(
          {
            actorType: 'SYSTEM',
            action: 'ipv.exempt',
            aggregateType: 'application',
            aggregateId: app.id,
            details: { basis: record.ipvExemptionBasis },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Additional Verification Completed',
            identity: cmd.customerId,
            applicationId: app.id,
            screenId: SCREEN_IPV,
            outcome: 'exempt',
          },
          tx,
        );
        return { verificationId: id, status: 'EXEMPT', nextScreen: 'PROFILE' };
      }

      if (cmd.verificationType === 'ASSISTED_IPV') {
        await this.verifications.create(
          { ...base, status: 'REVIEW_REQUIRED' },
          tx,
        );
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'IPV_ASSISTED',
            status: 'OPEN',
            details: { verificationId: id },
            createdAt: now,
          },
          tx,
        );
        await this.applications.saveWithVersionCheck(
          {
            ...app,
            nextScreen: 'ASSISTED_ONBOARDING',
            version: app.version + 1,
          },
          app.version,
          tx,
        );
        await this.audit.append(
          {
            actorType: 'CUSTOMER',
            actorId: cmd.customerId,
            action: 'ipv.assisted_requested',
            aggregateType: 'application',
            aggregateId: app.id,
            details: { verificationId: id },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Additional Verification Completed',
            identity: cmd.customerId,
            applicationId: app.id,
            screenId: SCREEN_IPV,
            outcome: 'assisted_requested',
          },
          tx,
        );
        return {
          verificationId: id,
          status: 'REVIEW_REQUIRED',
          nextScreen: 'ASSISTED_ONBOARDING',
        };
      }

      if (!cmd.selfieDocumentId)
        throw new ValidationError(undefined, {
          details: { field: 'selfie_document_id' },
        });
      const selfie = await this.documents.findDocument(
        cmd.selfieDocumentId,
        tx,
      );
      if (
        !selfie ||
        selfie.applicationId !== app.id ||
        selfie.requirementId !== 'SELFIE' ||
        selfie.status !== 'VERIFIED'
      )
        throw new ValidationError(undefined, {
          details: {
            field: 'selfie_document_id',
            reason: 'not_a_verified_selfie',
          },
        });
      const attempts = await this.verifications.countByType(
        app.id,
        'SELFIE_LIVENESS',
        tx,
      );
      if (attempts >= this.rulebook.maxSelfieAttempts)
        throw new ValidationError(undefined, {
          details: {
            reason: 'max_attempts',
            nextScreen: 'ASSISTED_ONBOARDING',
          },
        });
      const reference = await this.documents.latestVerified(
        app.id,
        'IDENTITY_PROOF',
        tx,
      );
      await this.verifications.create(
        {
          ...base,
          status: 'REQUESTED',
          selfieDocumentId: selfie.id,
          referenceDocumentId: reference?.id,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'ipv.selfie_requested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { verificationId: id, attempt: attempts + 1 },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'AdditionalVerificationRequested',
          payload: { verificationId: id },
        },
        tx,
      );
      return { verificationId: id, status: 'REQUESTED', nextScreen: 'IPV' };
    });
  }
}
