import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import {
  evaluateProviderStatus,
  type KycSession,
} from '../../domain/kyc/kyc-session';
import { completeStep } from '../../domain/onboarding/application';
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
  DIGISTUDIO_GATEWAY,
  type DigiStudioGatewayPort,
} from '../ports/digistudio-gateway.port';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../ports/job-publisher.port';
import {
  KYC_RECORD_REPOSITORY,
  KYC_SESSION_REPOSITORY,
  type KycRecordRepositoryPort,
  type KycSessionRepositoryPort,
} from '../ports/kyc.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import { SCREEN_FRESH_KYC } from '../kyc/kyc-session.service';

export interface KycPollPayload {
  payload?: { sessionId: string };
  sessionId?: string;
}

export const POLL_JOB = 'poll';
export const POLL_MAX_AGE_MS = 24 * 3600 * 1000;
export const pollDelayMs = (pollCount: number): number =>
  Math.min(30_000 * 2 ** Math.min(pollCount, 6), 15 * 60_000);

/** Screen 09 follow-up: polls DigiStudio until the request is approved or terminal. Webhooks trigger an immediate poll. */
@Processor(QUEUES.KYC_STATUS)
export class KycStatusPollProcessor extends BaseProcessor<KycPollPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(KYC_SESSION_REPOSITORY)
    private readonly sessions: KycSessionRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(DIGISTUDIO_GATEWAY)
    private readonly digistudio: DigiStudioGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(JOB_PUBLISHER) private readonly jobs: JobPublisherPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {
    super(store);
    this.logger = logger.child('KycStatusPollProcessor');
  }

  async handle(data: KycPollPayload): Promise<void> {
    const sessionId = data.payload?.sessionId ?? data.sessionId;
    if (!sessionId) return;
    const session = await this.sessions.findById(sessionId);
    if (
      !session?.providerRequestId ||
      ['COMPLETED', 'REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(
        session.status,
      )
    )
      return;
    const now = this.clock.now();

    const status = await this.digistudio.getStatus(session.providerRequestId);
    await this.storage.put(
      `applications/${session.applicationId}/kyc-sessions/${session.id}/status-${now.getTime()}.json`,
      JSON.stringify(status.raw),
      'application/json',
    );
    const evaluation = evaluateProviderStatus({
      requestStatus: status.status,
      actions: status.actions.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        optional: a.optional,
        processingDone: a.processingDone,
        faceMatchStatus: a.faceMatchStatus,
      })),
    });
    const polled: KycSession = {
      ...session,
      pollCount: session.pollCount + 1,
      lastProviderStatus: status.status,
      updatedAt: now,
    };

    if (evaluation.outcome === 'COMPLETED') {
      const selfieDone = status.actions.some(
        (a) =>
          a.type === 'selfie' &&
          ['success', 'approved'].includes(a.status ?? '') &&
          a.faceMatchStatus === 'done',
      );
      await this.uow.run(async (tx) => {
        await this.sessions.update(
          { ...polled, status: 'COMPLETED', completedAt: now },
          tx,
        );
        const app = await this.applications.findById(session.applicationId, tx);
        const record = await this.kycRecords.latestForApplication(
          session.applicationId,
          tx,
        );
        if (!app || !record) return;
        await this.kycRecords.saveWithVersionCheck(
          {
            ...record,
            status: 'COMPLETE',
            provider: 'DIGIO_STUDIO',
            confirmedAt: now,
            ipvExemptionBasis: selfieDone
              ? 'DIGISTUDIO_SELFIE'
              : record.ipvExemptionBasis,
            version: record.version + 1,
            updatedAt: now,
          },
          record.version,
          tx,
        );
        let advanced = completeStep(
          app,
          'KYC',
          selfieDone ? 'PROFILE' : 'IPV',
          now,
        );
        if (selfieDone)
          advanced = completeStep(advanced, 'IPV', 'PROFILE', now);
        await this.applications.saveWithVersionCheck(advanced, app.version, tx);
        await this.audit.append(
          {
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'kyc_session.completed',
            aggregateType: 'application',
            aggregateId: app.id,
            details: {
              sessionId: session.id,
              providerRequestId: session.providerRequestId,
              selfieDone,
            },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Digital KYC Completed',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_FRESH_KYC,
            outcome: 'completed',
          },
          tx,
        );
      });
      return;
    }

    if (evaluation.outcome === 'TERMINAL') {
      await this.uow.run(async (tx) => {
        await this.sessions.update(
          {
            ...polled,
            status: evaluation.status,
            safeErrorCategory: evaluation.category,
            completedAt: now,
          },
          tx,
        );
        const app = await this.applications.findById(session.applicationId, tx);
        if (!app) return;
        await this.applications.saveWithVersionCheck(
          { ...app, nextScreen: 'FRESH_KYC', version: app.version + 1 },
          app.version,
          tx,
        );
        await this.audit.append(
          {
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'kyc_session.terminal',
            aggregateType: 'application',
            aggregateId: app.id,
            details: { sessionId: session.id, status: evaluation.status },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Digital KYC Completed',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_FRESH_KYC,
            outcome: 'failed',
            safeErrorCategory: evaluation.category,
          },
          tx,
        );
      });
      return;
    }

    const tooOld =
      now.getTime() - session.createdAt.getTime() > POLL_MAX_AGE_MS;
    const nextStatus: KycSession['status'] = tooOld
      ? 'EXPIRED'
      : evaluation.outcome === 'APPROVAL_PENDING'
        ? 'APPROVAL_PENDING'
        : 'IN_PROGRESS';
    await this.sessions.update({
      ...polled,
      status: nextStatus,
      safeErrorCategory: tooOld ? 'poll_timeout' : undefined,
    });
    if (tooOld) {
      this.logger.warn('kyc_session.poll_timeout', { sessionId: session.id });
      return;
    }
    await this.jobs.publish(
      QUEUES.KYC_STATUS,
      POLL_JOB,
      { sessionId: session.id },
      {
        jobId: `${session.id}-poll-${polled.pollCount}`,
        delayMs: pollDelayMs(polled.pollCount),
      },
    );
  }
}
