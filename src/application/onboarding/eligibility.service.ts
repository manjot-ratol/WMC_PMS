import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors/app-error';
import {
  evaluateEligibility,
  type EligibilityDecision,
  type EligibilityInput,
} from '../../domain/eligibility/eligibility-engine';
import {
  ELIGIBILITY_RULEBOOK,
  type EligibilityRulebook,
} from '../../domain/eligibility/eligibility-rulebook';
import {
  applyEligibility,
  requireStep,
} from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  ELIGIBILITY_REPOSITORY,
  type EligibilityRepositoryPort,
} from '../ports/eligibility.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

const SCREEN_ELIGIBILITY = '05';

@Injectable()
export class EligibilityService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(ELIGIBILITY_REPOSITORY)
    private readonly decisions: EligibilityRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(ELIGIBILITY_RULEBOOK)
    private readonly rulebook: EligibilityRulebook,
  ) {}

  async evaluate(
    applicationId: string,
    customerId: string,
    input: EligibilityInput,
  ): Promise<EligibilityDecision> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(applicationId, tx);
      if (!app || app.customerId !== customerId) throw new NotFoundError();
      requireStep(app, 'EMAIL_VERIFIED');
      const decision = evaluateEligibility(input, this.rulebook);
      const updated = applyEligibility(app, decision, now);
      await this.applications.saveWithVersionCheck(updated, app.version, tx);
      await this.decisions.append(
        {
          id: this.ids.prefixed(ID_PREFIX.eligibility),
          applicationId: app.id,
          version: updated.version,
          input,
          ...decision,
          decidedAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customerId,
          action: 'eligibility.evaluated',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            status: decision.status,
            rulesetVersion: decision.rulesetVersion,
            reasons: decision.reasons,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'EligibilityEvaluated',
          payload: { status: decision.status },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Eligibility Evaluation Completed',
          identity: customerId,
          applicationId: app.id,
          screenId: SCREEN_ELIGIBILITY,
          outcome: decision.status.toLowerCase(),
        },
        tx,
      );
      return decision;
    });
  }
}
