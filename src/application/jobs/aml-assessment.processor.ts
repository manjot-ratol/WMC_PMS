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
  evaluateRiskRating,
  type RiskEvaluation,
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
  type AmlAssessmentRecord,
  type ComplianceRepositoryPort,
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
import { SCREEN_PROCESSING_JOBS } from './screening.processor';

export interface AmlJobPayload {
  payload?: { assessmentId?: string };
}
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
/** DD-MMM-YYYY from TrackWizz to a UTC date; undefined when unparseable (never guessed). */
export function parseTrackWizzDate(v: string | undefined): Date | undefined {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(v ?? '');
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  return month === undefined
    ? undefined
    : new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

/** Job B: AS501 purpose 06 risk rating. High opens an EDD case; it is never an automatic rejection. */
@Processor(QUEUES.AML)
export class AmlAssessmentProcessor extends BaseProcessor<AmlJobPayload> {
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
    this.logger = logger.child('AmlAssessmentProcessor');
  }

  async handle(data: AmlJobPayload, job?: Job): Promise<void> {
    const id = data.payload?.assessmentId;
    if (!id) return;
    const a = await this.compliance.findAmlAssessment(id);
    if (!a || a.status !== 'QUEUED') return;
    const subject = await this.service.subject(a.applicationId);
    const now = this.clock.now();
    if (!subject) {
      await this.compliance.updateAmlAssessment({
        ...a,
        status: 'ERROR',
        safeErrorCategory: 'subject_unavailable',
        completedAt: now,
      });
      return;
    }
    await this.compliance.updateAmlAssessment({ ...a, status: 'RUNNING' });
    const purpose = this.service.codebook.riskPurpose;
    const request = toAs501Request(
      a.id,
      purpose,
      subject,
      this.service.codebook,
      this.service.sourceSystemName,
      now,
    );
    let evaluation: RiskEvaluation;
    let evidenceKey: string | undefined;
    try {
      const result = await this.trackwizz.submit(request);
      evidenceKey = `compliance/${a.applicationId}/aml/${a.id}.json`;
      await this.storage.put(
        evidenceKey,
        JSON.stringify({
          request: { requestId: request.requestId, purpose },
          envelope: result.envelope,
          response: result.response,
        }),
        'application/json',
      );
      evaluation = evaluateRiskRating(result.response, {
        requestId: a.id,
        customerCode: subject.customerId,
        purposeCodes: [purpose],
      });
    } catch (err) {
      if (
        err instanceof DependencyUnavailableError &&
        (job?.attemptsMade ?? 0) + 1 < (job?.opts?.attempts ?? 1)
      ) {
        await this.compliance.updateAmlAssessment({ ...a, status: 'QUEUED' });
        throw err;
      }
      if (
        !(err instanceof DependencyUnavailableError) &&
        !(err instanceof PartnerRejectedError)
      )
        throw err;
      const detail = (err.details as { category?: string } | undefined)
        ?.category;
      const category =
        err instanceof PartnerRejectedError
          ? detail &&
            [
              'signature_invalid',
              'key_unwrap_failed',
              'decrypt_failed',
            ].includes(detail)
            ? 'envelope_invalid'
            : 'provider_rejected'
          : 'provider_unavailable';
      evaluation = { outcome: 'ERROR', category, reportAvailable: false };
      this.logger.warn('aml.failed', { assessmentId: a.id, category });
    }
    await this.record(a, evaluation, evidenceKey, now);
  }

  private async record(
    a: AmlAssessmentRecord,
    e: RiskEvaluation,
    evidenceKey: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.compliance.updateAmlAssessment(
        {
          ...a,
          status: e.outcome,
          riskValue: e.riskValue,
          nextReviewDate: parseTrackWizzDate(e.nextReviewDate),
          providerRequestId: a.id,
          evidenceKey,
          safeErrorCategory: e.category,
          completedAt: now,
        },
        tx,
      );
      if (e.outcome === 'REVIEW') {
        await this.compliance.createCase(
          {
            id: this.ids.prefixed(ID_PREFIX.complianceCase),
            applicationId: a.applicationId,
            kind: 'AML_HIGH_RISK',
            sourceRunId: a.id,
            severity: 'HIGH',
            status: 'OPEN',
            summary: {
              riskValue: e.riskValue,
              nextReviewDate: e.nextReviewDate,
              reportAvailable: e.reportAvailable,
              process: 'ENHANCED_DUE_DILIGENCE',
            },
            createdAt: now,
          },
          tx,
        );
      }
      const app = await this.applications.findById(a.applicationId, tx);
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'trackwizz',
          action: 'aml.completed',
          aggregateType: 'application',
          aggregateId: a.applicationId,
          details: {
            assessmentId: a.id,
            outcome: e.outcome,
            category: e.category,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: a.applicationId,
          eventType: 'ComplianceOutcomeRecorded',
          payload: {
            applicationId: a.applicationId,
            kind: 'AML',
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
                ? 'aml_clear'
                : e.outcome === 'ERROR'
                  ? 'aml_error'
                  : 'aml_review',
            safeErrorCategory: e.outcome === 'ERROR' ? e.category : undefined,
          },
          tx,
        );
    });
  }
}
