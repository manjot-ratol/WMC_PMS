import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import {
  evaluateScreening,
  type ScreeningEvaluation,
} from '../../domain/compliance/as501';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { toAs501Request } from '../../infrastructure/partners/trackwizz/trackwizz.mapper';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ComplianceService } from '../compliance/compliance.service';
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
  type ScreeningRunRecord,
} from '../ports/compliance.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  TRACKWIZZ_GATEWAY,
  type TrackWizzGatewayPort,
} from '../ports/trackwizz-gateway.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface ScreeningJobPayload {
  payload?: { screeningRunId?: string };
}
export const SCREEN_PROCESSING_JOBS = '22';

/** Job A: AS501 initial + continuous screening. Proceed only when every validation passes; errors never clear. */
@Processor(QUEUES.SCREENING)
export class ScreeningProcessor extends BaseProcessor<ScreeningJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    private readonly service: ComplianceService,
    @Inject(TRACKWIZZ_GATEWAY) private readonly trackwizz: TrackWizzGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {
    super(store);
    this.logger = logger.child('ScreeningProcessor');
  }

  async handle(data: ScreeningJobPayload, job?: Job): Promise<void> {
    const id = data.payload?.screeningRunId;
    if (!id) return;
    const run = await this.compliance.findScreeningRun(id);
    if (!run || run.status !== 'QUEUED') return;
    const subject = await this.service.subject(run.applicationId);
    const now = this.clock.now();
    if (!subject) {
      await this.compliance.updateScreeningRun({
        ...run,
        status: 'ERROR',
        safeErrorCategory: 'subject_unavailable',
        completedAt: now,
      });
      return;
    }
    await this.compliance.updateScreeningRun({ ...run, status: 'RUNNING' });

    const purposes = this.service.codebook.screeningPurposes;
    const request = toAs501Request(
      run.id,
      purposes,
      subject,
      this.service.codebook,
      this.service.sourceSystemName,
      now,
    );
    let evaluation: ScreeningEvaluation;
    let evidenceKey: string | undefined;
    try {
      const result = await this.trackwizz.submit(request);
      evidenceKey = `compliance/${run.applicationId}/screening/${run.id}.json`;
      await this.storage.put(
        evidenceKey,
        JSON.stringify({
          request: { requestId: request.requestId, purpose: request.purpose },
          envelope: result.envelope,
          response: result.response,
        }),
        'application/json',
      );
      evaluation = evaluateScreening(result.response, {
        requestId: run.id,
        customerCode: subject.customerId,
        purposeCodes: purposes.split(','),
      });
    } catch (err) {
      if (
        err instanceof DependencyUnavailableError &&
        (job?.attemptsMade ?? 0) + 1 < (job?.opts?.attempts ?? 1)
      ) {
        await this.compliance.updateScreeningRun({ ...run, status: 'QUEUED' });
        throw err;
      }
      if (
        !(err instanceof DependencyUnavailableError) &&
        !(err instanceof PartnerRejectedError)
      ) {
        // Never leave a run RUNNING: a retry would skip it forever. Record, then surface the bug.
        await this.compliance.updateScreeningRun({
          ...run,
          status: 'ERROR',
          safeErrorCategory: 'unexpected_error',
          completedAt: now,
        });
        throw err;
      }
      const category =
        err instanceof PartnerRejectedError
          ? (err.details as { category?: string } | undefined)?.category ===
              'signature_invalid' ||
            (err.details as { category?: string } | undefined)?.category ===
              'key_unwrap_failed' ||
            (err.details as { category?: string } | undefined)?.category ===
              'decrypt_failed'
            ? 'envelope_invalid'
            : 'provider_rejected'
          : 'provider_unavailable';
      evaluation = { outcome: 'ERROR', category, matchTypes: [] };
      this.logger.warn('screening.failed', {
        screeningRunId: run.id,
        category,
      });
    }
    await this.record(run, evaluation, evidenceKey, now);
  }

  private async record(
    run: ScreeningRunRecord,
    e: ScreeningEvaluation,
    evidenceKey: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.compliance.updateScreeningRun(
        {
          ...run,
          status: e.outcome,
          suggestedAction: e.suggestedAction,
          hitsCount: e.hitsCount,
          confirmedHit: e.confirmedHit,
          providerRequestId: run.id,
          evidenceKey,
          safeErrorCategory: e.category,
          completedAt: now,
        },
        tx,
      );
      if (e.outcome === 'REVIEW' || e.outcome === 'STOP') {
        await this.compliance.createCase(
          {
            id: this.ids.prefixed(ID_PREFIX.complianceCase),
            applicationId: run.applicationId,
            kind: 'SCREENING_HIT',
            sourceRunId: run.id,
            severity: e.outcome === 'STOP' ? 'HIGH' : 'MEDIUM',
            status: 'OPEN',
            providerCaseId: e.providerCaseId,
            providerCaseUrl: e.providerCaseUrl,
            summary: {
              suggestedAction: e.suggestedAction,
              hitsCount: e.hitsCount,
              confirmedHit: e.confirmedHit,
              matchTypes: e.matchTypes,
              category: e.category,
            },
            createdAt: now,
          },
          tx,
        );
      }
      const app = await this.applications.findById(run.applicationId, tx);
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'trackwizz',
          action: 'screening.completed',
          aggregateType: 'application',
          aggregateId: run.applicationId,
          details: {
            screeningRunId: run.id,
            outcome: e.outcome,
            category: e.category,
            hitsCount: e.hitsCount,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: run.applicationId,
          eventType: 'ComplianceOutcomeRecorded',
          payload: {
            applicationId: run.applicationId,
            kind: 'SCREENING',
            outcome: e.outcome,
          },
        },
        tx,
      );
      if (app)
        await this.analytics.track(
          {
            name: 'Application Processing Updated',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_PROCESSING_JOBS,
            outcome:
              e.outcome === 'PROCEED'
                ? 'screening_clear'
                : e.outcome === 'ERROR'
                  ? 'screening_error'
                  : 'screening_review',
            safeErrorCategory: e.outcome === 'ERROR' ? e.category : undefined,
          },
          tx,
        );
    });
  }
}
