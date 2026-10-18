import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import {
  FundingService,
  SCREEN_COMPLETE,
  SCREEN_FUNDING_STATUS,
} from '../funding/funding.service';
import {
  ACTIVATION_REPOSITORY,
  type ActivationRepositoryPort,
} from '../ports/activation.repository.port';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface ActivationJobPayload {
  payload?: { applicationId?: string };
}

/** Job D (activation): re-evaluates every gate inside one version-checked transaction and activates exactly once. */
@Processor(QUEUES.ACTIVATION)
export class ActivationProcessor extends BaseProcessor<ActivationJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(ACTIVATION_REPOSITORY)
    private readonly activations: ActivationRepositoryPort,
    private readonly funding: FundingService,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {
    super(store);
    this.logger = logger.child('ActivationProcessor');
  }

  async handle(data: ActivationJobPayload): Promise<void> {
    const applicationId = data.payload?.applicationId;
    if (!applicationId) return;
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(applicationId, tx);
      if (!app || app.status !== 'SUBMITTED') return;
      if (await this.activations.findByApplication(app.id, tx)) return;
      const gates = await this.funding.evaluateGates(app, tx);
      if (!gates.ready || !gates.pmsAccountReference) {
        this.logger.info('activation.not_ready', {
          applicationId,
          blockers: gates.blockers,
        });
        await this.audit.append(
          {
            actorType: 'SYSTEM',
            action: 'activation.evaluated',
            aggregateType: 'application',
            aggregateId: app.id,
            details: { ready: false, blockers: gates.blockers },
          },
          tx,
        );
        return;
      }
      const activation = {
        id: this.ids.prefixed(ID_PREFIX.activation),
        applicationId: app.id,
        pmsAccountId: gates.pmsAccountReference,
        gateSnapshot: {
          blockers: [],
          fundingStatus: gates.fundingStatus,
          evaluatedAt: now.toISOString(),
        },
        activatedAt: now,
      };
      await this.activations.create(activation, tx);
      const advanced = {
        ...completeStep(
          completeStep(app, 'FUNDING', 'ACTIVATION_PROGRESS', now),
          'ACTIVATION',
          'PORTFOLIO',
          now,
        ),
        status: 'ACTIVE' as const,
      };
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      await this.audit.append(
        {
          actorType: 'SYSTEM',
          action: 'application.activated',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { activationId: activation.id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'PmsAccountActivated',
          payload: { activationId: activation.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'PMS Account Activated',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_FUNDING_STATUS,
          outcome: 'active',
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Onboarding Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_COMPLETE,
          outcome: 'complete',
        },
        tx,
      );
    });
  }
}
