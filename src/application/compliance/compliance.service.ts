import { Inject, Injectable } from '@nestjs/common';
import { partnersConfig } from '../../common/config/partners.config';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  TRACKWIZZ_CODEBOOK,
  type TrackWizzCodebook,
} from '../../domain/compliance/as501';
import { ID_PREFIX } from '../../domain/shared/public-id';
import type { As501Subject } from '../../infrastructure/partners/trackwizz/trackwizz.mapper';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  COMPLIANCE_REPOSITORY,
  type ComplianceRepositoryPort,
} from '../ports/compliance.repository.port';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepositoryPort,
} from '../ports/customer.repository.port';
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
import {
  DECLARATIONS_REPOSITORY,
  PROFILE_REPOSITORY,
  type DeclarationsRepositoryPort,
  type ProfileRepositoryPort,
} from '../ports/profile.repository.port';
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';

export interface RequestScreeningCommand {
  applicationId: string;
  identityVersion: number;
  screeningPolicyVersion: string;
  requestedBy: string;
}
export interface RequestAmlCommand {
  applicationId: string;
  identityVersion: number;
  profileVersion: number;
  declarationVersion: number;
  policyVersion: string;
  requestedBy: string;
}

/** Job A/B entry points for ops re-runs, plus the subject assembly both jobs share. */
@Injectable()
export class ComplianceService {
  readonly sourceSystemName: string;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kyc: KycRecordRepositoryPort,
    @Inject(PROFILE_REPOSITORY)
    private readonly profiles: ProfileRepositoryPort,
    @Inject(DECLARATIONS_REPOSITORY)
    private readonly declarations: DeclarationsRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(TRACKWIZZ_CODEBOOK) readonly codebook: TrackWizzCodebook,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    this.sourceSystemName = cfg.trackwizz.sourceSystemName || 'WMC_PMS';
  }

  async requestScreening(
    cmd: RequestScreeningCommand,
  ): Promise<{ screeningRunId: string; status: 'QUEUED' }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app) throw new NotFoundError();
      const identity = await this.identities.latest(app.id, tx);
      if (!identity || identity.version !== cmd.identityVersion)
        throw new ValidationError(undefined, {
          details: {
            field: 'identity_version',
            currentIdentityVersion: identity?.version,
          },
        });
      const id = this.ids.prefixed(ID_PREFIX.screeningRun);
      await this.compliance.supersedeOpen(app.id, tx, 'SCREENING');
      await this.compliance.createScreeningRun(
        {
          id,
          applicationId: app.id,
          identityVersion: identity.version,
          screeningPolicyVersion: cmd.screeningPolicyVersion,
          status: 'QUEUED',
          createdAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.requestedBy,
          action: 'screening.requested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { screeningRunId: id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'ScreeningRequested',
          payload: { screeningRunId: id },
        },
        tx,
      );
      return { screeningRunId: id, status: 'QUEUED' };
    });
  }

  async requestAml(
    cmd: RequestAmlCommand,
  ): Promise<{ assessmentId: string; status: 'QUEUED' }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app) throw new NotFoundError();
      const [identity, profile, decl] = await Promise.all([
        this.identities.latest(app.id, tx),
        this.profiles.latest(app.id, tx),
        this.declarations.latest(app.id, tx),
      ]);
      if (!identity || identity.version !== cmd.identityVersion)
        throw new ValidationError(undefined, {
          details: {
            field: 'identity_version',
            currentIdentityVersion: identity?.version,
          },
        });
      if (!profile || profile.version !== cmd.profileVersion)
        throw new ValidationError(undefined, {
          details: {
            field: 'profile_version',
            currentProfileVersion: profile?.version,
          },
        });
      if (!decl || decl.version !== cmd.declarationVersion)
        throw new ValidationError(undefined, {
          details: {
            field: 'declaration_version',
            currentDeclarationVersion: decl?.version,
          },
        });
      const id = this.ids.prefixed(ID_PREFIX.amlAssessment);
      await this.compliance.supersedeOpen(app.id, tx, 'AML');
      await this.compliance.createAmlAssessment(
        {
          id,
          applicationId: app.id,
          identityVersion: identity.version,
          profileVersion: profile.version,
          declarationVersion: decl.version,
          policyVersion: cmd.policyVersion,
          status: 'QUEUED',
          createdAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.requestedBy,
          action: 'aml.requested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { assessmentId: id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'AmlAssessmentRequested',
          payload: { assessmentId: id },
        },
        tx,
      );
      return { assessmentId: id, status: 'QUEUED' };
    });
  }

  /** The verified facts an AS501 record is built from. Missing identity is a hard stop for the job. */
  async subject(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<As501Subject | null> {
    const app = await this.applications.findById(applicationId, tx);
    if (!app) return null;
    const [customer, identity, record, profile, decl] = await Promise.all([
      this.customers.findById(app.customerId, tx),
      this.identities.latest(app.id, tx),
      this.kyc.latestForApplication(app.id, tx),
      this.profiles.latest(app.id, tx),
      this.declarations.latest(app.id, tx),
    ]);
    if (!customer || !identity) return null;
    const a = record?.summary?.correspondenceAddress;
    return {
      customerId: customer.id,
      applicationId: app.id,
      pan: identity.pan,
      legalName: identity.legalName,
      dateOfBirth: identity.dateOfBirth,
      email: customer.email,
      phone: customer.phone,
      occupation: profile?.occupation,
      annualIncomeBand: profile?.annualIncomeBand,
      pepDeclaration: decl?.pepDeclaration,
      taxResidencyCountries: decl?.taxResidencies.map((t) => t.country),
      address: a
        ? {
            line1: a.line1,
            line2: a.line2,
            line3: a.line3,
            city: a.city,
            stateCode: a.stateCode,
            pinCode: a.pinCode,
          }
        : undefined,
      customerCreatedAt: customer.createdAt,
    };
  }
}
