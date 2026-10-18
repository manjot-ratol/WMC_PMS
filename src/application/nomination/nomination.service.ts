import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../common/errors/app-error';
import {
  NOMINATION_RULEBOOK,
  validateNomination,
  type NominationInput,
  type NominationRulebook,
} from '../../domain/nomination/nomination';
import { completeStep, requireStep } from '../../domain/onboarding/application';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  NOMINATION_REPOSITORY,
  type NominationRepositoryPort,
} from '../ports/nomination.repository.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface SaveNominationCommand extends NominationInput {
  applicationId: string;
  customerId: string;
}
export const SCREEN_NOMINATION = '16';

/** Screen 16: capture the nomination instruction (capture is not registration). */
@Injectable()
export class NominationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(NOMINATION_REPOSITORY)
    private readonly nominations: NominationRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(NOMINATION_RULEBOOK) private readonly rulebook: NominationRulebook,
  ) {}

  async save(cmd: SaveNominationCommand): Promise<{
    status: 'CAPTURED';
    registrationStatus: 'NOT_SUBMITTED';
    nominationVersion: number;
    nextScreen: 'INVESTMENT_PROFILE';
  }> {
    const nominees = validateNomination(cmd, this.rulebook);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      requireStep(app, 'BANK');
      const previous = await this.nominations.latest(app.id, tx);
      const version = (previous?.version ?? 0) + 1;
      await this.nominations.append(
        {
          applicationId: app.id,
          version,
          choice: cmd.choice,
          allocationMode:
            cmd.choice === 'NOMINATE'
              ? (cmd.allocationMode ?? 'EQUAL')
              : undefined,
          nominees,
          registrationStatus: 'NOT_SUBMITTED',
          savedAt: now,
        },
        tx,
      );
      await this.applications.saveWithVersionCheck(
        completeStep(app, 'NOMINATION', 'INVESTMENT_PROFILE', now),
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'nomination.saved',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            nominationVersion: version,
            choice: cmd.choice,
            nomineeCount: nominees.length,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'NOMINATION' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Nomination Instruction Saved',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_NOMINATION,
          outcome: cmd.choice.toLowerCase(),
        },
        tx,
      );
      return {
        status: 'CAPTURED',
        registrationStatus: 'NOT_SUBMITTED',
        nominationVersion: version,
        nextScreen: 'INVESTMENT_PROFILE',
      };
    });
  }
}
