import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  completeStep,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  SUITABILITY_RULEBOOK,
  assertApproachPermitted,
  assessSuitability,
  type Answer,
  type SuitabilityRulebook,
} from '../../domain/suitability/suitability';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  SUITABILITY_REPOSITORY,
  type SuitabilityRepositoryPort,
} from '../ports/suitability.repository.port';
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';

export interface AssessCommand {
  applicationId: string;
  customerId: string;
  questionnaireVersion: string;
  answers: Answer[];
}
export interface ConfirmApproachCommand {
  applicationId: string;
  customerId: string;
  assessmentId: string;
  assessmentVersion: number;
  approachCode: string;
  confirmed: boolean;
}
export const SCREEN_SUITABILITY = '17';
export const SCREEN_APPROACH = '18';

/** Screens 17–18: server-side suitability scoring and the approach the assessment permits. */
@Injectable()
export class SuitabilityService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(SUITABILITY_REPOSITORY)
    private readonly suitability: SuitabilityRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(SUITABILITY_RULEBOOK)
    private readonly rulebook: SuitabilityRulebook,
  ) {}

  async assess(cmd: AssessCommand): Promise<{
    assessmentId: string;
    status: 'COMPLETE' | 'INCOMPLETE';
    missingQuestionIds: string[];
    nextScreen: 'INVESTMENT_PROFILE' | 'INVESTMENT_APPROACH';
  }> {
    if (cmd.questionnaireVersion !== this.rulebook.version)
      throw new StaleVersionError(undefined, {
        details: { currentQuestionnaireVersion: this.rulebook.version },
      });
    const result = assessSuitability(cmd.answers, this.rulebook);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.load(cmd.applicationId, cmd.customerId, tx);
      requireStep(app, 'NOMINATION');
      const previous = await this.suitability.latestAssessment(app.id, tx);
      const id = this.ids.prefixed(ID_PREFIX.suitabilityAssessment);
      const version = (previous?.version ?? 0) + 1;
      await this.suitability.appendAssessment(
        {
          ...result,
          id,
          applicationId: app.id,
          version,
          questionnaireVersion: cmd.questionnaireVersion,
          answers: cmd.answers,
          createdAt: now,
        },
        tx,
      );
      const complete = result.status === 'COMPLETE';
      if (complete) {
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'SUITABILITY', 'INVESTMENT_APPROACH', now),
          app.version,
          tx,
        );
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'StepCompleted',
            payload: { stepId: 'SUITABILITY' },
          },
          tx,
        );
      }
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'suitability.assessed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            assessmentId: id,
            version,
            status: result.status,
            answered: cmd.answers.length,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Suitability Assessment Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_SUITABILITY,
          outcome: complete ? 'complete' : 'incomplete',
        },
        tx,
      );
      return {
        assessmentId: id,
        status: result.status,
        missingQuestionIds: result.missingQuestionIds,
        nextScreen: complete ? 'INVESTMENT_APPROACH' : 'INVESTMENT_PROFILE',
      };
    });
  }

  async confirmApproach(cmd: ConfirmApproachCommand): Promise<{
    status: 'CONFIRMED';
    approachVersion: number;
    nextScreen: 'FEES_DISCLOSURES';
  }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.load(cmd.applicationId, cmd.customerId, tx);
      requireStep(app, 'SUITABILITY');
      const latest = await this.suitability.latestAssessment(app.id, tx);
      if (
        !latest ||
        latest.id !== cmd.assessmentId ||
        latest.version !== cmd.assessmentVersion
      )
        throw new StaleVersionError(undefined, {
          details: {
            currentAssessmentId: latest?.id,
            currentAssessmentVersion: latest?.version,
          },
        });
      if (cmd.confirmed !== true)
        throw new ValidationError(undefined, {
          details: { field: 'confirmed', reason: 'confirmation_required' },
        });
      assertApproachPermitted(latest, cmd.approachCode, this.rulebook);
      const version =
        ((await this.suitability.latestApproach(app.id, tx))?.version ?? 0) + 1;
      await this.suitability.appendApproach(
        {
          applicationId: app.id,
          version,
          assessmentId: latest.id,
          assessmentVersion: latest.version,
          approachCode: cmd.approachCode,
          confirmedAt: now,
        },
        tx,
      );
      await this.applications.saveWithVersionCheck(
        completeStep(app, 'APPROACH', 'FEES_DISCLOSURES', now),
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'investment_approach.confirmed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            approachVersion: version,
            assessmentVersion: latest.version,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'APPROACH' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Investment Approach Saved',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_APPROACH,
          outcome: 'confirmed',
        },
        tx,
      );
      return {
        status: 'CONFIRMED',
        approachVersion: version,
        nextScreen: 'FEES_DISCLOSURES',
      };
    });
  }

  private async load(
    applicationId: string,
    customerId: string,
    tx: TransactionContext,
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
