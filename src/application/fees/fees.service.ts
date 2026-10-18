import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  DOCUMENT_PACK_RULEBOOK,
  validateAcknowledgements,
  type AcknowledgementItemInput,
  type DocumentPackRulebook,
} from '../../domain/documents/document-pack';
import {
  FEE_RULEBOOK,
  illustrateFees,
  type FeeLineItem,
  type FeeRulebook,
} from '../../domain/fees/fee-engine';
import {
  completeStep,
  requireStep,
  type OnboardingApplication,
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
  FEE_REPOSITORY,
  type FeeRepositoryPort,
} from '../ports/fee.repository.port';
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

export interface IllustrateCommand {
  applicationId: string;
  customerId: string;
  approachCode: string;
  feeScheduleVersion: string;
  scenarioCode: string;
}
export interface AcknowledgeCommand {
  applicationId: string;
  customerId: string;
  documentPackVersion: number;
  acknowledgements: AcknowledgementItemInput[];
  feeUnderstandingNote: string;
}
export const SCREEN_FEES = '19';

/** Screen 19: rulebook-driven fee illustration and distinct acknowledgements of the versioned pack. */
@Injectable()
export class FeesService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(SUITABILITY_REPOSITORY)
    private readonly suitability: SuitabilityRepositoryPort,
    @Inject(FEE_REPOSITORY) private readonly fees: FeeRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(FEE_RULEBOOK) private readonly feeRulebook: FeeRulebook,
    @Inject(DOCUMENT_PACK_RULEBOOK) private readonly pack: DocumentPackRulebook,
  ) {}

  async illustrate(cmd: IllustrateCommand): Promise<{
    status: 'CALCULATED';
    illustrationId: string;
    lineItems: FeeLineItem[];
    disclaimerVersion: string;
  }> {
    if (cmd.feeScheduleVersion !== this.feeRulebook.version)
      throw new StaleVersionError(undefined, {
        details: { currentFeeScheduleVersion: this.feeRulebook.version },
      });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.load(cmd.applicationId, cmd.customerId, tx);
      requireStep(app, 'APPROACH');
      const approach = await this.suitability.latestApproach(app.id, tx);
      if (!approach || approach.approachCode !== cmd.approachCode)
        throw new ValidationError(undefined, {
          details: { field: 'approach_code', reason: 'approach_mismatch' },
        });
      const illustration = illustrateFees(
        cmd.approachCode,
        cmd.scenarioCode,
        this.feeRulebook,
      );
      const id = this.ids.prefixed(ID_PREFIX.feeIllustration);
      await this.fees.createIllustration(
        { ...illustration, id, applicationId: app.id, createdAt: now },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'fee_illustration.calculated',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            illustrationId: id,
            scenarioCode: cmd.scenarioCode,
            feeScheduleVersion: illustration.feeScheduleVersion,
          },
        },
        tx,
      );
      return {
        status: 'CALCULATED',
        illustrationId: id,
        lineItems: illustration.lineItems,
        disclaimerVersion: illustration.disclaimerVersion,
      };
    });
  }

  async acknowledge(cmd: AcknowledgeCommand): Promise<{
    status: 'RECORDED';
    feeAnnexureExecutionRequired: boolean;
    nextScreen: 'APPLICATION_REVIEW';
  }> {
    const { feeAnnexureExecutionRequired, items, note } =
      validateAcknowledgements(cmd, this.pack);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.load(cmd.applicationId, cmd.customerId, tx);
      requireStep(app, 'APPROACH');
      const version =
        ((await this.fees.latestAcknowledgement(app.id, tx))?.version ?? 0) + 1;
      await this.fees.appendAcknowledgement(
        {
          applicationId: app.id,
          version,
          documentPackVersion: cmd.documentPackVersion,
          items,
          feeUnderstandingNote: note,
          feeAnnexureExecutionRequired,
          recordedAt: now,
        },
        tx,
      );
      await this.applications.saveWithVersionCheck(
        completeStep(app, 'ACKNOWLEDGEMENTS', 'APPLICATION_REVIEW', now),
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'acknowledgements.recorded',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            version,
            documentPackVersion: cmd.documentPackVersion,
            documentTypes: items.map((i) => i.documentType),
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'ACKNOWLEDGEMENTS' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Required Acknowledgements Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_FEES,
          outcome: 'recorded',
        },
        tx,
      );
      return {
        status: 'RECORDED',
        feeAnnexureExecutionRequired,
        nextScreen: 'APPLICATION_REVIEW',
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
