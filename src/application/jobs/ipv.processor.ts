import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import {
  evaluateIpv,
  type AdditionalVerification,
} from '../../domain/ipv/additional-verification';
import { IPV_RULEBOOK, type IpvRulebook } from '../../domain/ipv/ipv-rulebook';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
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
  DOCUMENT_REPOSITORY,
  type DocumentRepositoryPort,
} from '../ports/document.repository.port';
import {
  FACE_GATEWAY,
  type FaceGatewayPort,
  type FaceMatchResult,
} from '../ports/face-gateway.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  VERIFICATION_REPOSITORY,
  type TaskRepositoryPort,
  type VerificationRepositoryPort,
} from '../ports/verification.repository.port';
import { SCREEN_IPV } from '../kyc/additional-verification.service';

export interface IpvJobPayload {
  payload: { verificationId: string };
}

export const IPV_JOB = 'ipv';

/** Screen 11 follow-up: liveness on the selfie, face match against the verified identity proof, rulebook evaluation. */
@Processor(QUEUES.IPV)
export class IpvProcessor extends BaseProcessor<IpvJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(VERIFICATION_REPOSITORY)
    private readonly verifications: VerificationRepositoryPort,
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(FACE_GATEWAY) private readonly face: FaceGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(IPV_RULEBOOK) private readonly rulebook: IpvRulebook,
  ) {
    super(store);
    this.logger = logger.child('IpvProcessor');
  }

  async handle(data: IpvJobPayload): Promise<void> {
    const v = await this.verifications.findById(data.payload.verificationId);
    if (!v || v.status !== 'REQUESTED') return;
    await this.verifications.update({
      ...v,
      status: 'PROCESSING',
      updatedAt: this.clock.now(),
    });

    const selfie = v.selfieDocumentId
      ? await this.documents.findDocument(v.selfieDocumentId)
      : null;
    const selfieFile = selfie?.files[0];
    if (!selfieFile) {
      await this.finish(v, {
        status: 'REVIEW_REQUIRED',
        category: 'selfie_missing',
      });
      return;
    }
    const selfieBytes = await this.storage.get(selfieFile.objectKey);
    const liveness = await this.face.liveness(
      selfieBytes,
      selfieFile.contentType ?? 'image/jpeg',
      `${v.id}-l`,
    );
    let faceMatch: FaceMatchResult | undefined;
    const reference = v.referenceDocumentId
      ? await this.documents.findDocument(v.referenceDocumentId)
      : null;
    if (liveness.result === 'PASS' && reference?.files[0]) {
      const refBytes = await this.storage.get(reference.files[0].objectKey);
      faceMatch = await this.face.faceMatch(
        selfieBytes,
        refBytes,
        selfieFile.contentType ?? 'image/jpeg',
        this.rulebook.minFaceMatchConfidence,
        `${v.id}-m`,
      );
    }
    await this.storage.put(
      `applications/${v.applicationId}/ipv/${v.id}/result.json`,
      JSON.stringify({
        liveness: liveness.raw,
        faceMatch: faceMatch?.raw ?? null,
      }),
      'application/json',
    );
    const evaluation = evaluateIpv(
      { result: liveness.result, score: liveness.score },
      faceMatch
        ? {
            matchResult: faceMatch.matchResult,
            confidence: faceMatch.confidence,
          }
        : undefined,
      this.rulebook,
    );
    await this.finish(
      {
        ...v,
        livenessScore: liveness.score,
        faceMatchConfidence: faceMatch?.confidence,
      },
      evaluation,
    );
  }

  private async finish(
    v: AdditionalVerification,
    evaluation: ReturnType<typeof evaluateIpv>,
  ): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(v.applicationId, tx);
      if (!app) return;
      const category =
        evaluation.status === 'PASSED' ? undefined : evaluation.category;
      await this.verifications.update(
        {
          ...v,
          status: evaluation.status,
          safeErrorCategory: category,
          updatedAt: now,
        },
        tx,
      );
      if (evaluation.status === 'PASSED') {
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'IPV', 'PROFILE', now),
          app.version,
          tx,
        );
      } else {
        const attempts = await this.verifications.countByType(
          app.id,
          'SELFIE_LIVENESS',
          tx,
        );
        const exhausted =
          evaluation.status === 'REVIEW_REQUIRED' ||
          attempts >= this.rulebook.maxSelfieAttempts;
        if (exhausted)
          await this.tasks.create(
            {
              id: this.ids.prefixed(ID_PREFIX.task),
              applicationId: app.id,
              category: 'IPV_REVIEW',
              status: 'OPEN',
              details: { verificationId: v.id, category },
              createdAt: now,
            },
            tx,
          );
        await this.applications.saveWithVersionCheck(
          {
            ...app,
            nextScreen: exhausted ? 'ASSISTED_ONBOARDING' : 'IPV',
            version: app.version + 1,
          },
          app.version,
          tx,
        );
      }
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'digio',
          action: 'ipv.evaluated',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            verificationId: v.id,
            status: evaluation.status,
            category,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Additional Verification Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_IPV,
          outcome: evaluation.status.toLowerCase(),
          safeErrorCategory: category,
        },
        tx,
      );
    });
    this.logger.info('ipv.evaluated', {
      verificationId: v.id,
      status: evaluation.status,
    });
  }
}
