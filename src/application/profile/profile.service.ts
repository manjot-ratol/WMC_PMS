import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  completeStep,
  hasCompleted,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import {
  PROFILE_RULEBOOK,
  validateProfile,
  type ProfileInput,
  type ProfileRulebook,
} from '../../domain/profile/profile';
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

export interface SaveProfileCommand extends ProfileInput {
  applicationId: string;
  customerId: string;
  /** Version the client last saw (0 when none). Mismatch is a 409. */
  profileVersion: number;
}

export const SCREEN_PROFILE = '12';
export const AML_POLICY_VERSION = 'aml_v1';

/** Screen 12: versioned profile. A material change after declarations re-queues the AML assessment. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(PROFILE_REPOSITORY)
    private readonly profiles: ProfileRepositoryPort,
    @Inject(DECLARATIONS_REPOSITORY)
    private readonly declarations: DeclarationsRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(PROFILE_RULEBOOK) private readonly rulebook: ProfileRulebook,
  ) {}

  async save(cmd: SaveProfileCommand): Promise<{
    status: 'COMPLETE';
    profileVersion: number;
    nextScreen: 'TAX_DECLARATIONS' | 'BANK_DETAILS';
  }> {
    const { evidenceRequired } = validateProfile(cmd, this.rulebook);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.loadApplication(
        cmd.applicationId,
        cmd.customerId,
        tx,
      );
      requireStep(app, 'KYC');
      const current = await this.profiles.latest(app.id, tx);
      if ((current?.version ?? 0) !== cmd.profileVersion)
        throw new StaleVersionError(undefined, {
          details: { currentVersion: current?.version ?? 0 },
        });
      const version = cmd.profileVersion + 1;
      await this.profiles.append(
        {
          applicationId: app.id,
          version,
          occupation: cmd.occupation,
          annualIncomeBand: cmd.annualIncomeBand,
          sourceOfFunds: cmd.sourceOfFunds,
          sourceOfFundsExplanation:
            cmd.sourceOfFundsExplanation?.trim() || undefined,
          evidenceRequired,
          savedAt: now,
        },
        tx,
      );
      if (evidenceRequired) {
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'SOURCE_OF_FUNDS_EVIDENCE',
            status: 'OPEN',
            details: { profileVersion: version },
            createdAt: now,
          },
          tx,
        );
      }
      const declarationsDone = hasCompleted(app, 'DECLARATIONS');
      const nextScreen = declarationsDone ? 'BANK_DETAILS' : 'TAX_DECLARATIONS';
      const advanced = completeStep(
        app,
        'PROFILE',
        declarationsDone ? app.nextScreen : 'TAX_DECLARATIONS',
        now,
      );
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      if (declarationsDone) {
        // Material profile change reopens the AML assessment with the new inputs.
        const identity = await this.identities.latest(app.id, tx);
        const decl = await this.declarations.latest(app.id, tx);
        await this.compliance.supersedeOpen(app.id, tx, 'AML');
        const assessmentId = this.ids.prefixed(ID_PREFIX.amlAssessment);
        await this.compliance.createAmlAssessment(
          {
            id: assessmentId,
            applicationId: app.id,
            identityVersion: identity?.version ?? 0,
            profileVersion: version,
            declarationVersion: decl?.version ?? 0,
            policyVersion: AML_POLICY_VERSION,
            status: 'QUEUED',
            createdAt: now,
          },
          tx,
        );
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'AmlAssessmentRequested',
            payload: { assessmentId },
          },
          tx,
        );
      }
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'profile.saved',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { profileVersion: version, evidenceRequired },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'PROFILE' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Customer Profile Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_PROFILE,
          outcome: evidenceRequired ? 'evidence_required' : 'complete',
        },
        tx,
      );
      return { status: 'COMPLETE', profileVersion: version, nextScreen };
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
