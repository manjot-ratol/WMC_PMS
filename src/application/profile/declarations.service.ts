import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { completeStep, requireStep } from '../../domain/onboarding/application';
import {
  TAX_RULEBOOK,
  validateDeclarations,
  type DeclarationsInput,
  type TaxRulebook,
} from '../../domain/profile/declarations';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
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
  ELIGIBILITY_REPOSITORY,
  type EligibilityRepositoryPort,
} from '../ports/eligibility.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  DECLARATIONS_REPOSITORY,
  PROFILE_REPOSITORY,
  type DeclarationsRepositoryPort,
  type ProfileRepositoryPort,
} from '../ports/profile.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';
import { AML_POLICY_VERSION } from './profile.service';

export interface SaveDeclarationsCommand extends DeclarationsInput {
  applicationId: string;
  customerId: string;
}
export const SCREEN_DECLARATIONS = '13';
export const SCREENING_POLICY_VERSION = 'screening_v1';

/** Screen 13: tax residencies + PEP attestation; queues screening and AML work for the compliance jobs. */
@Injectable()
export class DeclarationsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(ELIGIBILITY_REPOSITORY)
    private readonly eligibility: EligibilityRepositoryPort,
    @Inject(PROFILE_REPOSITORY)
    private readonly profiles: ProfileRepositoryPort,
    @Inject(DECLARATIONS_REPOSITORY)
    private readonly declarations: DeclarationsRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(TAX_RULEBOOK) private readonly rulebook: TaxRulebook,
  ) {}

  async save(cmd: SaveDeclarationsCommand): Promise<{
    status: 'COMPLETE';
    additionalInformationRequired: boolean;
    nextScreen: 'BANK_DETAILS';
  }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      if (app.status !== 'IN_PROGRESS')
        throw new ValidationError(undefined, {
          details: { applicationStatus: app.status },
        });
      requireStep(app, 'PROFILE');
      const identity = await this.identities.latest(app.id, tx);
      if (!identity)
        throw new ValidationError(undefined, {
          details: { missingStep: 'IDENTITY' },
        });
      const eligibility = await this.eligibility.latest(app.id, tx);
      const isResident = eligibility?.input.residentialStatus === 'RESIDENT';
      const { additionalInformationRequired } = validateDeclarations(
        cmd,
        identity.pan,
        isResident,
        this.rulebook,
      );

      const previous = await this.declarations.latest(app.id, tx);
      const version = (previous?.version ?? 0) + 1;
      const residencies = cmd.taxResidencies.map((r) => ({
        country: r.country.toUpperCase(),
        tin: r.tin ? r.tin.replace(/\s+/g, '').toUpperCase() : null,
        tinUnavailableReason: r.tin ? null : (r.tinUnavailableReason ?? null),
      }));
      await this.declarations.append(
        {
          applicationId: app.id,
          version,
          taxResidencies: residencies,
          pepDeclaration: cmd.pepDeclaration,
          declarationVersion: cmd.declarationVersion,
          additionalInformationRequired,
          attestedAt: now,
        },
        tx,
      );

      if (additionalInformationRequired)
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'FATCA_ADDITIONAL_INFO',
            status: 'OPEN',
            details: { declarationVersion: version },
            createdAt: now,
          },
          tx,
        );
      if (cmd.pepDeclaration !== 'NOT_PEP')
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'PEP_EDD',
            status: 'OPEN',
            details: { declarationVersion: version },
            createdAt: now,
          },
          tx,
        );

      const profile = await this.profiles.latest(app.id, tx);
      await this.compliance.supersedeOpen(app.id, tx);
      await this.compliance.createScreeningRun(
        {
          id: this.ids.prefixed(ID_PREFIX.screeningRun),
          applicationId: app.id,
          identityVersion: identity.version,
          screeningPolicyVersion: SCREENING_POLICY_VERSION,
          status: 'QUEUED',
          createdAt: now,
        },
        tx,
      );
      await this.compliance.createAmlAssessment(
        {
          id: this.ids.prefixed(ID_PREFIX.amlAssessment),
          applicationId: app.id,
          identityVersion: identity.version,
          profileVersion: profile?.version ?? 0,
          declarationVersion: version,
          policyVersion: AML_POLICY_VERSION,
          status: 'QUEUED',
          createdAt: now,
        },
        tx,
      );

      await this.applications.saveWithVersionCheck(
        completeStep(app, 'DECLARATIONS', 'BANK_DETAILS', now),
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'declarations.attested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            declarationVersion: version,
            residencyCount: residencies.length,
            additionalInformationRequired,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'DECLARATIONS' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Declarations Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_DECLARATIONS,
          outcome: additionalInformationRequired
            ? 'additional_info_required'
            : 'complete',
        },
        tx,
      );
      return {
        status: 'COMPLETE',
        additionalInformationRequired,
        nextScreen: 'BANK_DETAILS',
      };
    });
  }
}
