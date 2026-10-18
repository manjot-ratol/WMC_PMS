import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import { completeStep } from '../../domain/onboarding/application';
import {
  evaluateSignStatus,
  TERMINAL_SIGNING_STATUSES,
  type SigningSession,
} from '../../domain/signing/signing-session';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  ESIGN_GATEWAY,
  type EsignGatewayPort,
} from '../ports/esign-gateway.port';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../ports/job-publisher.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from '../ports/review.repository.port';
import {
  SIGNING_REPOSITORY,
  type SigningRepositoryPort,
} from '../ports/signing.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import { SCREEN_SIGNING } from '../signing/signing.service';
import { pollDelayMs } from './kyc-status-poll.processor';

export interface SigningPollPayload {
  payload?: { signingSessionId: string };
  signingSessionId?: string;
}
export const SIGNING_POLL_JOB = 'poll';
export const SIGNING_POLL_MAX_AGE_MS = 11 * 24 * 3600 * 1000;

/** Screen 21 follow-up: Digio document status decides execution; the signed pack is stored before the step completes. */
@Processor(QUEUES.SIGNING)
export class SigningStatusProcessor extends BaseProcessor<SigningPollPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(SIGNING_REPOSITORY) private readonly signing: SigningRepositoryPort,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepositoryPort,
    @Inject(ESIGN_GATEWAY) private readonly esign: EsignGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(JOB_PUBLISHER) private readonly jobs: JobPublisherPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {
    super(store);
    this.logger = logger.child('SigningStatusProcessor');
  }

  async handle(data: SigningPollPayload): Promise<void> {
    const id = data.payload?.signingSessionId ?? data.signingSessionId;
    if (!id) return;
    const session = await this.signing.findById(id);
    if (
      !session?.providerRequestId ||
      TERMINAL_SIGNING_STATUSES.includes(session.status)
    )
      return;
    const now = this.clock.now();

    // A superseded snapshot can never be executed by a late callback.
    const current = await this.reviews.current(session.applicationId);
    if (!current || current.id !== session.snapshotId) {
      await this.signing.update({
        ...session,
        status: 'SUPERSEDED',
        safeErrorCategory: 'snapshot_superseded',
        updatedAt: now,
      });
      await this.audit.append({
        actorType: 'SYSTEM',
        action: 'signing_session.superseded',
        aggregateType: 'application',
        aggregateId: session.applicationId,
        details: {
          signingSessionId: session.id,
          snapshotId: session.snapshotId,
        },
      });
      return;
    }

    const status = await this.esign.getDocument(session.providerRequestId);
    await this.storage.put(
      `applications/${session.applicationId}/packs/${session.id}/status-${now.getTime()}.json`,
      JSON.stringify(status.raw),
      'application/json',
    );
    const evaluation = evaluateSignStatus({
      agreementStatus: status.agreementStatus,
      signers: status.signers,
    });
    const polled: SigningSession = {
      ...session,
      pollCount: session.pollCount + 1,
      lastProviderStatus: status.agreementStatus,
      updatedAt: now,
    };

    if (evaluation.outcome === 'EXECUTED') {
      const signed = await this.esign.downloadSigned(session.providerRequestId);
      const evidenceKey = `applications/${session.applicationId}/packs/${session.id}/signed-pack.pdf`;
      await this.storage.put(evidenceKey, signed, 'application/pdf');
      await this.uow.run(async (tx) => {
        const app = await this.applications.findById(session.applicationId, tx);
        if (!app) return;
        await this.signing.update(
          { ...polled, status: 'EXECUTED', evidenceKey, executedAt: now },
          tx,
        );
        const advanced = {
          ...completeStep(app, 'SIGNING', 'APPLICATION_PROCESSING', now),
          status: 'SUBMITTED' as const,
        };
        await this.applications.saveWithVersionCheck(advanced, app.version, tx);
        await this.audit.append(
          {
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'signing_session.executed',
            aggregateType: 'application',
            aggregateId: app.id,
            details: {
              signingSessionId: session.id,
              providerRequestId: session.providerRequestId,
              evidenceKey,
              packSha256: session.packSha256,
            },
          },
          tx,
        );
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'DocumentPackExecuted',
            payload: {
              signingSessionId: session.id,
              snapshotId: session.snapshotId,
              documentPackVersion: session.documentPackVersion,
            },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Document Pack Executed',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_SIGNING,
            outcome: 'executed',
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Application Submitted',
            identity: app.customerId,
            applicationId: app.id,
            screenId: '22',
            outcome: 'submitted',
          },
          tx,
        );
      });
      return;
    }

    if (evaluation.outcome === 'TERMINAL') {
      await this.uow.run(async (tx) => {
        await this.signing.update(
          {
            ...polled,
            status: evaluation.status,
            safeErrorCategory: evaluation.category,
          },
          tx,
        );
        const app = await this.applications.findById(session.applicationId, tx);
        if (!app) return;
        await this.audit.append(
          {
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'signing_session.terminal',
            aggregateType: 'application',
            aggregateId: app.id,
            details: {
              signingSessionId: session.id,
              status: evaluation.status,
            },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Document Execution Updated',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_SIGNING,
            outcome: evaluation.status.toLowerCase(),
            safeErrorCategory: evaluation.category,
          },
          tx,
        );
      });
      return;
    }

    const tooOld =
      now.getTime() - session.createdAt.getTime() > SIGNING_POLL_MAX_AGE_MS;
    if (tooOld) {
      await this.signing.update({
        ...polled,
        status: 'EXPIRED',
        safeErrorCategory: 'poll_timeout',
      });
      this.logger.warn('signing_session.poll_timeout', {
        signingSessionId: session.id,
      });
      return;
    }
    if (evaluation.status !== session.status) {
      await this.audit.append({
        actorType: 'PARTNER',
        actorId: 'digio',
        action: 'signing_session.progress',
        aggregateType: 'application',
        aggregateId: session.applicationId,
        details: { signingSessionId: session.id, status: evaluation.status },
      });
    }
    await this.signing.update({ ...polled, status: evaluation.status });
    await this.jobs.publish(
      QUEUES.SIGNING,
      SIGNING_POLL_JOB,
      { signingSessionId: session.id },
      {
        jobId: `${session.id}-poll-${polled.pollCount}`,
        delayMs: pollDelayMs(polled.pollCount),
      },
    );
  }
}
